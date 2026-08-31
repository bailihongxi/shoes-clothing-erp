/**
 * store/repo.js —— 工作上下文（内存工作集 + 脏数据刷新）
 * 业务层（core/engine）只操作 ctx.data，repo 负责落库与查询助手。
 */
(function (root, factory) {
  // 防御：与 engine.js 同一套延迟加载模式，避免 IIFE 加载顺序错乱时锁定 undefined。
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var schemaStatic = E.schema || (isNode ? require('../core/schema.js') : null);
  var utilStatic = E.util || (isNode ? require('../core/util.js') : null);
  var mod = factory(schemaStatic, utilStatic, E);
  if (isNode) module.exports = mod;
  root.ERP.repo = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema, util, ERP) {
  'use strict';

  /**
   * 运行时兜底：闭包内 schema/util 可能是 null（早期加载顺序错乱时），函数实际调用时
   * 优先用最新的 ERP.schema / ERP.util。这是 issue11 修复：避免 IIFE 顶层把 null 锁进闭包。
   */
  function schemaRef() { return (ERP && ERP.schema) || schema || null; }
  function utilRef() { return (ERP && ERP.util) || util || null; }

  /**
   * 由纯数据构造工作上下文
   * ctx.data：所有表的数组；ctx.touch(store, rec)：标记该记录需要落库
   */
  function createContext(data) {
    var dirty = Object.create(null);

    var ctx = {
      data: data,
      settings: (data && data.settings) || (schemaRef() ? schemaRef().defaultSettings() : {}),

      touch: function (store, rec) {
        if (!rec) return;
        var s = schemaRef();
        if (!s || !s.KEY_PATH || !s.KEY_PATH[store]) return; // schema 未加载或未知 store，安全 no-op（不抛错）
        var keyPath = s.KEY_PATH[store];
        var key = rec[keyPath];
        if (key === undefined || key === null) return;
        if (!dirty[store]) dirty[store] = Object.create(null);
        dirty[store][String(key)] = rec;
      },

      /** 标记整张表为脏（批量改动后用） */
      touchAll: function (store) {
        var list = (data && data[store]) || [];
        for (var i = 0; i < list.length; i++) ctx.touch(store, list[i]);
      },

      dirtyKeys: function () {
        return Object.keys(dirty);
      },

      takeDirty: function () {
        var out = Object.create(null);
        Object.keys(dirty).forEach(function (store) {
          out[store] = Object.keys(dirty[store]).map(function (k) {
            return dirty[store][k];
          });
        });
        dirty = Object.create(null);
        return out;
      },

      clearDirty: function () {
        dirty = Object.create(null);
      },

      /* ---- 查询助手 ---- */
      getProduct: function (styleCode) {
        return (data.products || []).find(function (p) {
          return p.styleCode === styleCode;
        }) || null;
      },
      getSku: function (skuId) {
        return (data.skus || []).find(function (s) {
          return s.id === skuId;
        }) || null;
      },
      skusOf: function (styleCode) {
        return (data.skus || []).filter(function (s) {
          return s.styleCode === styleCode;
        });
      },
      getPartner: function (partnerId) {
        return (data.partners || []).find(function (p) {
          return p.id === partnerId;
        }) || null;
      },
      getDoc: function (store, no) {
        return (data[store] || []).find(function (d) {
          return d.no === no;
        }) || null;
      }
    };

    return ctx;
  }

  /** 从 db 载入全部数据 + 设置 */
  async function loadAll(db) {
    var s = schemaRef();
    if (!s) {
      throw new Error('repo.loadAll 失败：schema 模块尚未加载，请检查 index.html 脚本顺序（core/schema.js 必须早于 store/repo.js）');
    }
    var data = s.emptyData();
    for (var i = 0; i < s.DATA_STORES.length; i++) {
      var name = s.DATA_STORES[i];
      data[name] = await db.getAll(name);
    }
    var settingsRec = await db.get('meta', s.META_SETTINGS_KEY);
    data.settings = s.mergeSettings(settingsRec ? settingsRec.value : null);
    data.lastBackupAt = await getMeta(db, s.META_LAST_BACKUP_KEY);
    return data;
  }

  async function getMeta(db, key) {
    var rec = await db.get('meta', key);
    return rec ? rec.value : null;
  }

  async function setMeta(db, key, value) {
    await db.put('meta', { key: key, value: value });
    return value;
  }

  /** 把 ctx 上的脏数据写入 db */
  async function flush(ctx, db) {
    var dirty = ctx.takeDirty();
    var stores = Object.keys(dirty);
    var counts = Object.create(null);
    for (var i = 0; i < stores.length; i++) {
      var store = stores[i];
      var list = dirty[store];
      if (!list.length) continue;
      await db.bulkPut(store, list);
      counts[store] = list.length;
    }
    return counts;
  }

  /** 保存设置（meta 表 + 内存） */
  async function saveSettings(db, settings) {
    var s = schemaRef();
    await db.put('meta', { key: (s && s.META_SETTINGS_KEY) || 'settings', value: settings });
    return settings;
  }

  /** 记操作日志 */
  function log(ctx, action, detail) {
    var u = utilRef();
    var rec = {
      id: u && typeof u.uuid === 'function' ? u.uuid('log') : ('log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      at: u && typeof u.nowISO === 'function' ? u.nowISO() : new Date().toISOString(),
      action: action,
      detail: detail || ''
    };
    ctx.data.logs = ctx.data.logs || [];
    ctx.data.logs.push(rec);
    ctx.touch('logs', rec);
    return rec;
  }

  return {
    createContext: createContext,
    loadAll: loadAll,
    flush: flush,
    getMeta: getMeta,
    setMeta: setMeta,
    saveSettings: saveSettings,
    log: log
  };
});
