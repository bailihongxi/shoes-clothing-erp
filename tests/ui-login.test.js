/**
 * V3-阶段1.2：多账号登录页 ui/page-login.js
 * - 首次渲染自动初始化预置账号（鞋/服装/配饰）
 * - 账号卡片展示店名/用户名/经营范围；选择后输密码进入
 * - 密码校验通过返回账号；错误密码拒绝
 * - 支持自建账号（密码一致性校验）
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-login.js');
const accounts = require('../js/core/accounts.js');
const { newCtx } = require('./helpers/ctx.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

function fresh() {
  const ctx = newCtx();
  const store = memStore();
  const state = page.init(ctx, store);
  return { ctx, state, store };
}

function elAttr(attrs) {
  const el = { getAttribute: (k) => attrs[k] || null };
  return el;
}
function elVal(attrs, value) {
  const el = { getAttribute: (k) => attrs[k] || null, value };
  return el;
}

test('登录页：首次渲染自动初始化 3 个预置账号（鞋/服装/配饰）', () => {
  const { ctx, state, store } = fresh();
  const html = page.render(ctx, state);
  assert.strictEqual(accounts.load(store).length, 3);
  assert.ok(html.includes('鞋店'), '展示账号1 鞋店');
  assert.ok(html.includes('服装店'), '展示账号2 服装店');
  assert.ok(html.includes('饰品店'), '展示账号3 饰品店');
  assert.ok(html.includes('经营：鞋'), '账号1 经营范围=鞋');
  assert.ok(html.includes('经营：服装'), '账号2 经营范围=服装');
  assert.ok(html.includes('经营：配饰'), '账号3 经营范围=配饰');
});

test('登录页：选择账号后显示密码输入与进入按钮', () => {
  const { ctx, state } = fresh();
  page.render(ctx, state);
  page.actions['pick-account'](ctx, state, elAttr({ 'data-id': 'acct1' }));
  const html = page.render(ctx, state);
  assert.ok(html.includes('登录密码'), '选中后出现密码输入');
  assert.ok(html.includes('进入「鞋店」'), '出现进入按钮');
  assert.ok(html.includes('data-act="do-login"'), '进入按钮派发 do-login');
});

test('登录页：初始密码 000000 校验通过返回账号；错误密码拒绝', () => {
  const { ctx, state, store } = fresh();
  page.render(ctx, state);
  const ok = page.loginWith(store, 'acct1', '000000');
  assert.ok(ok && ok.ok === true, '初始密码通过');
  assert.strictEqual(ok.account.id, 'acct1');
  assert.deepStrictEqual(ok.account.scopeCategories, ['鞋']);
  assert.ok(!('hash' in ok.account), '登录返回账号不含哈希');

  const bad = page.loginWith(store, 'acct1', 'wrong1');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
  assert.ok(/密码错误/.test(bad.error));
});

test('登录页：do-login 密码正确触发 app.onLogin；错误提示不触发', () => {
  const { ctx, state } = fresh();
  page.render(ctx, state);
  page.actions['pick-account'](ctx, state, elAttr({ 'data-id': 'acct2' }));
  state.pwd = '000000';
  let loggedIn = null;
  const orig = globalThis.ERP;
  globalThis.ERP = { app: { onLogin: (acct) => { loggedIn = acct; } } };
  try {
    const r = page.actions['do-login'](ctx, state, null, null);
    assert.strictEqual(r, false, 'do-login 返回 false（阻止默认 afterAction）');
    assert.ok(loggedIn && loggedIn.id === 'acct2', '触发 onLogin 并传入账号');
    assert.deepStrictEqual(loggedIn.scopeCategories, ['服装']);

    // 错误密码：不触发，提示
    loggedIn = null;
    state.pwd = 'bad';
    const r2 = page.actions['do-login'](ctx, state, null, null);
    assert.strictEqual(r2, false);
    assert.strictEqual(loggedIn, null, '错误密码不触发登录');
    assert.ok(/密码错误/.test(state.error));
  } finally {
    globalThis.ERP = orig;
  }
});

test('登录页：自建账号（密码一致）成功并自动选中', () => {
  const { ctx, state } = fresh();
  page.render(ctx, state);
  page.actions['toggle-create'](ctx, state);
  state.create = { username: 'myShop', shopName: '我的小店', password: 'abcd1234', password2: 'abcd1234' };
  const r = page.actions['create-account'](ctx, state);
  assert.ok(r !== false, '创建成功');
  assert.strictEqual(state.selectedId, 'acct4', '创建后自动选中新账号');
  const list = accounts.load(state.store);
  assert.strictEqual(list.length, 4, '新增第 4 个账号');
  const created = accounts.findByUsername(list, 'myShop');
  assert.ok(created, '账号已创建');
  assert.strictEqual(accounts.verify(created, 'abcd1234'), true);
  // 新账号默认全部分类开放
  assert.deepStrictEqual(created.scopeCategories, accounts.ALL_CATEGORIES);
});

test('登录页：自建账号密码不一致拒绝', () => {
  const { ctx, state } = fresh();
  page.render(ctx, state);
  page.actions['toggle-create'](ctx, state);
  state.create = { username: 'myShop2', shopName: '店', password: 'abcd1234', password2: 'different' };
  const r = page.actions['create-account'](ctx, state);
  assert.strictEqual(r, false, '密码不一致拒绝');
  assert.ok(/不一致/.test(state.error));
  assert.strictEqual(accounts.findByUsername(accounts.load(state.store), 'myShop2'), null, '未创建');
});

test('登录页：自建账号显示在列表，可再次登录', () => {
  const { ctx, state } = fresh();
  page.render(ctx, state);
  page.actions['toggle-create'](ctx, state);
  state.create = { username: 'newshop', shopName: '新店', password: '8888', password2: '8888' };
  page.actions['create-account'](ctx, state);
  const html = page.render(ctx, state);
  assert.ok(html.includes('新店'), '新账号出现在列表');
  // 选中并登录
  const list = accounts.load(state.store);
  const acct = accounts.findByUsername(list, 'newshop');
  state.selectedId = acct.id;
  state.pwd = '8888';
  const r = page.loginWith(state.store, acct.id, '8888');
  assert.ok(r.ok === true);
  assert.strictEqual(r.account.id, acct.id);
});
