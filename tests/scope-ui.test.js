/**
 * V3-阶段3：经营范围过滤（UI 层）
 * - 开单选货区只显示本账号分类商品
 * - 库存列表/盘点只显示本账号分类商品
 * - 商品建档分类下拉只含本账号分类
 * - 未限制（空 scope）显示全部
 */
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../js/core/schema.js');
const { newCtx } = require('./helpers/ctx.js');
const sale = require('../js/ui/page-sale.js');
const inventory = require('../js/ui/page-inventory.js');
const product = require('../js/ui/page-product.js');

function ctxWith(settings, products) {
  const ctx = newCtx(settings);
  (products || []).forEach((p) => ctx.data.products.push(p));
  return ctx;
}

const PRODUCTS = [
  { styleCode: 'X001', name: '小白鞋', category: '鞋', status: 'on', barcode: '' },
  { styleCode: 'F001', name: '休闲裤', category: '服装', status: 'on', barcode: '' },
  { styleCode: 'P001', name: '耳环', category: '配饰', status: 'on', barcode: '' }
];

test('开单选货区：鞋店只显示鞋类商品', () => {
  const ctx = ctxWith({ scopeCategories: ['鞋'] }, PRODUCTS);
  const html = sale.render(ctx, sale.init());
  assert.ok(html.includes('X001'), '选货区含鞋类 X001');
  assert.ok(!html.includes('F001'), '选货区不含服装 F001');
  assert.ok(!html.includes('P001'), '选货区不含配饰 P001');
});

test('库存列表：鞋店不显示服装/配饰商品', () => {
  const ctx = ctxWith({ scopeCategories: ['鞋'] }, PRODUCTS);
  const html = inventory.render(ctx, inventory.init());
  assert.ok(html.includes('X001'), '库存列表含 X001');
  assert.ok(!html.includes('F001'), '库存列表不含 F001');
  assert.ok(!html.includes('P001'), '库存列表不含 P001');
});

test('商品建档：服装店分类下拉只含服装', () => {
  const ctx = ctxWith({ scopeCategories: ['服装'] }, PRODUCTS);
  const st = product.init();
  st.tab = 'new'; // 进入建档表单视图
  const html = product.render(ctx, st);
  assert.ok(html.includes('服装（F）'), '下拉含服装');
  assert.ok(!html.includes('鞋（X）'), '下拉不含鞋');
  assert.ok(!html.includes('配饰（P）'), '下拉不含配饰');
  // 默认分类取本账号第一个可见分类
  assert.ok(html.includes('value="服装"'), '默认分类为服装');
});

test('未限制 scope：显示全部分类商品', () => {
  const ctx = ctxWith({ scopeCategories: [] }, PRODUCTS);
  const s = sale.render(ctx, sale.init());
  assert.ok(s.includes('X001') && s.includes('F001') && s.includes('P001'), '全部可见');
  const i = inventory.render(ctx, inventory.init());
  assert.ok(i.includes('X001') && i.includes('F001') && i.includes('P001'), '库存全可见');
});
