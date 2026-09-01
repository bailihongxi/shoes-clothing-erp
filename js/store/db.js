/**
 * store/db.js —— 存储层封装
 * 设计要点：后端可插拔（IndexedDB 用于浏览器；内存后端用于 Node 单元测试）。
 * 上层只调用统一 API：open / get / getAll / put / bulkPut / del / clear / count / query
 */
(function (root, factory) {
  // 防御：与 engine.js 同一套延迟加载模式，避免 IIFE 加载顺序错乱时锁定 undefined。
  // 三步走：(1) Node 直接 require，缓存命中；(2) 浏览器立刻尝试取 root.ERP.schema；
  // (3) 即便闭包变量是 null，下面的 schemaRef() / dataRef() 仍能在函数调用时取到运行时值。
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var schemaStatic = E.schema || (isNode ? require('../core/schema.js') : null);
  var mod = factory(schemaStatic, E);
  if (isNode) module.exports = mod;
  root.ERP.db = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema, ERP) {
  'use strict';

  /**
   * 运行时兜底：闭包内 schema 可能是 null（早期加载顺序错乱时），每次真正访问时
   * 优先用最新的 ERP.schema。这与 issue11 修复对应：避免 IIFE 顶层把 null 锁进闭包。
   */
  function schemaRef() {
    return (ERP && ERP.schema) || schema || null;
  }
  /**
   * 常用静态数据的延迟读——所有 store 列表、KEY_PATH 等需要 schema 就位的接口都走它。
   */
  function safeKeyPath(name) {
    var s = schemaRef();
    return (s && s.KEY_PATH && s.KEY_PATH[name]) || 'id';
  }

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
      return safeKeyPath(name);
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
          function ensureStores(db) {
            return storeDefs.filter(function (def) {
              return !db.objectStoreNames.contains(def.name);
            });
          }
          // upgrade=true 时以指定版本打开并触发 onupgradeneeded；否则无版本探测（不升级）
          function doOpen(v, upgrade) {
            var openReq = upgrade ? idb.open(dbName, v) : idb.open(dbName);
            if (upgrade) {
              openReq.onupgradeneeded = function () {
                var db = openReq.result;
                storeDefs.forEach(function (def) {
                  if (!db.objectStoreNames.contains(def.name)) {
                    db.createObjectStore(def.name, { keyPath: def.keyPath });
                  }
                });
              };
            }
            openReq.onsuccess = function () {
              var db = openReq.result;
              // 补齐缺失 store：库已存在但缺表（或新库空库）时，以 db.version+1 升级触发 onupgradeneeded
              var missing = ensureStores(db);
              if (missing.length) {
                var next = (db.version || 0) + 1;
                db.close();
                doOpen(next, true);
                return;
              }
              dbHandle = db;
              resolve(db);
            };
            openReq.onerror = function () {
              reject(openReq.error);
            };
            openReq.onblocked = function () {
              reject(new Error('数据库被其他标签页占用，请关闭其他页面后重试'));
            };
          }
          doOpen(version || 1, false);
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
    var s = schemaRef();
    var kp = (s && s.KEY_PATH) || {};
    return Object.keys(kp).map(function (name) {
      return { name: name, keyPath: kp[name] };
    });
  }

  /**
   * 创建数据库实例
   * @param {object} opts {backend, name, version}
   */
  async function create(opts) {
    opts = opts || {};
    var s = schemaRef();
    if (!s) {
      throw new Error('db.create 失败：schema 模块尚未加载，请检查 index.html 脚本顺序（core/schema.js 必须早于 store/db.js）');
    }
    var defs = storeDefs();
    var backend = opts.backend;
    if (!backend) {
      backend = (typeof indexedDB !== 'undefined' && indexedDB)
        ? indexedDbBackend(indexedDB)
        : memoryBackend();
    }
    var dbName = opts.name || s.DB_NAME;
    var version = opts.version || s.DB_VERSION;
    await backend.open(dbName, version, defs);

    function keyPathOf(store) {
      return safeKeyPath(store);
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
        var s = schemaRef();
        var data = { schemaVersion: (s && s.VERSION) || 1 };
        var stores = (s && s.DATA_STORES) || [];
        for (var i = 0; i < stores.length; i++) {
          data[stores[i]] = await backend.getAll(stores[i]);
        }
        data.meta = await backend.getAll('meta');
        return data;
      },
      /** 整体覆盖导入 */
      importAll: async function (data) {
        var s = schemaRef();
        var stores = (s && s.DATA_STORES) || [];
        for (var i = 0; i < stores.length; i++) {
          var name = stores[i];
          await backend.clear(name);
          if (Array.isArray(data[name]) && data[name].length) {
            await backend.bulkPut(name, data[name], safeKeyPath(name));
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
