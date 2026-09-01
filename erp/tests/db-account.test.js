/**
 * V3-阶段2：多账号数据隔离
 * - 每账号独立 IndexedDB 库名（schema.dbNameFor）
 * - 账号1 库与账号2 库数据互不可见
 * - settings 新增字段（scopeCategories/avatar）经 mergeSettings 保留
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const schema = require('../js/core/schema.js');

async function newDb(name) {
  return db.create({ backend: db.memoryBackend(), name: name });
}

test('schema.dbNameFor：每账号独立库名，无账号用兼容旧库名', () => {
  assert.strictEqual(schema.dbNameFor('acct1'), 'shoeErp_acct1');
  assert.strictEqual(schema.dbNameFor('acct2'), 'shoeErp_acct2');
  assert.strictEqual(schema.dbNameFor('acct3'), 'shoeErp_acct3');
  assert.strictEqual(schema.dbNameFor(''), 'shoeErp', '空账号=旧库名（兼容存量）');
  assert.strictEqual(schema.dbNameFor(null), 'shoeErp');
  assert.strictEqual(schema.dbNameFor(undefined), 'shoeErp');
  assert.strictEqual(schema.dbNameFor('shoe'), 'shoeErp_shoe');
  assert.ok(schema.dbNameFor('acct1') !== schema.dbNameFor('acct2'), '不同账号库名不同');
});

test('数据隔离：账号1 与账号2 独立库互不可见', async () => {
  const d1 = await newDb(schema.dbNameFor('acct1'));
  const d2 = await newDb(schema.dbNameFor('acct2'));
  await d1.put('products', { styleCode: 'X001', name: '鞋店小白鞋' });
  await d1.put('meta', { key: 'settings', value: { shopName: '鞋店' } });

  // 账号2 库为空
  assert.strictEqual(await d2.count('products'), 0, '账号2 看不到账号1 的商品');
  assert.strictEqual(await d2.get('products', 'X001'), null);
  assert.strictEqual(await d2.get('meta', 'settings'), null);

  // 账号1 数据完好
  assert.strictEqual(await d1.count('products'), 1);
  const p = await d1.get('products', 'X001');
  assert.strictEqual(p.name, '鞋店小白鞋');
  const s = await d1.get('meta', 'settings');
  assert.strictEqual(s.value.shopName, '鞋店');
});

test('数据隔离：账号1 与账号2 各自 settings（店名/经营范围）互不串扰', async () => {
  const d1 = await newDb(schema.dbNameFor('acct1'));
  const d2 = await newDb(schema.dbNameFor('acct3'));
  await d1.put('meta', { key: 'settings', value: { shopName: '鞋店A', scopeCategories: ['鞋'] } });
  await d2.put('meta', { key: 'settings', value: { shopName: '饰品店C', scopeCategories: ['配饰'] } });

  const s1 = (await d1.get('meta', 'settings')).value;
  const s2 = (await d2.get('meta', 'settings')).value;
  assert.strictEqual(s1.shopName, '鞋店A');
  assert.deepStrictEqual(s1.scopeCategories, ['鞋']);
  assert.strictEqual(s2.shopName, '饰品店C');
  assert.deepStrictEqual(s2.scopeCategories, ['配饰']);
  assert.notDeepStrictEqual(s1.scopeCategories, s2.scopeCategories);
});

test('settings 新增字段：mergeSettings 保留 scopeCategories / avatar', () => {
  const s = schema.mergeSettings({ shopName: '我的店', scopeCategories: ['鞋', '服装'], avatar: 'data:image/png;base64,xx' });
  assert.strictEqual(s.shopName, '我的店');
  assert.deepStrictEqual(s.scopeCategories, ['鞋', '服装']);
  assert.strictEqual(s.avatar, 'data:image/png;base64,xx');

  // 默认：scopeCategories 为空数组（未限制），avatar 为空
  const def = schema.mergeSettings(null);
  assert.deepStrictEqual(def.scopeCategories, []);
  assert.strictEqual(def.avatar, '');
});
