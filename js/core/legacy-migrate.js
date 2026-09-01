/**
 * core/legacy-migrate.js —— V2 存量单账号数据 → V3 账号1 库迁移
 *
 * 需求：V2 现有单账号数据（旧库 shoeErp）迁移到账号 1（库 shoeErp_acct1）。
 * 设计：createDb(name) 注入数据库工厂（浏览器用 ERP.db.create 走 indexedDB；测试传 memory backend）
 * 规则：target 已非空则跳过（不覆盖）；只迁移一次（调用方用 localStorage 标记）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var schema = isNode ? require('./schema.js') : (root.ERP && root.ERP.schema);
  var mod = factory(schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.migrate = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema) {
  'use strict';

  var api = {};

  /** target 各数据表是否均为空 */
  api.isTargetEmpty = async function isTargetEmpty(db) {
    var stores = schema.DATA_STORES;
    for (var i = 0; i < stores.length; i++) {
      var n = await db.count(stores[i]);
      if (n > 0) return false;
    }
    return true;
  };

  /** 把 src 全部数据表 + meta.settings 拷贝到 dst；返回移动记录数 */
  api.copyAll = async function copyAll(src, dst) {
    var stores = schema.DATA_STORES;
    var moved = 0;
    for (var i = 0; i < stores.length; i++) {
      var name = stores[i];
      var rows = await src.getAll(name);
      if (rows && rows.length) {
        await dst.bulkPut(name, rows, schema.KEY_PATH[name]);
        moved += rows.length;
      }
    }
    var settingsRec = await src.get('meta', schema.META_SETTINGS_KEY);
    if (settingsRec) {
      var cur = await dst.get('meta', schema.META_SETTINGS_KEY);
      if (!cur) await dst.put('meta', settingsRec);
    }
    return moved;
  };

  /**
   * 执行迁移：legacyName → targetName
   * @param {function} createDb (name)=>Promise<db>
   * @returns {Promise<{migrated:boolean, moved?:number, reason?:string}>}
   */
  api.migrate = async function migrate(createDb, legacyName, targetName) {
    if (!legacyName || !targetName || legacyName === targetName) {
      return { migrated: false, reason: 'same-db' };
    }
    var legacy = await createDb(legacyName);
    var target = await createDb(targetName);
    var empty = await api.isTargetEmpty(target);
    if (!empty) return { migrated: false, reason: 'target-not-empty' };
    var moved = await api.copyAll(legacy, target);
    if (moved > 0) return { migrated: true, moved: moved };
    return { migrated: false, moved: 0 };
  };

  return api;
});
