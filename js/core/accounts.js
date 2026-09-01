/**
 * core/accounts.js —— V3 多账号体系
 *
 * 设计：
 *  - 本地账号 + 密码（无服务器、离线可用）；密码只存哈希（util.hashPassword，不存明文）
 *  - 账号列表存 localStorage['erp.accounts']；数据按账号独立（IndexedDB dbName = shoeErp_<acctId>）
 *  - 预置 3 个账号（经营范围：鞋 / 服装 / 配饰，初始密码 000000），允许自行创建账号，最多 10 个
 *  - store 抽象：浏览器传 localStorage 之类 {getItem,setItem}，Node 单测传内存 mock
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : (root.ERP && root.ERP.util);
  var mod = factory(util);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.accounts = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var ACCOUNTS_KEY = 'erp.accounts';
  var MAX_ACCOUNTS = 10;
  var DEFAULT_PASSWORD = '000000';
  var ALL_CATEGORIES = ['鞋', '服装', '裤', '配饰', '包袋', '其他'];

  var api = {};

  api.ACCOUNTS_KEY = ACCOUNTS_KEY;
  api.MAX_ACCOUNTS = MAX_ACCOUNTS;
  api.DEFAULT_PASSWORD = DEFAULT_PASSWORD;
  api.ALL_CATEGORIES = ALL_CATEGORIES;

  /** 预置账号（V3 需求1：账号1 鞋、账号2 服装、账号3 饰品=配饰） */
  api.PRESET = [
    { id: 'acct1', username: 'shoe',     shopName: '鞋店',   scopeCategories: ['鞋'],   password: DEFAULT_PASSWORD },
    { id: 'acct2', username: 'clothes',  shopName: '服装店', scopeCategories: ['服装'], password: DEFAULT_PASSWORD },
    { id: 'acct3', username: 'accessory', shopName: '饰品店', scopeCategories: ['配饰'], password: DEFAULT_PASSWORD }
  ];

  /** 生成新账号 id（自建账号：acct4 起递增，避开已存在 id） */
  api.nextId = function nextId(list) {
    var used = {};
    (list || []).forEach(function (a) { used[a.id] = true; });
    for (var i = 1; i <= MAX_ACCOUNTS + 1; i++) {
      var cand = 'acct' + i;
      if (!used[cand]) return cand;
    }
    return 'acct' + (Date.now().toString(36));
  };

  /** 读账号列表（不含密码哈希） */
  api.load = function load(store) {
    if (!store || !store.getItem) return [];
    var raw = null;
    try {
      raw = store.getItem(ACCOUNTS_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];
    try {
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e2) {
      return [];
    }
  };

  api.save = function save(store, list) {
    if (!store || !store.setItem) return false;
    try {
      store.setItem(ACCOUNTS_KEY, JSON.stringify(list || []));
      return true;
    } catch (e) {
      return false;
    }
  };

  api.getById = function getById(list, id) {
    return (list || []).find(function (a) { return a.id === id; }) || null;
  };

  api.findByUsername = function findByUsername(list, username) {
    var u = String(username || '').trim().toLowerCase();
    return (list || []).find(function (a) { return String(a.username).toLowerCase() === u; }) || null;
  };

  /** 校验密码：返回 true 表示通过 */
  api.verify = function verify(account, pwd) {
    return !!account && util.verifyPassword(pwd, account.hash);
  };

  /**
   * 确保预置账号存在（首次初始化写入；已存在则不重复创建）。
   * 预置账号初始密码 DEFAULT_PASSWORD，仅在首次创建时生效。
   */
  api.ensurePreset = function ensurePreset(store) {
    var list = api.load(store);
    var changed = false;
    api.PRESET.forEach(function (p) {
      var found = api.getById(list, p.id);
      if (!found) {
        list.push({
          id: p.id,
          username: p.username,
          shopName: p.shopName,
          avatar: '',
          scopeCategories: p.scopeCategories.slice(),
          hash: util.hashPassword(p.password),
          createdAt: new Date().toISOString().slice(0, 10)
        });
        changed = true;
      }
    });
    if (changed) api.save(store, list);
    return list;
  };

  /**
   * 创建账号（自行注册）。最多 MAX_ACCOUNTS 个。
   * @returns {object} {ok:boolean, error?:string, account?:object}
   */
  api.create = function create(store, input) {
    input = input || {};
    var username = String(input.username || '').trim();
    var pwd = String(input.password === undefined || input.password === null ? '' : input.password);
    var shopName = String(input.shopName || '').trim() || username;
    if (!username) return { ok: false, error: '请输入登录账号' };
    if (!/^[A-Za-z0-9_]{2,20}$/.test(username)) {
      return { ok: false, error: '登录账号需为 2-20 位字母/数字/下划线' };
    }
    if (pwd.length < 4) return { ok: false, error: '密码至少 4 位' };

    var list = api.load(store);
    if (list.length >= MAX_ACCOUNTS) {
      return { ok: false, error: '账号数量已达上限（最多 ' + MAX_ACCOUNTS + ' 个）' };
    }
    if (api.findByUsername(list, username)) {
      return { ok: false, error: '该登录账号已存在' };
    }
    // 自建账号默认全部分类开放（未分配经营范围，后续可收紧）
    var account = {
      id: api.nextId(list),
      username: username,
      shopName: shopName,
      avatar: '',
      scopeCategories: input.scopeCategories && input.scopeCategories.length ? input.scopeCategories.slice() : ALL_CATEGORIES.slice(),
      hash: util.hashPassword(pwd),
      createdAt: new Date().toISOString().slice(0, 10)
    };
    list.push(account);
    api.save(store, list);
    // 返回的 account 剥离 hash，避免明文/哈希外泄给界面
    return { ok: true, account: api.strip(account) };
  };

  /** 更新账号资料（店名/头像），供「我的」页保存 */
  api.updateProfile = function updateProfile(store, id, patch) {
    var list = api.load(store);
    var acct = api.getById(list, id);
    if (!acct) return { ok: false, error: '账号不存在' };
    patch = patch || {};
    if (typeof patch.shopName === 'string' && String(patch.shopName).trim()) {
      acct.shopName = String(patch.shopName).trim();
    }
    if (typeof patch.avatar === 'string') acct.avatar = patch.avatar;
    api.save(store, list);
    return { ok: true, account: api.strip(acct) };
  };

  /** 去掉敏感字段（hash）后的公开账号视图 */
  api.strip = function strip(a) {
    if (!a) return null;
    var out = {
      id: a.id,
      username: a.username,
      shopName: a.shopName,
      avatar: a.avatar || '',
      scopeCategories: (a.scopeCategories || []).slice(),
      createdAt: a.createdAt || ''
    };
    return out;
  };

  /** 列表 → 公开视图（脱敏） */
  api.publicList = function publicList(list) {
    return (list || []).map(api.strip);
  };

  return api;
});
