/**
 * core/schema.js —— 数据结构定义、默认设置、schemaVersion 迁移
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.schema = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var S = {
    /** 当前数据结构版本 */
    VERSION: 1,
    DB_NAME: 'shoeErp',
    DB_VERSION: 1,
    META_SETTINGS_KEY: 'settings',
    META_LAST_BACKUP_KEY: 'lastBackupAt',

    /** V3 多账号：每账号独立数据库名 shoeErp_<acctId>；无账号（兼容旧库）用 shoeErp */
    dbNameFor: function dbNameFor(acctId) {
      return acctId ? 'shoeErp_' + acctId : 'shoeErp';
    },

    STORES: {
      products: 'products',
      skus: 'skus',
      purchases: 'purchases',
      sales: 'sales',
      stocktakes: 'stocktakes',
      stockLogs: 'stockLogs',
      ledgers: 'ledgers',
      partners: 'partners',
      printJobs: 'printJobs',
      logs: 'logs',
      meta: 'meta'
    },

    KEY_PATH: {
      products: 'styleCode',
      skus: 'id',
      purchases: 'no',
      sales: 'no',
      stocktakes: 'no',
      stockLogs: 'id',
      ledgers: 'id',
      partners: 'id',
      printJobs: 'id',
      logs: 'id',
      meta: 'key'
    },

    /** 备份/导出时会整体写入的表（顺序固定） */
    DATA_STORES: [
      'products',
      'skus',
      'purchases',
      'sales',
      'stocktakes',
      'stockLogs',
      'ledgers',
      'partners',
      'printJobs',
      'logs'
    ],

    CATEGORIES: ['鞋', '服装', '裤', '配饰', '包袋', '其他'],

    /** 本账号可见分类列表（经营范围过滤）：scopeCategories 为空=不限制，返回全部分类 */
    categoriesFor: function categoriesFor(settings) {
      var all = S.CATEGORIES.slice();
      if (!settings) return all;
      var sc = settings.scopeCategories;
      if (!sc || !sc.length) return all;
      return all.filter(function (c) { return sc.indexOf(c) >= 0; });
    },

    /** 判断某分类是否在本账号经营范围内（空 scope=不限制） */
    inScope: function inScope(settings, category) {
      if (!settings) return true;
      var sc = settings.scopeCategories;
      if (!sc || !sc.length) return true;
      return sc.indexOf(category) >= 0;
    },

    DEFAULT_CATEGORY_PREFIX: {
      鞋: 'X',
      服装: 'F',
      裤: 'K',
      配饰: 'P',
      包袋: 'B',
      其他: 'O'
    },

    STATUS: { ON: 'on', OFF: 'off' },

    /** 单据类型 */
    DOC: {
      PURCHASE: 'purchase',
      SALE: 'sale',
      GIFT: 'gift',
      REFUND: 'refund',
      STOCKTAKE: 'stocktake'
    },

    /** 流水类型 */
    LEDGER: {
      SALE_INCOME: 'sale_income',
      PURCHASE_EXPENSE: 'purchase_expense',
      PAY_SUPPLIER: 'pay_supplier',
      GIFT_COST: 'gift_cost',
      REFUND_OUT: 'refund_out',
      RECEIVE_DEBT: 'receive_debt',
      EXPENSE: 'expense',
      INCOME: 'income'
    },

    EXPENSE_CATEGORIES: ['房租', '水电', '人工', '物流', '其他'],

    LEDGER_LABEL: {
      sale_income: '销售收入',
      purchase_expense: '进货支出',
      pay_supplier: '供应商付款',
      gift_cost: '赠送成本',
      refund_out: '退货退款',
      receive_debt: '客户回款',
      expense: '费用支出',
      income: '其他收入'
    },

    GIFT_REASONS: ['赠品', '样品', '自用', '破损'],

    PAY_METHODS: ['wechat', 'cash', 'alipay'],
    PAY_METHOD_LABEL: { wechat: '微信', cash: '现金', alipay: '支付宝' },

    PARTNER_TYPES: ['supplier', 'customer'],

    /** 条码来源 */
    BARCODE_SOURCE: { SYSTEM: 'system', SUPPLIER: 'supplier' }
  };

  /* ---------------- 默认设置 ---------------- */

  S.defaultSettings = function defaultSettings() {
    return {
      shopName: '我的鞋服店',
      /** V3：本账号经营范围（分类白名单）；空数组=未限制（全部分类） */
      scopeCategories: [],
      /** V3：本账号头像（dataURL） */
      avatar: '',
      categoryPrefix: Object.assign({}, S.DEFAULT_CATEGORY_PREFIX),
      defaultThreshold: 3,
      /** 一码一色码开关：true 时条码内容 = SKU id（默认关闭 = 款号） */
      oneCodePerSku: false,
      label: {
        widthMm: 40,
        heightMm: 30,
        dpi: 203,
        barcodeHeightMm: 10,
        quietMm: 2.5,
        showShopName: true,
        copiesFromStock: true
      },
      print: {
        /** tspl | escpos */
        protocol: 'tspl',
        density: 8,
        gapMm: 2
      },
      lock: { enabled: false, hash: null },
      debtOverdueDays: 15
    };
  };

  S.mergeSettings = function mergeSettings(raw) {
    var base = S.defaultSettings();
    if (!raw || typeof raw !== 'object') return base;
    var out = Object.assign({}, base, raw);
    out.categoryPrefix = Object.assign({}, base.categoryPrefix, raw.categoryPrefix || {});
    out.label = Object.assign({}, base.label, raw.label || {});
    out.print = Object.assign({}, base.print, raw.print || {});
    out.lock = Object.assign({}, base.lock, raw.lock || {});
    return out;
  };

  /* ---------------- 空数据 / 校验 ---------------- */

  S.emptyData = function emptyData() {
    var data = { schemaVersion: S.VERSION };
    S.DATA_STORES.forEach(function (name) {
      data[name] = [];
    });
    return data;
  };

  /**
   * 备份结构校验（不抛错，返回 {ok, error, warnings}）
   */
  S.validateBackup = function validateBackup(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '不是合法的备份文件（内容不是 JSON 对象）' };
    }
    if (typeof raw.schemaVersion !== 'number') {
      return { ok: false, error: '备份文件缺少 schemaVersion，可能不是本软件导出的备份' };
    }
    var missing = [];
    S.DATA_STORES.forEach(function (name) {
      if (!Array.isArray(raw[name])) missing.push(name);
    });
    if (missing.length) {
      return { ok: false, error: '备份文件结构不完整，缺少：' + missing.join('、') };
    }
    if (raw.schemaVersion > S.VERSION) {
      return {
        ok: false,
        error: '备份文件版本（v' + raw.schemaVersion + '）高于当前程序（v' + S.VERSION + '），请先升级软件再导入'
      };
    }
    return { ok: true, warnings: [] };
  };

  /**
   * 迁移：低版本备份 → 当前版本（逐版本升级，钩子在此扩展）
   * 返回 {ok, data, from, to, notes}
   */
  S.migrate = function migrate(raw) {
    var check = S.validateBackup(raw);
    if (!check.ok) return { ok: false, error: check.error };
    var data = S.emptyData();
    S.DATA_STORES.forEach(function (name) {
      data[name] = Array.isArray(raw[name]) ? raw[name].slice() : [];
    });
    var notes = [];
    var from = raw.schemaVersion;
    var v = from;
    while (v < S.VERSION) {
      // v1 为首个版本，暂无历史迁移步骤；后续新增版本在此按序追加
      v += 1;
      notes.push('已从 v' + (v - 1) + ' 升级到 v' + v);
    }
    data.schemaVersion = S.VERSION;
    data.meta = Array.isArray(raw.meta) ? raw.meta.slice() : [];
    data.settings = raw.settings || null;
    data.exportedAt = raw.exportedAt || null;
    data.summary = raw.summary || null;
    return { ok: true, data: data, from: from, to: S.VERSION, notes: notes };
  };

  return S;
});
