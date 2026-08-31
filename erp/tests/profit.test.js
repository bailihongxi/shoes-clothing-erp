const test = require('node:test');
const assert = require('node:assert');
const profit = require('../js/core/profit.js');
const ledger = require('../js/core/ledger.js');
const { newCtx } = require('./helpers/ctx.js');

/**
 * 构造 PRD 10.2 固定数据：
 *   进价 50、售价 129、卖 10 件、赠 1 件、费用 500
 * 期望：销售收入 1290、销售成本 500、毛利 790、赠送成本 50、净利参考 240
 */
function buildFixed(ctx) {
  const coding = require('../js/core/coding.js');
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' },
    ctx
  );
  // 销售单：10 件销售 + 1 件赠送
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale', partnerId: null, partnerName: '',
    items: [
      { skuId: 'X0010138', styleCode: 'X001', color: '白', size: '38', qty: 10, price: 12900, costSnapshot: 5000, type: 'sale', giftReason: null },
      { skuId: 'X0010138', styleCode: 'X001', color: '白', size: '38', qty: 1, price: 0, costSnapshot: 5000, type: 'gift', giftReason: '赠品' }
    ],
    discount: 0, payable: 129000, received: 129000, debt: 0, payments: [{ method: 'cash', amount: 129000 }],
    note: '', voided: false, createdAt: '2026-08-31T10:00:00'
  });
  // 费用 500（手工记一笔：支出）
  ledger.manual(ctx, { date: '2026-08-31', category: '其他', direction: 'out', amount: '500' });
}

test('PRD 10.2 固定数据：三层利润口径', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 129000, '销售收入 1290 元');
  assert.strictEqual(s.saleCost, 50000, '销售成本 500 元（仅销售行，不含赠送）');
  assert.strictEqual(s.grossProfit, 79000, '毛利 790 元');
  assert.ok(Math.abs(s.grossMargin - 790 / 1290) < 1e-9, '毛利率 = 毛利/收入');
  assert.strictEqual(s.giftCost, 5000, '赠送成本 50 元');
  assert.strictEqual(s.expense, 50000, '费用支出 500 元');
  assert.strictEqual(s.netProfit, 24000, '净利参考 240 元');
});

test('PRD 10.2：改进价后历史报表数字不变（进价快照生效）', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const before = profit.summary(ctx);
  // 改动商品档案当前进价（模拟调价），不影响已存销售单的 costSnapshot
  ctx.getProduct('X001').costPrice = 99900;
  ctx.getSku('X0010138').costPrice = 99900;
  const after = profit.summary(ctx);
  assert.strictEqual(after.revenue, before.revenue, '收入不变');
  assert.strictEqual(after.saleCost, before.saleCost, '销售成本不变（用快照）');
  assert.strictEqual(after.grossProfit, before.grossProfit, '毛利不变');
  assert.strictEqual(after.netProfit, before.netProfit, '净利不变');
});

test('退货冲减销售收入与成本', () => {
  const ctx = newCtx();
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale', items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 2, price: 12900, costSnapshot: 5000, type: 'sale' }
    ],
    discount: 0, payable: 25800, received: 25800, debt: 0, voided: false
  });
  let s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 25800);
  assert.strictEqual(s.saleCost, 10000);
  // 退 1 件
  ctx.data.sales.push({
    no: 'S2', date: '2026-08-31', type: 'refund', refNo: 'S1', items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 1, price: 12900, costSnapshot: 5000, type: 'sale' }
    ],
    discount: 0, payable: 12900, received: 0, debt: 0, voided: false
  });
  s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 12900, '退货后收入减半');
  assert.strictEqual(s.saleCost, 5000, '退货后成本回冲');
});

test('畅销 TOP5 按毛利排序', () => {
  const ctx = newCtx();
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  coding.create({ name: '黑裤', category: '裤', colors: ['黑'], sizes: ['30'], costPrice: '40', salePrice: '99' }, ctx);
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale', items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 5, price: 12900, costSnapshot: 5000, type: 'sale' },
      { skuId: 'K0020130', styleCode: 'K002', qty: 2, price: 9900, costSnapshot: 4000, type: 'sale' }
    ],
    payable: 129000 * 0 + 5 * 12900 + 2 * 9900, received: 5 * 12900 + 2 * 9900, debt: 0, voided: false
  });
  const top = profit.topProducts(ctx, { by: 'profit', n: 5 });
  assert.strictEqual(top[0].styleCode, 'X001', '小白鞋毛利更高应排第一');
  assert.strictEqual(top[0].grossProfit, 5 * (12900 - 5000));
});

test('库存资金占用 = 当前库存 × 最新进价', () => {
  const ctx = newCtx();
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  ctx.data.skus[0].stock = 10;
  ctx.data.skus[0].costPrice = 5000;
  assert.strictEqual(profit.stockValue(ctx), 50000, '10 × 50 = 500');
});

test('buildCSV：带表头与月度行', () => {
  const ctx = newCtx();
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale', items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 1, price: 12900, costSnapshot: 5000, type: 'sale' }
    ], payable: 12900, received: 12900, debt: 0, voided: false
  });
  const csv = profit.buildCSV(ctx);
  assert.ok(csv.startsWith('﻿'), '带 BOM');
  assert.ok(csv.includes('月份'));
  assert.ok(csv.includes('2026-08'), '含月份行');
});
