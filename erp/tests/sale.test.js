const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const inv = require('../js/core/inventory.js');
const cart = require('../js/core/cart.js');
const engine = require('../js/core/engine.js');
const ledger = require('../js/core/ledger.js');
const debt = require('../js/core/debt.js');
const { newCtx } = require('./helpers/ctx.js');

const L = require('../js/core/schema.js').LEDGER;

/** 建一款：白/黑 × 38/39，进价 50 售价 129 */
function seed(ctx) {
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  return ctx;
}
function purchase(ctx, items, paid, partnerName) {
  return engine.savePurchase(ctx, {
    date: '2026-08-31',
    partnerName: partnerName || '温州鞋厂',
    items: items,
    paid: paid === undefined ? 99999 : paid
  });
}

/* ---------- cart.compute ---------- */

test('cart：销售行合计 − 折扣 = 应收；赠送不计入应收', () => {
  const r = cart.compute(
    [
      { type: 'sale', price: 12900, qty: 2, costSnapshot: 5000 },
      { type: 'gift', price: 0, qty: 1, costSnapshot: 5000 }
    ],
    { discount: 0, payments: [] }
  );
  assert.strictEqual(r.saleTotal, 25800);
  assert.strictEqual(r.giftQty, 1);
  assert.strictEqual(r.giftCost, 5000);
  assert.strictEqual(r.payable, 25800, '赠送不计入应收');
});

test('cart：整单折扣与欠款计算', () => {
  const r = cart.compute(
    [{ type: 'sale', price: 12900, qty: 2, costSnapshot: 5000 }],
    { discount: 900, payments: [{ method: 'cash', amount: 12000 }] }
  );
  assert.strictEqual(r.payable, 24900, '258 − 9 = 249');
  assert.strictEqual(r.received, 12000);
  assert.strictEqual(r.debt, 12900, '应收 − 实收 = 欠款');
});

test('cart：实收超过应收时按应收封顶，不产生负欠款', () => {
  const r = cart.compute(
    [{ type: 'sale', price: 12900, qty: 1, costSnapshot: 5000 }],
    { discount: 0, payments: [{ method: 'cash', amount: 20000 }] }
  );
  assert.strictEqual(r.received, 12900);
  assert.strictEqual(r.debt, 0);
});

/* ---------- 10.1-① 进货→销售 库存与流水 ---------- */

test('10.1-① 进货 3 件 → 开单 2 件 → 库存 1，且生成销售收入流水', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 3, costPrice: '50' }]);
  assert.strictEqual(ctx.getSku('X0010138').stock, 3);

  const r = engine.saveSale(ctx, {
    date: '2026-08-31',
    items: [{ skuId: 'X0010138', qty: 2, price: '129' }],
    payments: [{ method: 'cash', amount: '258' }]
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 1, '3 − 2 = 1');
  assert.strictEqual(r.doc.payable, 25800);

  const inc = ctx.data.ledgers.filter((l) => l.type === L.SALE_INCOME && !l.voided);
  assert.strictEqual(inc.length, 1);
  assert.strictEqual(inc[0].amount, 25800);
  assert.strictEqual(inc[0].refNo, r.doc.no);
});

test('10.1-① 库存不足时拒绝保存且不产生脏数据', () => {
  const ctx = seed(newCtx());
  const r = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 1, price: '129' }],
    payments: [{ method: 'cash', amount: '129' }]
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('库存'));
  assert.strictEqual(ctx.data.sales.length, 0);
});

/* ---------- 10.1-② 混合赠送单 ---------- */

test('10.1-② 1 行销售 + 1 行赠送：应收只含销售、库存各 −1、生成赠送成本流水、无第二笔收入', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 5, costPrice: '50' },
    { skuId: 'X0010139', qty: 5, costPrice: '50' }
  ]);

  const r = engine.saveSale(ctx, {
    date: '2026-08-31',
    items: [
      { skuId: 'X0010138', qty: 1, price: '129', type: 'sale' },
      { skuId: 'X0010139', qty: 1, price: '0', type: 'gift', giftReason: '赠品' }
    ],
    payments: [{ method: 'cash', amount: '129' }]
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 4, '销售行 −1');
  assert.strictEqual(ctx.getSku('X0010139').stock, 4, '赠送行 −1');
  assert.strictEqual(r.doc.payable, 12900, '应收只含销售行');

  const incomes = ctx.data.ledgers.filter((l) => l.type === L.SALE_INCOME && !l.voided);
  assert.strictEqual(incomes.length, 1, '只生成一笔销售收入');
  assert.strictEqual(incomes[0].amount, 12900);

  const giftLed = ctx.data.ledgers.find((l) => l.type === L.GIFT_COST && !l.voided);
  assert.ok(giftLed, '应生成赠送成本流水');
  assert.strictEqual(giftLed.amount, 5000, '赠送成本 = 进价 × 数量');

  // 赠送记录视图：从销售单明细筛出 type=gift
  const giftRows = ctx.data.sales
    .filter((s) => !s.voided)
    .reduce((acc, s) => acc.concat(s.items.filter((it) => it.type === 'gift')), []);
  assert.strictEqual(giftRows.length, 1);
  assert.strictEqual(giftRows[0].giftReason, '赠品');
});

