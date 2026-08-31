const test = require('node:test');
const assert = require('node:assert');
const scan = require('../js/barcode/scan.js');
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  const coding = require('../js/core/coding.js');
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
}

test('scan.resolve：按条码定位到商品', () => {
  const ctx = newCtx();
  seed(ctx);
  const p = ctx.getProduct('X001');
  const r = scan.resolve(ctx, p.barcode);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.styleCode, 'X001');
});

test('scan.resolve：按款号定位', () => {
  const ctx = newCtx();
  seed(ctx);
  const r = scan.resolve(ctx, 'x001');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.type, 'style');
});

test('scan.resolve：按色码 id 定位（反查款）', () => {
  const ctx = newCtx();
  seed(ctx);
  const r = scan.resolve(ctx, 'X0010138');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.type, 'sku');
  assert.strictEqual(r.styleCode, 'X001');
});

test('scan.resolve：未建档 → 找不到', () => {
  const ctx = newCtx();
  const r = scan.resolve(ctx, 'ZZZ999');
  assert.strictEqual(r.found, false);
});

test('scan.card：库存矩阵汇总 + 0 库存标记', () => {
  const ctx = newCtx();
  seed(ctx);
  // 默认库存 0
  const c0 = scan.card(ctx, 'X001');
  assert.ok(c0);
  assert.strictEqual(c0.totalStock, 0);
  assert.strictEqual(c0.allZero, true, '整款 0 库存应标记');

  // 给部分色码补库存
  ctx.getSku('X0010138').stock = 3; // 白/38
  ctx.getSku('X0010239').stock = 0; // 黑/39
  const c = scan.card(ctx, 'X001');
  assert.strictEqual(c.totalStock, 3);
  assert.strictEqual(c.allZero, false);
  assert.strictEqual(c.cells['白|38'].stock, 3);
  assert.strictEqual(c.cells['黑|39'].stock, 0);
});
