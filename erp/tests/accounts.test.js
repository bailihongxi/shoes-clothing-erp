/**
 * V3-阶段1.1：多账号体系 core/accounts.js
 * - 预置 3 账号（鞋/服装/配饰，初始密码 000000）
 * - 密码只存哈希，可校验
 * - 支持自行创建账号，最多 10 个
 * - 账号列表脱敏（不暴露哈希）
 */
const test = require('node:test');
const assert = require('node:assert');
const accounts = require('../js/core/accounts.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

test('预置账号：首次 ensurePreset 创建 3 个账号（鞋/服装/配饰）', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(accounts.getById(list, 'acct1').scopeCategories, ['鞋']);
  assert.deepStrictEqual(accounts.getById(list, 'acct2').scopeCategories, ['服装']);
  assert.deepStrictEqual(accounts.getById(list, 'acct3').scopeCategories, ['配饰']);
});

test('预置账号：初始密码 000000 可校验，错误密码不可', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const acct = accounts.getById(list, 'acct1');
  assert.strictEqual(accounts.verify(acct, '000000'), true, '初始密码 000000 通过');
  assert.strictEqual(accounts.verify(acct, '123456'), false, '错误密码拒绝');
  // 存的是哈希不是明文
  assert.ok(acct.hash && !acct.hash.includes('000000'), '密码以哈希存储，不含明文');
});

test('ensurePreset 幂等：重复调用不重复创建', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const again = accounts.ensurePreset(store);
  assert.strictEqual(again.length, 3);
});

test('自行创建账号：成功创建并可用初始密码登录；默认全部分类开放', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'zhuangxie', password: 'abc123', shopName: '装修五金' });
  assert.ok(r.ok, '创建成功：' + (r.error || ''));
  const list = accounts.load(store);
  const acct = accounts.getById(list, r.account.id);
  assert.strictEqual(acct.username, 'zhuangxie');
  assert.strictEqual(accounts.verify(acct, 'abc123'), true);
  assert.deepStrictEqual(acct.scopeCategories, accounts.ALL_CATEGORIES, '自建账号默认全分类开放');
});

test('创建账号校验：重名拒绝、非法账号名拒绝、密码过短拒绝', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'dup', password: '1234' });
  assert.strictEqual(accounts.create(store, { username: 'dup', password: '1234' }).ok, false, '重名拒绝');
  assert.strictEqual(accounts.create(store, { username: 'x', password: '1234' }).ok, false, '账号名过短拒绝');
  assert.strictEqual(accounts.create(store, { username: 'okname', password: '1' }).ok, false, '密码过短拒绝');
});

test('账号上限：最多 10 个，超出拒绝', () => {
  const store = memStore();
  accounts.ensurePreset(store); // 3 个
  for (let i = 4; i <= 10; i++) {
    const r = accounts.create(store, { username: 'user' + i, password: '1234' });
    assert.ok(r.ok, '第 ' + i + ' 个应创建成功');
  }
  assert.strictEqual(accounts.load(store).length, 10);
  const over = accounts.create(store, { username: 'toomany', password: '1234' });
  assert.strictEqual(over.ok, false);
  assert.ok(/上限/.test(over.error), '提示上限');
});

test('账号脱敏：publicList/strip 不暴露密码哈希', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const pub = accounts.publicList(accounts.load(store));
  pub.forEach((a) => {
    assert.ok(!('hash' in a), '公开视图不含 hash');
    assert.ok(!('password' in a), '公开视图不含明文密码');
  });
});

test('updateProfile：更新店名与头像，登录页同步可见', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.updateProfile(store, 'acct1', { shopName: '老王鞋行', avatar: 'data:image/png;base64,abc' });
  assert.ok(r.ok);
  const acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '老王鞋行');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,abc');
  // 密码不受影响
  assert.strictEqual(accounts.verify(acct, '000000'), true);
});

test('updateProfile：只改头像不影响店名；空店名忽略', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.updateProfile(store, 'acct1', { avatar: 'data:image/png;base64,x' });
  let acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '鞋店', '店名不变');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,x');
  // 空店名被忽略
  accounts.updateProfile(store, 'acct1', { shopName: '   ' });
  acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '鞋店');
});

test('updateProfile：账号不存在返回错误', () => {
  const store = memStore();
  const r = accounts.updateProfile(store, 'nope', { shopName: 'x' });
  assert.strictEqual(r.ok, false);
});