/* ---------- 10.1-③ 退货红冲 ---------- */

test('10.1-③ 退货：库存 +N、收入冲减（退货红冲流水）、原单红冲', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 3, costPrice: '50' }]);
  const s = engine.saveSale(ctx, {
    date: '2026-08-31',
    items: [{ skuId: 'X0010138', qty: 2, price: '129' }],
    payments: [{ method: 'cash', amount: '258' }]
  });
  assert.strictEqual(ctx.getSku('X0010138').stock, 1);

  const rf = engine.refundSale(ctx, { originalNo: s.doc.no });
  assert.strictEqual(rf.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 3, '退货入库 1 → 3');
  assert.strictEqual(rf.doc.type, 'refund');
  assert.strictEqual(rf.doc.refNo, s.doc.no);

  // 退货红冲流水
  const refundLed = ctx.data.ledgers.find((l) => l.type === L.REFUND_OUT && !l.voided);
  assert.ok(refundLed, '应生成退货红冲流水');
  assert.strictEqual(refundLed.amount, 25800);
  assert.strictEqual(refundLed.refNo, rf.doc.no);

  // 收入净额为 0（收入 25800 − 退款 25800）
  const net = ledger.sum(ctx, {});
  const saleInc = ctx.data.ledgers
    .filter((l) => l.type === L.SALE_INCOME && !l.voided)
    .reduce((t, l) => t + l.amount, 0);
  const refundOut = ctx.data.ledgers
    .filter((l) => l.type === L.REFUND_OUT && !l.voided)
    .reduce((t, l) => t + l.amount, 0);
  assert.strictEqual(saleInc - refundOut, 0, '收入按退货金额冲减');
});

test('10.1-③ 部分退货：只退其中一行', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 3, costPrice: '50' },
    { skuId: 'X0010139', qty: 3, costPrice: '50' }
  ]);
  const s = engine.saveSale(ctx, {
    items: [
      { skuId: 'X0010138', qty: 2, price: '129' },
      { skuId: 'X0010139', qty: 1, price: '129' }
    ],
    payments: [{ method: 'cash', amount: '387' }]
  });
  assert.strictEqual(ctx.getSku('X0010138').stock, 1);
  assert.strictEqual(ctx.getSku('X0010139').stock, 2);

  const rf = engine.refundSale(ctx, { originalNo: s.doc.no, items: [{ skuId: 'X0010138', qty: 1 }] });
  assert.strictEqual(rf.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 2, '白/38 退 1 → 2');
  assert.strictEqual(ctx.getSku('X0010139').stock, 2, '黑/39 不受影响');
  assert.strictEqual(rf.doc.items.length, 1);
});

test('10.1-③ 赊账单退货：冲减客户应收而非产生现金退款', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 3, costPrice: '50' }]);
  const customer = debt.ensurePartner(ctx, { name: '小张', type: 'customer' });
  const s = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 2, price: '129' }],
    partnerId: customer.id // 未付款 → 全赊账
  });
  assert.strictEqual(s.doc.debt, 25800);
  assert.strictEqual(ctx.getPartner(customer.id).balance, 25800);

  const rf = engine.refundSale(ctx, { originalNo: s.doc.no });
  assert.strictEqual(rf.ok, true);
  assert.strictEqual(rf.doc.cashRefund, 0, '赊账退货不产生现金退款');
  assert.strictEqual(rf.doc.debtRefund, 25800);
  assert.strictEqual(ctx.getPartner(customer.id).balance, 0, '客户应收冲减为 0');
});

/* ---------- 10.1-④ 进货欠款与付款 ---------- */

