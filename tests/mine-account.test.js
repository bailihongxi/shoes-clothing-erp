/**
 * V3-阶段4：账号个性化（我的页 头像/店名/经营范围/切换账号）
 * - 店铺卡片显示店名 + 经营范围 + 头像
 * - 编辑面板：改店名、上传头像预览、保存同步账号列表
 * - 切换账号回登录页
 */
const test = require('node:test');
const assert = require('node:assert');
const { newCtx } = require('./helpers/ctx.js');
const mine = require('../js/ui/page-mine.js');
const accounts = require('../js/core/accounts.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _m: m
  };
}

function setup(settings) {
  const store = memStore();
  globalThis.localStorage = store;
  const erp = globalThis.ERP; // require 链已建立的 ERP 对象（page-mine 闭包引用它）
  if (!erp) throw new Error('ERP 未初始化');
  erp.currentAccount = { id: 'acct1', shopName: '鞋店' };
  delete erp.app; // 每次干净
  const ctx = newCtx(settings || { scopeCategories: ['鞋'], shopName: '鞋店' });
  const state = mine.init();
  return { ctx, state, store, erp };
}

test('我的页：店铺卡片显示店名 + 经营范围 + 默认头像', () => {
  const { ctx, state } = setup();
  const html = mine.render(ctx, state);
  assert.ok(html.includes('鞋店'), '显示店名');
  assert.ok(html.includes('经营：鞋'), '显示经营范围');
  assert.ok(html.includes('class="avatar"'), '默认头像（无自定义头像）');
});

test('我的页：设置头像后显示图片头像', () => {
  const { ctx, state } = setup({ scopeCategories: ['鞋'], shopName: '鞋店', avatar: 'data:image/png;base64,AVATAR' });
  const html = mine.render(ctx, state);
  assert.ok(html.includes('avatar-img'), '显示图片头像');
  assert.ok(html.includes('data:image/png;base64,AVATAR'));
});

test('我的页：展开编辑面板，可改店名', () => {
  const { ctx, state } = setup();
  mine.render(ctx, state);
  mine.actions['toggle-shop-edit'](ctx, state);
  const html = mine.render(ctx, state);
  assert.ok(html.includes('店铺名称'), '编辑面板含店名输入');
  assert.ok(html.includes('data-act="save-shop"'), '含保存按钮');
  assert.ok(html.includes('data-act="switch-account"'), '含切换账号按钮');
  assert.strictEqual(state.shopNameEdit, '鞋店', '编辑初始为当前店名');
});

test('我的页：保存店名 → settings 与账号列表同步更新', () => {
  const { ctx, state, store, erp } = setup();
  accounts.ensurePreset(store);
  mine.actions['toggle-shop-edit'](ctx, state);
  state.shopNameEdit = '老王鞋行';
  let savedSettings = null;
  erp.app = { saveSettings: () => { savedSettings = ctx.settings; }, render() {}, commit() {} };
  mine.actions['save-shop'](ctx, state);
  assert.strictEqual(ctx.settings.shopName, '老王鞋行', 'settings 店名更新');
  assert.ok(savedSettings && savedSettings.shopName === '老王鞋行');
  // 账号列表同步
  const acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '老王鞋行', '账号列表店名同步');
  assert.strictEqual(state.editShop, false, '保存后收起面板');
});

test('我的页：保存空店名拒绝', () => {
  const { ctx, state } = setup();
  mine.actions['toggle-shop-edit'](ctx, state);
  state.shopNameEdit = '   ';
  const r = mine.actions['save-shop'](ctx, state);
  assert.strictEqual(r, false);
  assert.strictEqual(ctx.settings.shopName, '鞋店', '店名不变');
});

test('我的页：切换账号触发 app.logout 回登录页', () => {
  const { ctx, state, erp } = setup();
  let loggedOut = false;
  erp.app = { logout: () => { loggedOut = true; } };
  mine.actions['switch-account'](ctx, state);
  assert.strictEqual(loggedOut, true, '调用 logout');
});
