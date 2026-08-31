/**
 * tests/perf.test.js —— 性能压测（开发计划 Sprint 9）
 * 造 5000 条单据，验证列表分页 / 利润汇总 / 超期扫描均在合理时间内完成。
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const util = require('../js/core/util.js');
const coding = require('../js/core/coding.js');
const profit = require('../js/core/profit.js');
const debt = require('../js/core/debt.js');

function buildBigCtx() {
  const ctx = newCtx();
  for (let i = 0; i < 50; i++) {
    coding.create(
      { name: '商品' + i, category: '鞋', colors: ['红', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
      ctx
    );
  }
  const skus = ctx.data.skus; // 200 个
  assert.ok(skus.length === 200, '应生成 200 个 SKU');

  const today = util.today();
  for (let i = 0; i < 5000; i++) {
    const sku = skus[i % skus.length];
    const qty = (i % 3) + 1;
    const price = 12900;
    const payable = price * qty;
    ctx.data.sales.push({
      no: 'S' + String(i).padStart(5, '0'),
      date: today,
      type: 'sale',
      partnerId: null,
      items: [{ skuId: sku.id, styleCode: sku.styleCode, color: sku.color, size: sku.size, qty: qty, price: price, costSnapshot: 5000, type: 'sale' }],
      discount: 0,
      payments: [{ method: 'cash', amount: payable }],
      received: payable,
      debt: 0,
      payable: payable,
      voided: false
    });
  }
  return ctx;
}

test('压测：5000 条单据结构正确', () => {
  const ctx = buildBigCtx();
  assert.strictEqual(ctx.data.sales.length, 5000);
  assert.strictEqual(ctx.data.products.length, 50);
});

test('压测：列表分页 < 1s 且分页计数正确', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const p = util.paginate(ctx.data.sales, 1, 50);
  const dt = Date.now() - t0;
  assert.strictEqual(p.total, 5000);
  assert.strictEqual(p.pages, 100);
  assert.strictEqual(p.items.length, 50);
  assert.ok(dt < 1000, '分页耗时 ' + dt + 'ms 应 < 1000ms');
});

test('压测：利润汇总 < 2s 且营收正确', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const s = profit.summary(ctx);
  const dt = Date.now() - t0;
  // 营收 = Σ qty * 12900 ; qty 循环 1,2,3 → 每 3 单合计 6 * 12900 = 77400，共 5000 单
  // Σqty = (1+2+3) * floor(5000/3) + 余数(1,2) = 6*1666 + 3 = 9999
  const expectedRevenue = 9999 * 12900;
  assert.strictEqual(s.revenue, expectedRevenue, '营收应等于 Σ(qty×单价)');
  assert.ok(dt < 2000, '利润汇总耗时 ' + dt + 'ms 应 < 2000ms');
});

test('压测：超期扫描 < 1s（无往来仍快速返回）', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const list = debt.overdue(ctx, 15);
  const dt = Date.now() - t0;
  assert.ok(Array.isArray(list));
  assert.ok(dt < 1000, '超期扫描耗时 ' + dt + 'ms 应 < 1000ms');
});