test('10.1-④ 进货欠款 1000 / 已付 600 → 应付 400；付款 400 → 归零 + 付款流水', () => {
  const ctx = seed(newCtx());
  const sup = debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const p = engine.savePurchase(ctx, {
    date: '2026-08-31',
    partnerId: sup.id,
    items: [{ skuId: 'X0010138', qty: 10, costPrice: '100' }],
    paid: '600'
  });
  assert.strictEqual(p.doc.total, 100000);
  assert.strictEqual(p.doc.debt, 40000);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 40000);

  const st = engine.settleAccount(ctx, { partnerId: sup.id, amount: '400', isSupplier: true, date: '2026-08-31' });
  assert.strictEqual(st.ok, true);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0);

  const payLed = ctx.data.ledgers.find((l) => l.type === L.PAY_SUPPLIER && !l.voided);
  assert.ok(payLed, '应生成供应商付款流水');
  assert.strictEqual(payLed.amount, 40000);
});

/* ---------- 10.1-⑤ 客户挂账与收款 ---------- */

test('10.1-⑤ 客户挂账 300 → 应收 +300；收款 300 → 归零 + 回款流水', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 5, costPrice: '50' }]);
  const cus = debt.ensurePartner(ctx, { name: '小李', type: 'customer' });
  const s = engine.saveSale(ctx, {
    date: '2026-08-31',
    partnerId: cus.id,
    items: [{ skuId: 'X0010138', qty: 2, price: '150' }] // 应收 300，未付款
  });
  assert.strictEqual(s.doc.payable, 30000);
  assert.strictEqual(s.doc.debt, 30000);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 30000);

  const st = engine.settleAccount(ctx, { partnerId: cus.id, amount: '300', isSupplier: false, date: '2026-08-31' });
  assert.strictEqual(st.ok, true);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0);

  const recv = ctx.data.ledgers.find((l) => l.type === L.RECEIVE_DEBT && !l.voided);
  assert.ok(recv, '应生成客户回款流水');
  assert.strictEqual(recv.amount, 30000);
});

/* ---------- 10.1-⑥ 作废回滚 ---------- */

test('10.1-⑥ 赊账销售单作废：库存与欠款同步回滚且留操作日志', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 5, costPrice: '50' }]);
  const cus = debt.ensurePartner(ctx, { name: '小王', type: 'customer' });
  const s = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 2, price: '129' }],
    partnerId: cus.id
  });
  assert.strictEqual(ctx.getSku('X0010138').stock, 3);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 25800, '赊账生成客户应收');

  const r = engine.voidSale(ctx, s.doc.no);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 5, '库存回滚到进货后');
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0, '欠款冲回');
  assert.strictEqual(ctx.getDoc('sales', s.doc.no).voided, true);
  assert.ok(ctx.data.logs.some((l) => l.action === '作废销售单'));
  assert.strictEqual(engine.voidSale(ctx, s.doc.no).ok, false, '不能重复作废');
});

test('10.1-⑥ 现金销售单作废：收入流水被作废（净收入归零）', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 5, costPrice: '50' }]);
  const s = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 2, price: '129' }],
    payments: [{ method: 'cash', amount: '258' }]
  });
  const incomeBefore = ctx.data.ledgers.filter((l) => l.type === L.SALE_INCOME && !l.voided).length;
  assert.strictEqual(incomeBefore, 1);

  const r = engine.voidSale(ctx, s.doc.no);
  assert.strictEqual(r.ok, true);
  const incomeAfter = ctx.data.ledgers.filter((l) => l.type === L.SALE_INCOME && !l.voided).length;
  assert.strictEqual(incomeAfter, incomeBefore - 1, '收入流水被作废');
});

test('10.1-⑥ 赠送退货原单作废：赠送成本流水一并作废', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 5, costPrice: '50' },
    { skuId: 'X0010139', qty: 5, costPrice: '50' }
  ]);
  const s = engine.saveSale(ctx, {
    items: [
      { skuId: 'X0010138', qty: 1, price: '129', type: 'sale' },
      { skuId: 'X0010139', qty: 1, price: '0', type: 'gift', giftReason: '样品' }
    ],
    payments: [{ method: 'cash', amount: '129' }]
  });
  const giftBefore = ctx.data.ledgers.filter((l) => l.type === L.GIFT_COST && !l.voided).length;
  assert.strictEqual(giftBefore, 1);

  engine.voidSale(ctx, s.doc.no);
  const giftAfter = ctx.data.ledgers.filter((l) => l.type === L.GIFT_COST && !l.voided).length;
  assert.strictEqual(giftAfter, 0, '赠送成本流水随作废消失');
  assert.strictEqual(ctx.getSku('X0010138').stock, 5);
  assert.strictEqual(ctx.getSku('X0010139').stock, 5);
});
