/**
 * tests/e2e.test.js —— PRD 10.0B 全流程闭环验收
 * 建档 → 进货(挂账) → 付供应商 → 销售(现金) → 销售(挂账) → 退货红冲 → 作废回滚
 * 断言库存 / 流水 / 欠款 / 利润最终一致。
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const profit = require('../js/core/profit.js');
const ledger = require('../js/core/ledger.js');

function stockOf(ctx, skuId) {
  const s = ctx.getSku(skuId);
  return s ? (s.stock || 0) : null;
}

test('PRD 10.0B：完整业务闭环最终状态一致', () => {
  const ctx = newCtx();
  const created = coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  const sku = ctx.data.skus[0]; // X0010138
  const skuId = sku.id;

  /* ① 进货 10 件，挂账（应付 200） */
  const pur = engine.savePurchase(ctx, {
    date: '2026-08-01', partnerName: '温州鞋厂',
    items: [{ skuId: skuId, qty: 10, costPrice: '50' }], paid: '300'
  });
  assert.ok(pur.ok, '进货应成功');
  assert.strictEqual(stockOf(ctx, skuId), 10, '进货后库存 10');
  const sup = ctx.getPartner(pur.doc.partnerId);
  assert.strictEqual(sup.balance, 20000, '供应商应付 200.00');

  /* ④ 付供应商 200 → 应付清零 */
  const pay = engine.settleAccount(ctx, { partnerId: sup.id, amount: '200', date: '2026-08-02', isSupplier: true });
  assert.ok(pay.ok, '付款应成功');
  assert.strictEqual(sup.balance, 0, '供应商应付清零');
  assert.ok(ledger.list(ctx, { type: 'pay_supplier' }).length === 1, '应有一笔供应商付款流水');

  /* ① 现金销售 3 件（应收 387.00，收入流水） */
  const cash = engine.saveSale(ctx, {
    date: '2026-08-03',
    items: [{ skuId: skuId, qty: 3, price: '129', type: 'sale' }],
    payments: [{ method: 'cash', amount: '387' }]
  });
  assert.ok(cash.ok, '现金销售应成功');
  assert.strictEqual(stockOf(ctx, skuId), 7, '销售后库存 7');
  assert.ok(ledger.list(ctx, { type: 'sale_income' }).length === 1, '应有一笔销售收入流水');

  /* ⑤ 挂账销售 2 件给客户（应收 258.00） */
  const credit = engine.saveSale(ctx, {
    date: '2026-08-04',
    items: [{ skuId: skuId, qty: 2, price: '129', type: 'sale' }],
    partnerName: '张三'
  });
  assert.ok(credit.ok, '挂账销售应成功');
  assert.strictEqual(stockOf(ctx, skuId), 5, '挂账销售后库存 5');
  const cus = ctx.getPartner(credit.doc.partnerId);
  assert.strictEqual(cus.balance, 25800, '客户应收 258.00');

  /* ③ 退货红冲：现金单退 1 件（库存 +1，退款流水） */
  const refund = engine.refundSale(ctx, { originalNo: cash.doc.no, items: [{ skuId: skuId, qty: 1 }] });
  assert.ok(refund.ok, '退货应成功');
  assert.strictEqual(stockOf(ctx, skuId), 6, '退货后库存 6');
  const rd = ctx.getDoc('sales', refund.doc.no);
  assert.strictEqual(rd.type, 'refund', '退货单类型应为 refund');
  assert.strictEqual(rd.refNo, cash.doc.no, '应关联原单');
  assert.ok(ledger.list(ctx, { type: 'refund_out' }).length === 1, '应有一笔退货退款流水');

  /* ⑥ 作废挂账销售（库存回滚 +2，应收冲回，流水留痕） */
  const v = engine.voidSale(ctx, credit.doc.no);
  assert.ok(v.ok, '作废应成功');
  assert.strictEqual(stockOf(ctx, skuId), 8, '作废后库存回到 8');
  assert.strictEqual(cus.balance, 0, '作废后客户应收归零');
  assert.strictEqual(credit.doc.voided, true, '原单应标记作废');

  /* 最终一致性：销售类单据 = 现金单 + 挂账单(已作废) + 退货单 = 3 */
  assert.strictEqual(ctx.data.sales.length, 3, '应有 3 张销售类单据（含退货/作废）');
  const nonVoidLedgers = ledger.list(ctx, {}).filter(function (l) { return !l.voided; });
  assert.strictEqual(nonVoidLedgers.length, 4, '未作废流水应为 4 笔（进货支出/付款/收入/退货）');

  const sum = profit.summary(ctx);
  // 营收 = 现金 387 - 退货 129 = 258（挂账单已作废不计）
  assert.strictEqual(sum.revenue, 25800, '营收应为 258.00');
  // 毛利 = 营收 25800 - 销售成本(现金3×50 - 退货1×50=10000) = 15800
  assert.strictEqual(sum.grossProfit, 15800, '毛利应为 158.00');
});
