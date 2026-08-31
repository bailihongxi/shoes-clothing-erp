/**
 * store/db.js —— 存储层封装
 * 设计要点：后端可插拔（IndexedDB 用于浏览器；内存后端用于 Node 单元测试）。
 * 上层只调用统一 API：open / get / getAll / put / bulkPut / del / clear / count / query
 */
(function (root, factory) {
  var schema = (typeof module !== 'undefined' && module.exports)
    ? require('../core/schema.js')
    : root.ERP && root.ERP.schema;
  var mod = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.db = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema) {
  'use strict';

  /* ---------------- 内存后端（Node 测试 / 降级） ---------------- */

  function memoryBackend() {
    var stores = Object.create(null);
    function slot(name) {
      if (!stores[name]) stores[name] = new Map();
      return stores[name];
    }
    return {
      name: 'memory',
      async open() {
        return { name: 'memory' };
      },
      async get(store, key) {
        var v = slot(store).get(String(key));
        return v === undefined ? null : v;
      },
      async getAll(store) {
        return Array.from(slot(store).values());
      },
      async put(store, value, keyPath) {
        var key = value && value[keyPath];
        if (key === undefined || key === null) throw new Error('记录缺少主键字段 ' + keyPath);
        slot(store).set(String(key), JSON.parse(JSON.stringify(value)));
        return key;
      },
      async bulkPut(store, values, keyPath) {
        for (var i = 0; i < values.length; i++) {
          var key = values[i] && values[i][keyPath];
          if (key === undefined || key === null) throw new Error('记录缺少主键字段 ' + keyPath);
          slot(store).set(String(key), JSON.parse(JSON.stringify(values[i])));
        }
        return values.length;
      },
      async del(store, key) {
        slot(store).delete(String(key));
      },
      async clear(store) {
        slot(store).clear();
      },
      async count(store) {
        return slot(store).size;
      },
      async close() {}
    };
  }

  /* ---------------- IndexedDB 后端 ---------------- */

  function indexedDbBackend(idb) {
    var dbHandle = null;
    var stores = [];

    function storeKeyPath(name) {
      for (var i = 0; i < stores.length; i++) {
        if (stores[i].name === name) return stores[i].keyPath;
      }
      return (schema && schema.KEY_PATH[name]) || 'id';
    }

    function run(names, mode, fn) {
      return new Promise(function (resolve, reject) {
        var tx = dbHandle.transaction(names, mode);
        var result;
        tx.oncomplete = function () {
          resolve(result);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = function () {
          reject(tx.error || new Error('事务被中止'));
        };
        var out = fn(tx, function (v) {
          result = v;
        });
        if (out && typeof out.then === 'function') {
          out.then(function (v) {
            result = v;
          }, reject);
        }
      });
    }

    function reqToPromise(request) {
      return new Promise(function (resolve, reject) {
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    }

    return {
      name: 'indexeddb',
      async open(dbName, version, storeDefs) {
        stores = storeDefs;
        return new Promise(function (resolve, reject) {
          var openReq = idb.open(dbName, version);
          openReq.onupgradeneeded = function () {
            var db = openReq.result;
            storeDefs.forEach(function (def) {
              if (!db.objectStoreNames.contains(def.name)) {
                db.createObjectStore(def.name, { keyPath: def.keyPath });
              }
            });
          };
          openReq.onsuccess = function () {
            dbHandle = openReq.result;
            resolve(dbHandle);
          };
          openReq.onerror = function () {
            reject(openReq.error);
          };
          openReq.onblocked = function () {
            reject(new Error('数据库被其他标签页占用，请关闭其他页面后重试'));
          };
        });
      },
      async get(store, key) {
        return run([store], 'readonly', function (tx, done) {
          var r = tx.objectStore(store).get(key);
          r.onsuccess = function () {
            done(r.result === undefined ? null : r.result);
          };
        });
      },
      async getAll(store) {
        return run([store], 'readonly', function (tx, done) {
          var r = tx.objectStore(store).getAll();
          r.onsuccess = function () {
            done(r.result || []);
          };
        });
      },
      async put(store, value, keyPath) {
        var kp = keyPath || storeKeyPath(store);
        return run([store], 'readwrite', function (tx, done) {
          var r = tx.objectStore(store).put(value);
          r.onsuccess = function () {
            done(value[kp]);
          };
        });
      },
      async bulkPut(store, values, keyPath) {
        var kp = keyPath || storeKeyPath(store);
        if (!values.length) return 0;
        return run([store], 'readwrite', function (tx, done) {
          var os = tx.objectStore(store);
          for (var i = 0; i < values.length; i++) os.put(values[i]);
          done(values.length);
        });
      },
      async del(store, key) {
        return run([store], 'readwrite', function (tx, done) {
          tx.objectStore(store).delete(key);
          done(true);
        });
      },
      async clear(store) {
        return run([store], 'readwrite', function (tx, done) {
          tx.objectStore(store).clear();
          done(true);
        });
      },
      async count(store) {
        return run([store], 'readonly', function (tx, done) {
          var r = tx.objectStore(store).count();
          r.onsuccess = function () {
            done(r.result || 0);
          };
        });
      },
      async close() {
        if (dbHandle) dbHandle.close();
      },
      _reqToPromise: reqToPromise
    };
  }

  /* ---------------- 统一 API ---------------- */

  function storeDefs() {
    return Object.keys(schema.KEY_PATH).map(function (name) {
      return { name: name, keyPath: schema.KEY_PATH[name] };
    });
  }

  /**
   * 创建数据库实例
   * @param {object} opts {backend, name, version}
   */
  async function create(opts) {
    opts = opts || {};
    var defs = storeDefs();
    var backend = opts.backend;
    if (!backend) {
      backend = (typeof indexedDB !== 'undefined' && indexedDB)
        ? indexedDbBackend(indexedDB)
        : memoryBackend();
    }
    var dbName = opts.name || schema.DB_NAME;
    var version = opts.version || schema.DB_VERSION;
    await backend.open(dbName, version, defs);

    function keyPathOf(store) {
      return schema.KEY_PATH[store] || 'id';
    }

    var api = {
      backendName: backend.name,
      stores: defs.map(function (d) {
        return d.name;
      }),

      get: function (store, key) {
        return backend.get(store, key);
      },
      getAll: function (store) {
        return backend.getAll(store);
      },
      put: function (store, value) {
        return backend.put(store, value, keyPathOf(store));
      },
      bulkPut: function (store, values) {
        if (!values || !values.length) return Promise.resolve(0);
        return backend.bulkPut(store, values, keyPathOf(store));
      },
      del: function (store, key) {
        return backend.del(store, key);
      },
      clear: function (store) {
        return backend.clear(store);
      },
      count: function (store) {
        return backend.count(store);
      },
      /** 条件查询：predicate(记录) => boolean 或 {field, value} */
      query: async function (store, predicate) {
        var all = await backend.getAll(store);
        if (!predicate) return all;
        if (typeof predicate === 'function') return all.filter(predicate);
        if (predicate && predicate.field) {
          return all.filter(function (r) {
            return r[predicate.field] === predicate.value;
          });
        }
        return all;
      },
      /** 清空全部数据表（恢复/初始化用） */
      clearAll: async function () {
        await backend.clear('products');
        for (var i = 0; i < defs.length; i++) {
          await backend.clear(defs[i].name);
        }
      },
      /** 导出全部数据（含 meta） */
      exportAll: async function () {
        var data = { schemaVersion: schema.VERSION };
        for (var i = 0; i < schema.DATA_STORES.length; i++) {
          data[schema.DATA_STORES[i]] = await backend.getAll(schema.DATA_STORES[i]);
        }
        data.meta = await backend.getAll('meta');
        return data;
      },
      /** 整体覆盖导入 */
      importAll: async function (data) {
        for (var i = 0; i < schema.DATA_STORES.length; i++) {
          var name = schema.DATA_STORES[i];
          await backend.clear(name);
          if (Array.isArray(data[name]) && data[name].length) {
            await backend.bulkPut(name, data[name], schema.KEY_PATH[name]);
          }
        }
        await backend.clear('meta');
        if (Array.isArray(data.meta) && data.meta.length) {
          await backend.bulkPut('meta', data.meta, 'key');
        }
        return true;
      },
      close: function () {
        return backend.close();
      }
    };
    return api;
  }

  return {
    create: create,
    memoryBackend: memoryBackend,
    indexedDbBackend: indexedDbBackend,
    storeDefs: storeDefs
  };
});
