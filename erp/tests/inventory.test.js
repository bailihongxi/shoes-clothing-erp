const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const inv = require('../js/core/inventory.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');

/** 建一款：白/黑 × 38/39，进价 50 售价 129 */
function seed(ctx) {
  coding.create(
    {
      name: '小白鞋',
      category: '鞋',
      colors: ['白', '黑'],
      sizes: ['38', '39'],
      costPrice: '50',
      salePrice: '129'
    },
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

/* ---------- PRD 10.1-①：进货 +3、销售 −2 → 库存 1 ---------- */

test('10.1-① 新建商品 → 进货 3 件 → 库存 3；销售 2 件 → 库存 1，且流水留痕', () => {
  const ctx = seed(newCtx());
  const skuId = 'X0010138';

  const p = purchase(ctx, [{ skuId: skuId, qty: 3, costPrice: '50' }]);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(ctx.getSku(skuId).stock, 3);

  const sale = {
    no: 'S20260831-001',
    date: '2026-08-31',
    type: 'sale',
    items: [{ skuId: skuId, styleCode: 'X001', qty: 2, price: 12900, costSnapshot: 5000, type: 'sale' }],
    received: 25800
  };
  const applied = inv.applySale(ctx, sale);
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(ctx.getSku(skuId).stock, 1);

  const logs = inv.logsOfSku(ctx, skuId);
  assert.strictEqual(logs.length, 2);
  assert.strictEqual(logs[0].delta, -2);
  assert.strictEqual(logs[0].balance, 1);
  assert.strictEqual(logs[0].refNo, 'S20260831-001');
  const inc = logs.find((l) => l.delta === 3);
  assert.strictEqual(inc.balance, 3);
  assert.strictEqual(inc.refType, 'purchase');
});

test('库存不足时拒绝出库，且不会产生负库存', () => {
  const ctx = seed(newCtx());
  const sale = {
    no: 'S1',
    date: '2026-08-31',
    type: 'sale',
    items: [{ skuId: 'X0010138', qty: 1, price: 12900, costSnapshot: 5000, type: 'sale' }]
  };
  const r = inv.applySale(ctx, sale);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].includes('库存不足'));
  assert.strictEqual(ctx.getSku('X0010138').stock, 0);
  assert.strictEqual(ctx.data.stockLogs.length, 0);
});

test('赠送出库与退货入库方向正确（仅影响对应色码）', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 5, costPrice: '50' },
    { skuId: 'X0010139', qty: 5, costPrice: '50' }
  ]);

  inv.applySale(ctx, {
    no: 'S1',
    date: '2026-08-31',
    type: 'sale',
    items: [{ skuId: 'X0010138', qty: 1, price: 0, costSnapshot: 5000, type: 'gift', giftReason: '赠品' }]
  });
  assert.strictEqual(ctx.getSku('X0010138').stock, 4);
  assert.strictEqual(ctx.getSku('X0010139').stock, 5, '其他色码不应受影响');
  assert.strictEqual(inv.logsOfSku(ctx, 'X0010138')[0].refType, 'gift');

  inv.applySale(ctx, {
    no: 'R1',
    date: '2026-08-31',
    type: 'refund',
    items: [{ skuId: 'X0010138', qty: 2, price: 12900, costSnapshot: 5000, type: 'sale' }]
  });
  assert.strictEqual(ctx.getSku('X0010138').stock, 6);
  assert.strictEqual(inv.logsOfSku(ctx, 'X0010138')[0].delta, 2);
});

/* ---------- PRD 10.3：库存与预警 ---------- */

test('10.3-① 阈值 3，库存降到 2 → 进入预警列表并计入首页预警款数', () => {
  const ctx = seed(newCtx());
  // 四个色码各进 3 件（等于阈值，不预警）
  purchase(ctx, ['X0010138', 'X0010139', 'X0010238', 'X0010239'].map((id) => ({
    skuId: id,
    qty: 3,
    costPrice: '50'
  })));
  assert.strictEqual(inv.getAlerts(ctx).length, 0);
  assert.strictEqual(inv.alertStyleCount(ctx), 0);

  // 卖掉 1 件 白/38 → 库存 2 < 阈值 3
  inv.applySale(ctx, {
    no: 'S1',
    date: '2026-08-31',
    type: 'sale',
    items: [{ skuId: 'X0010138', qty: 1, price: 12900, costSnapshot: 5000, type: 'sale' }]
  });
  const alerts = inv.getAlerts(ctx);
  assert.ok(alerts.some((a) => a.skuId === 'X0010138'), '库存 2 < 阈值 3 应预警');
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(inv.alertStyleCount(ctx), 1, '首页预警款数按款去重');

  // 补货回到 3 → 预警消失
  purchase(ctx, [{ skuId: 'X0010138', qty: 1, costPrice: '50' }]);
  assert.strictEqual(ctx.getSku('X0010138').stock, 3);
  assert.strictEqual(inv.getAlerts(ctx).length, 0);
});

