/**
 * page-product 搜索增强测试：filterProducts 纯函数
 * （款号/名称/条码/色码 id/分类名 多字段搜索 + 分类下拉 + 经营范围过滤）
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-product.js');
const schema = require('../js/core/schema.js');

function makeCtx(products, skus, settings) {
  return {
    data: { products, skus },
    settings: settings || {},
    skusOf(styleCode) {
      return skus.filter((s) => s.styleCode === styleCode);
    }
  };
}

const PRODUCTS = [
  { id: 'p1', styleCode: 'X001', name: '白色运动鞋', category: '鞋', barcode: '6901234567892', status: 'on', printedAt: '2026-09-01' },
  { id: 'p2', styleCode: 'X002', name: '黑色卫衣', category: '服装', barcode: '', status: 'on', printedAt: '' },
  { id: 'p3', styleCode: 'X003', name: '帆布腰带', category: '配饰', barcode: '4006381333931', status: 'off', printedAt: '' }
];
const SKUS = [
  { id: 'X001-白-40', styleCode: 'X001', color: '白', size: '40' },
  { id: 'X002-黑-L', styleCode: 'X002', color: '黑', size: 'L' }
];

test('filterProducts：默认返回经营范围内全部商品（按款号排序）', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  const r = page.filterProducts(ctx, {});
  assert.deepStrictEqual(r.map((p) => p.styleCode), ['X001', 'X002', 'X003']);
});

test('filterProducts：经营范围过滤（scopeCategories 限定分类）', () => {
  const ctx = makeCtx(PRODUCTS, SKUS, { scopeCategories: ['鞋'] });
  const r = page.filterProducts(ctx, {});
  assert.deepStrictEqual(r.map((p) => p.styleCode), ['X001'], '只看鞋');
});

test('filterProducts：关键字多字段搜索（款号/名称/条码/色码/分类）', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: 'X001' }).map((p) => p.styleCode), ['X001'], '按款号');
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: '卫衣' }).map((p) => p.styleCode), ['X002'], '按名称');
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: '4006381333931' }).map((p) => p.styleCode), ['X003'], '按条码');
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: 'X002-黑-L' }).map((p) => p.styleCode), ['X002'], '按色码 id');
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: '配饰' }).map((p) => p.styleCode), ['X003'], '按分类名');
});

test('filterProducts：关键字大小写不敏感', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: 'x001' }).map((p) => p.styleCode), ['X001']);
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: 'X00' }).map((p) => p.styleCode), ['X001', 'X002', 'X003']);
});

test('filterProducts：分类下拉过滤', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterCategory: '服装' }).map((p) => p.styleCode), ['X002']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterCategory: 'all' }).map((p) => p.styleCode), ['X001', 'X002', 'X003']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterCategory: '' }).map((p) => p.styleCode), ['X001', 'X002', 'X003']);
});

test('filterProducts：关键字 + 分类组合过滤', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  const r = page.filterProducts(ctx, { keyword: 'X00', filterCategory: '鞋' });
  assert.deepStrictEqual(r.map((p) => p.styleCode), ['X001']);
});

test('filterProducts：条码 / 打印 / 状态过滤保持', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterBarcode: 'has' }).map((p) => p.styleCode), ['X001', 'X003']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterBarcode: 'none' }).map((p) => p.styleCode), ['X002']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterPrinted: 'printed' }).map((p) => p.styleCode), ['X001']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterPrinted: 'unprinted' }).map((p) => p.styleCode), ['X002', 'X003']);
  assert.deepStrictEqual(page.filterProducts(ctx, { filterStatus: 'off' }).map((p) => p.styleCode), ['X003']);
});

test('filterProducts：无匹配返回空数组', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, { keyword: '不存在的' }), []);
});

test('filterProducts：兼容旧 state 无新字段（null/undefined 安全）', () => {
  const ctx = makeCtx(PRODUCTS, SKUS);
  assert.deepStrictEqual(page.filterProducts(ctx, null).map((p) => p.styleCode), ['X001', 'X002', 'X003']);
});

test('categoriesFor：scopeCategories 为空返回全部分类', () => {
  const all = schema.categoriesFor({});
  assert.ok(all.length >= 6 && all.indexOf('鞋') >= 0 && all.indexOf('配饰') >= 0, '返回全部分类');
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['鞋'] }), ['鞋']);
});
