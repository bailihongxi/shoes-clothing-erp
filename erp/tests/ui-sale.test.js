const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const page = require('../js/ui/page-sale.js');
const { newCtx } = require('./helpers/ctx.js');

function fresh() {
  const ctx = newCtx();
  const state = page.init(ctx);
  return { ctx, state };
}
function seed(ctx) {
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  engine.savePurchase(ctx, {
    date: '2026-08-31', partnerName: '温州鞋厂',
    items: [{ skuId: 'X0010138', qty: 5, costPrice: '50' }, { skuId: 'X0010239', qty: 5, costPrice: '50' }],
    paid: 99999
  });
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'sale');
  const { state } = fresh();
  assert.strictEqual(state.tab, 'new');
  assert.strictEqual(state.form.items.length, 0);
});

test('开单页空态：引导搜索选品', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('搜索选品'));
  assert.ok(html.includes('还没有商品'));
});

test('选款 → 矩阵出现 → 点格子加入明细', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  let html = page.render(ctx, state);
  assert.ok(html.includes('add-sale'), '矩阵格子应可点击加入');

  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  assert.strictEqual(state.form.items.length, 1);
  assert.strictEqual(state.form.items[0].skuId, 'X0010138');
  html = page.render(ctx, state);
  assert.ok(html.includes('白 / 38'));
  assert.ok(html.includes('保存并出单'));
});

test('同一个色码再次加入 → 数量累加', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  assert.strictEqual(state.form.items.length, 1);
  assert.strictEqual(state.form.items[0].qty, 2);
});

test('赠送切换：行变为赠送、单价置 0、可选原因', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  page.actions['toggle-gift'](ctx, state, { getAttribute: () => 'X0010138' });
  const it = state.form.items[0];
  assert.strictEqual(it.type, 'gift');
  assert.strictEqual(it.price, 0);
  const html = page.render(ctx, state);
  assert.ok(html.includes('赠品'), '应有赠送原因下拉');
});

test('保存现金销售单：落库、库存减少、出现在记录', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  state.form.pay.cash = '129'; // 收 129 元（1 件 × 129）

  const r = page.actions['save-sale'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.data.sales.length, 1);
  assert.strictEqual(ctx.getSku('X0010138').stock, 4, '5 − 1 = 4');
  assert.strictEqual(ctx.data.sales[0].payable, 12900);

  state.tab = 'list';
  const listHtml = page.render(ctx, state);
  assert.ok(listHtml.includes(ctx.data.sales[0].no));
});

test('欠款单未选客户 → 拒绝保存', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  state.form.useDebt = true; // 余款记欠款，但不选客户
  const r = page.actions['save-sale'](ctx, state);
  assert.strictEqual(r, false);
  assert.strictEqual(ctx.data.sales.length, 0);
});

test('退货流程：打开退货 → 退 1 件 → 库存回补、生成退货单', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010239' });
  state.form.pay.cash = '258';
  page.actions['save-sale'](ctx, state);
  const no = ctx.data.sales[0].no;
  assert.strictEqual(ctx.getSku('X0010138').stock, 4);

  // 退 白/38 一件
  page.actions['open-refund'](ctx, state, { getAttribute: () => no });
  assert.strictEqual(state.refundNo, no);
  state.refundQty['X0010138'] = 1;
  const rr = page.actions['do-refund'](ctx, state);
  assert.strictEqual(rr, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 5, '退货入库 4 → 5');
  const refund = ctx.data.sales.find((s) => s.type === 'refund');
  assert.ok(refund, '应生成退货单');
  assert.strictEqual(refund.refNo, no);
});

test('作废：销售单作废后标记 voided、库存回滚', async () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-sale'](ctx, state, { getAttribute: () => 'X0010138' });
  state.form.pay.cash = '129';
  page.actions['save-sale'](ctx, state);
  const no = ctx.data.sales[0].no;
  assert.strictEqual(ctx.getSku('X0010138').stock, 4);

  await page.actions['void-sale'](ctx, state, { getAttribute: () => no });
  assert.strictEqual(ctx.getDoc('sales', no).voided, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 5, '库存回滚');
});

test('扫码输入条码 → 定位到该款并展开矩阵', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['scan-input'](ctx, state, { value: 'X001' });
  assert.strictEqual(state.form.styleCode, 'X001');
  const html = page.render(ctx, state);
  assert.ok(html.includes('add-sale'));
});