test('10.3-① 停售的款不进预警；库存为 0 单列为缺码', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 1, costPrice: '50' }]);
  ctx.getProduct('X001').status = 'off';
  assert.strictEqual(inv.getAlerts(ctx).length, 0);
  assert.strictEqual(inv.getAlerts(ctx, { includeOff: true }).length, 4);

  const empties = inv.getAlerts(ctx, { includeOff: true, onlyEmpty: true });
  assert.strictEqual(empties.length, 3, '除 X0010138 外其余 3 个色码为 0');
  assert.ok(empties.every((a) => a.empty));
});

test('10.3-② 盘点差异：生成盘点单、库存更新为实盘数、差异留痕', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 5, costPrice: '50' }]);

  const res = engine.saveStocktake(ctx, {
    date: '2026-08-31',
    styleCode: 'X001',
    counts: { X0010138: 4, X0010139: 2 }
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.doc.no, 'T20260831-001');
  assert.strictEqual(res.doc.diffQty, 1, '−1 + 2 = +1');
  assert.strictEqual(res.doc.items.length, 2);

  assert.strictEqual(ctx.getSku('X0010138').stock, 4);
  assert.strictEqual(ctx.getSku('X0010139').stock, 2);
  const it38 = res.doc.items.find((i) => i.skuId === 'X0010138');
  assert.strictEqual(it38.bookQty, 5);
  assert.strictEqual(it38.realQty, 4);
  assert.strictEqual(it38.diff, -1);

  const logs = inv.logsOfSku(ctx, 'X0010138');
  assert.strictEqual(logs[0].refType, 'stocktake');
  assert.strictEqual(logs[0].delta, -1);
});

test('盘点：实盘数非法或未录入要报错，不改变库存', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 5, costPrice: '50' }]);
  assert.strictEqual(engine.saveStocktake(ctx, { counts: {} }).ok, false);
  assert.strictEqual(engine.saveStocktake(ctx, { counts: { X0010138: -1 } }).ok, false);
  assert.strictEqual(engine.saveStocktake(ctx, { counts: { NONE: 1 } }).ok, false);
  assert.strictEqual(ctx.getSku('X0010138').stock, 5);
});

/* ---------- 矩阵与查询 ---------- */

test('颜色×尺码矩阵：行=颜色、列=尺码，每格给出库存与 SKU id', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 3, costPrice: '50' },
    { skuId: 'X0010239', qty: 1, costPrice: '50' }
  ]);
  const m = inv.buildMatrix(ctx, 'X001');
  assert.deepStrictEqual(m.colors, ['白', '黑']);
  assert.deepStrictEqual(m.sizes, ['38', '39']);
  assert.strictEqual(m.cells['白|38'].stock, 3);
  assert.strictEqual(m.cells['黑|39'].stock, 1);
  assert.strictEqual(m.cells['白|38'].skuId, 'X0010138');
  assert.strictEqual(m.cells['白|38'].price, 12900);
});

test('矩阵尺码按自然序排列（数字在前、半码正确）', () => {
  const ctx = newCtx();
  coding.create({ name: 'A', category: '鞋', colors: ['白'], sizes: ['40', '38', '39', '38.5', 'XL'] }, ctx);
  const m = inv.buildMatrix(ctx, 'X001');
  assert.deepStrictEqual(m.sizes, ['38', '38.5', '39', '40', 'XL']);
  // id 用清洗后的编码（38.5 → 385）
  assert.ok(ctx.data.skus.some((s) => s.id === 'X00101385' && s.size === '38.5'));
});

test('库存资金占用 = Σ(库存 × 最新进价)，进货后按新进价更新', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [{ skuId: 'X0010138', qty: 3, costPrice: '50' }]);
  assert.strictEqual(inv.stockValue(ctx), 15000, '3 × 50 元');
  purchase(ctx, [{ skuId: 'X0010138', qty: 1, costPrice: '60' }]);
  assert.strictEqual(inv.stockValue(ctx), 24000, '4 件 × 最新进价 60');
});

test('作废回滚：库存回到进货前，且留下反向流水', () => {
  const ctx = seed(newCtx());
  const p = purchase(ctx, [{ skuId: 'X0010138', qty: 3, costPrice: '50' }]);
  assert.strictEqual(ctx.getSku('X0010138').stock, 3);

  const r = engine.voidPurchase(ctx, p.doc.no);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 0);
  assert.strictEqual(ctx.getDoc('purchases', p.doc.no).voided, true);
  const logs = inv.logsOfSku(ctx, 'X0010138');
  assert.strictEqual(logs[0].delta, -3);
  assert.strictEqual(logs[0].refType, 'void');
  assert.strictEqual(engine.voidPurchase(ctx, p.doc.no).ok, false, '不能重复作废');
});

test('色码总库存与款库存汇总', () => {
  const ctx = seed(newCtx());
  purchase(ctx, [
    { skuId: 'X0010138', qty: 2, costPrice: '50' },
    { skuId: 'X0010238', qty: 3, costPrice: '50' }
  ]);
  assert.strictEqual(inv.stockOfStyle(ctx, 'X001'), 5);
});
