const test = require('node:test');
const assert = require('node:assert');
const ledger = require('../js/core/ledger.js');
const debt = require('../js/core/debt.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');

/** 建档 + 供应商 + 客户，返回 {ctx, sup, cus} */
function seed(ctx) {
  const coding = require('../js/core/coding.js');
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  // 给色码补库存，保证销售开单不被「库存不足」拦截
  ctx.data.skus.forEach(function (s) { s.stock = 999; });
  const sup = debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const cus = debt.ensurePartner(ctx, { name: '张三', type: 'customer' });
  return { sup, cus };
}

test('ledger.add：方向由类型决定', () => {
  const ctx = newCtx();
  const r = ledger.add(ctx, { type: 'sale_income', amount: 100 });
  assert.strictEqual(r.direction, 'in');
  assert.strictEqual(r.amount, 100);
  assert.strictEqual(r.voided, false);
});

test('ledger.fromPurchase：有付款才生成进货支出流水', () => {
  const ctx = newCtx();
  const { sup } = seed(ctx);
  const noLedger = ledger.fromPurchase(ctx, { date: '2026-08-31', paid: 0, partnerId: sup.id, partnerName: '温州鞋厂' });
  assert.strictEqual(noLedger, null, '未付款不生成流水');
  ledger.fromPurchase(ctx, { date: '2026-08-31', paid: 30000, partnerId: sup.id, partnerName: '温州鞋厂' });
  const ls = ledger.list(ctx, { type: 'purchase_expense' });
  assert.strictEqual(ls.length, 1);
  assert.strictEqual(ls[0].amount, 30000);
  assert.strictEqual(ls[0].direction, 'out');
});

test('ledger.fromSale：销售收入 + 赠送成本 + 退货退款', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  const saleDoc = {
    no: 'S1', date: '2026-08-31', type: 'sale', partnerId: cus.id, partnerName: '张三',
    received: 12900,
    items: [
      { type: 'sale', price: 12900, costSnapshot: 5000, qty: 1 },
      { type: 'gift', price: 0, costSnapshot: 5000, qty: 1, giftReason: '赠品' }
    ]
  };
  ledger.fromSale(ctx, saleDoc);
  const income = ledger.list(ctx, { type: 'sale_income' });
  assert.strictEqual(income.length, 1);
  assert.strictEqual(income[0].amount, 12900);
  const gift = ledger.list(ctx, { type: 'gift_cost' });
  assert.strictEqual(gift.length, 1);
  assert.strictEqual(gift[0].amount, 5000, '赠送成本 = 1×5000');

  const refundDoc = { no: 'S2', date: '2026-08-31', type: 'refund', refNo: 'S1', payable: 12900, partnerId: cus.id, items: [{ type: 'sale', price: 12900, costSnapshot: 5000, qty: 1 }] };
  ledger.fromSale(ctx, refundDoc);
  const rf = ledger.list(ctx, { type: 'refund_out' });
  assert.strictEqual(rf.length, 1);
  assert.strictEqual(rf[0].amount, 12900);
});

test('ledger.manual：费用支出与其他收入', () => {
  const ctx = newCtx();
  const exp = ledger.manual(ctx, { date: '2026-08-31', category: '房租', amount: '2000' });
  assert.ok(exp.ok);
  assert.strictEqual(exp.rec.type, 'expense');
  assert.strictEqual(exp.rec.amount, 200000);
  assert.strictEqual(exp.rec.auto, false);

  const inc = ledger.manual(ctx, { date: '2026-08-31', category: '其他', direction: 'in', amount: '500' });
  assert.ok(inc.ok);
  assert.strictEqual(inc.rec.type, 'income');
  assert.strictEqual(inc.rec.direction, 'in');

  const zero = ledger.manual(ctx, { date: '2026-08-31', category: '房租', amount: '0' });
  assert.strictEqual(zero.ok, false, '0 元应被拒绝');
});

test('ledger.voidByRef：作废关联流水（默认查询排除）', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  ledger.fromSale(ctx, { no: 'S1', date: '2026-08-31', type: 'sale', received: 12900, items: [{ type: 'sale', price: 12900, costSnapshot: 5000, qty: 1 }] });
  const before = ledger.list(ctx, {}).length;
  const n = ledger.voidByRef(ctx, 'S1');
  assert.strictEqual(n, 1);
  const after = ledger.list(ctx, {}).length;
  assert.strictEqual(after, before - 1, '默认 list 排除已作废');
  assert.strictEqual(ledger.list(ctx, { includeVoided: true }).length, before);
});

test('ledger.list：按日期/类型过滤；ledger.sum 收入/支出/净额', () => {
  const ctx = newCtx();
  ledger.manual(ctx, { date: '2026-08-10', category: '房租', amount: '1000' });
  ledger.manual(ctx, { date: '2026-08-20', category: '其他', direction: 'in', amount: '300' });
  const inAug = ledger.list(ctx, { from: '2026-08-15' });
  assert.strictEqual(inAug.length, 1, '只看 8/15 之后：仅 8/20 收入');
  const sum = ledger.sum(ctx, {});
  assert.strictEqual(sum.income, 30000);
  assert.strictEqual(sum.expense, 100000);
  assert.strictEqual(sum.net, -70000);
});

test('ledger.expenseTotal：费用支出合计（不含收入/作废）', () => {
  const ctx = newCtx();
  ledger.add(ctx, { type: 'expense', category: '房租', amount: 100000, date: '2026-08-01', refNo: 'E1' });
  ledger.add(ctx, { type: 'expense', category: '水电', amount: 20000, date: '2026-08-03', refNo: 'E2' });
  ledger.add(ctx, { type: 'income', category: '其他', amount: 50000, date: '2026-08-02' });
  ledger.voidByRef(ctx, 'E2');
  const t = ledger.expenseTotal(ctx, '2026-08-01', '2026-08-31');
  assert.strictEqual(t, 100000, '仅费用、排除收入与已作废');
});

test('PRD 10.1-④ 进货欠款付款 → 生成供应商付款流水', () => {
  const ctx = newCtx();
  const { sup } = seed(ctx);
  engine.savePurchase(ctx, {
    date: '2026-08-31', partnerId: sup.id,
    items: [{ skuId: 'X0010138', qty: 5, costPrice: '50' }],
    paid: '100' // 总 250，欠 150
  });
  assert.strictEqual(ctx.getPartner(sup.id).balance, 15000);
  const res = engine.settleAccount(ctx, { partnerId: sup.id, amount: '150', isSupplier: true });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '应付清零');
  const pay = ledger.list(ctx, { type: 'pay_supplier' });
  assert.strictEqual(pay.length, 1, '应生成供应商付款流水');
  assert.strictEqual(pay[0].amount, 15000);
});

test('PRD 10.1-⑤ 客户挂账收款 → 生成客户回款流水', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  engine.saveSale(ctx, {
    date: '2026-08-31', partnerId: cus.id,
    items: [{ skuId: 'X0010138', qty: 1, price: '129' }],
    payments: [{ method: 'debt', amount: '129' }]
  });
  assert.strictEqual(ctx.getPartner(cus.id).balance, 12900);
  const res = engine.settleAccount(ctx, { partnerId: cus.id, amount: '129', isSupplier: false });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0, '应收清零');
  const recv = ledger.list(ctx, { type: 'receive_debt' });
  assert.strictEqual(recv.length, 1, '应生成客户回款流水');
  assert.strictEqual(recv[0].amount, 12900);
});
