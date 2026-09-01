/**
 * V3-阶段3：经营范围过滤（schema.inScope / categoriesFor）
 * - 空 scopeCategories=未限制（全部分类可见）
 * - 账号 scope=['鞋'] → 只可见鞋；['服装'] → 只服装；['配饰'] → 只配饰
 */
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../js/core/schema.js');

test('categoriesFor：未限制时返回全部分类', () => {
  assert.deepStrictEqual(schema.categoriesFor(null), schema.CATEGORIES);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: [] }), schema.CATEGORIES);
  assert.deepStrictEqual(schema.categoriesFor({}), schema.CATEGORIES);
});

test('categoriesFor：账号1 只鞋、账号2 只服装、账号3 只配饰', () => {
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['鞋'] }), ['鞋']);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['服装'] }), ['服装']);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['配饰'] }), ['配饰']);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['鞋', '服装'] }), ['鞋', '服装']);
});

test('inScope：分类是否在本账号经营范围内', () => {
  // 未限制 → 全部通过
  assert.strictEqual(schema.inScope(null, '鞋'), true);
  assert.strictEqual(schema.inScope({ scopeCategories: [] }, '包袋'), true);
  // 鞋店：鞋 true，服装 false
  const shoe = { scopeCategories: ['鞋'] };
  assert.strictEqual(schema.inScope(shoe, '鞋'), true);
  assert.strictEqual(schema.inScope(shoe, '服装'), false);
  assert.strictEqual(schema.inScope(shoe, '配饰'), false);
  // 服装店
  const clothes = { scopeCategories: ['服装'] };
  assert.strictEqual(schema.inScope(clothes, '服装'), true);
  assert.strictEqual(schema.inScope(clothes, '鞋'), false);
  // 饰品店=配饰
  const acc = { scopeCategories: ['配饰'] };
  assert.strictEqual(schema.inScope(acc, '配饰'), true);
  assert.strictEqual(schema.inScope(acc, '鞋'), false);
});

test('inScope 边界：分类不在 CATEGORIES 时按未限制处理不崩溃', () => {
  assert.strictEqual(schema.inScope({ scopeCategories: ['鞋'] }, ''), false);
  assert.strictEqual(schema.inScope({ scopeCategories: ['鞋'] }, '其他'), false);
  assert.strictEqual(schema.inScope({ scopeCategories: ['鞋', '服装'] }, '裤'), false);
});
