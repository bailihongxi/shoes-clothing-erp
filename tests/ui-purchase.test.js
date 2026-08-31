const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const page = require('../js/ui/page-purchase.js');
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  return ctx;
}

function fresh() {
  const ctx = seed(newCtx());
  const state = page.init(ctx);
  return { ctx, state };
}

/** 走完整交互：选供应商 → 选款 → 点两格 → 保存 */
function makePurchase(ctx, state, paid) {
  page.actions['open-new'](ctx, state);
  page.actions.field(ctx, state, { getAttribute: () => 'newPartner', value: '温州鞋厂' });
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010138' });
  page.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010138' });
  page.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010139' });
  page.actions.field(ctx, state, { getAttribute: () => 'paid', value: String(paid) });
  return page.actions['save-purchase'](ctx, state);
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'purchase');
  const { state } = fresh();
  assert.strictEqual(state.tab, 'list');
  assert.strictEqual(state.form.items.length, 0);
});

test('空列表显示引导', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('新建进货单'));
  assert.ok(html.includes('暂无进货单'));
});

test('新建进货单：点矩阵格子批量填数 → 库存 +N、金额与欠款正确', () => {
  const { ctx, state } = fresh();
  assert.strictEqual(makePurchase(ctx, state, 100), true);

  const doc = ctx.data.purchases[0];
  const todayCompact = require('../js/core/util.js').today().replace(/-/g, '');
  assert.strictEqual(doc.no, 'P' + todayCompact + '-001');
  assert.ok(/^P\d{8}-001$/.test(doc.no));
  assert.strictEqual(doc.total, 15000, '3 件 × 50 元');
  assert.strictEqual(doc.paid, 10000);
  assert.strictEqual(doc.debt, 5000);
  assert.strictEqual(ctx.getSku('X0010138').stock, 2);
  assert.strictEqual(ctx.getSku('X0010139').stock, 1);

  // 供应商自动建立并挂账
  const supplier = ctx.data.partners[0];
  assert.strictEqual(supplier.name, '温州鞋厂');
  assert.strictEqual(supplier.balance, 5000);
  // 已付部分生成进货支出流水
  assert.ok(ctx.data.ledgers.some((l) => l.type === 'purchase_expense' && l.amount === 10000));
  // 回到列表
  assert.strictEqual(state.tab, 'list');
});

test('表单页：显示供应商选择、选款 chips 与矩阵', () => {
  const { ctx, state } = fresh();
  page.actions['open-new'](ctx, state);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  const html = page.render(ctx, state);
  assert.ok(html.includes('新建进货单'));
  assert.ok(html.includes('选择供应商'));
  assert.ok(html.includes('即时新建供应商'));
  assert.ok(html.includes('小白鞋'));
  assert.ok(html.includes('点格子数量 +1'));
  assert.ok(html.includes('data-act="add-qty"'));
});

test('明细行可直接改数量与进价，小计与合计同步', () => {
  const { ctx, state } = fresh();
  page.actions['open-new'](ctx, state);
  page.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  page.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010138' });

  page.actions.qty(ctx, state, { getAttribute: () => 'X0010138', value: '4' });
  page.actions.price(ctx, state, { getAttribute: () => 'X0010138', value: '55' });
  assert.strictEqual(state.form.items[0].qty, 4);
  assert.strictEqual(state.form.items[0].costPrice, '55');

  const html = page.render(ctx, state);
  assert.ok(html.includes('¥220.00'), '4 × 55 = 220');
  assert.ok(html.includes('已付 = 合计'));

  page.actions['quick-paid'](ctx, state);
  assert.strictEqual(util_parse(state.form.paid), 22000);
  page.actions['del-item'](ctx, state, { getAttribute: () => 'X0010138' });
  assert.strictEqual(state.form.items.length, 0);
});

function util_parse(v) {
  return Math.round(Number(v) * 100);
}

test('校验：无供应商、无明细时保存失败且不产生脏数据', () => {
  const { ctx, state } = fresh();
  page.actions['open-new'](ctx, state);
  assert.strictEqual(page.actions['save-purchase'](ctx, state), false);
  assert.strictEqual(ctx.data.purchases.length, 0);

  page.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010138' });
  assert.strictEqual(page.actions['save-purchase'](ctx, state), false, '缺供应商');
  assert.strictEqual(ctx.data.purchases.length, 0);
});

test('列表：显示金额/已付/欠款/状态，并支持筛选与查看明细', () => {
  const { ctx, state } = fresh();
  makePurchase(ctx, state, 100);
  let html = page.render(ctx, state);
  assert.ok(html.includes('P20260831-001'.replace('20260831', require('../js/core/util.js').today().replace(/-/g, ''))));
  assert.ok(html.includes('温州鞋厂'));
  assert.ok(html.includes('¥150.00'));
  assert.ok(html.includes('¥50.00'));
  assert.ok(html.includes('未结清'));

  page.actions['view-doc'](ctx, state, { getAttribute: () => ctx.data.purchases[0].no });
  html = page.render(ctx, state);
  assert.ok(html.includes('进货单'));
  assert.ok(html.includes('小计'));
  page.actions['close-view'](ctx, state);
  assert.strictEqual(state.viewNo, null);

  // 按供应商筛选
  page.actions.filter(ctx, state, { getAttribute: () => 'partnerId', value: ctx.data.partners[0].id });
  assert.ok(page.render(ctx, state).includes('温州鞋厂'));
  page.actions.filter(ctx, state, { getAttribute: () => 'partnerId', value: 'not-exist' });
  assert.ok(page.render(ctx, state).includes('暂无进货单'));
});

test('修改：仅未结清可改，改后欠款重算；已结清拒绝修改', () => {
  const { ctx, state } = fresh();
  makePurchase(ctx, state, 100); // 欠 50
  const no = ctx.data.purchases[0].no;

  page.actions['edit-purchase'](ctx, state, { getAttribute: () => no });
  assert.strictEqual(state.form.editNo, no);
  assert.strictEqual(state.form.items.length, 2);
  page.actions.field(ctx, state, { getAttribute: () => 'paid', value: '150' });
  assert.strictEqual(page.actions['update-purchase'](ctx, state), true);
  assert.strictEqual(ctx.getDoc('purchases', no).debt, 0);
  assert.strictEqual(ctx.data.partners[0].balance, 0);
  assert.strictEqual(ctx.getSku('X0010138').stock, 2, '库存不应重复累加');

  // 已结清后不能再改
  page.actions['edit-purchase'](ctx, state, { getAttribute: () => no });
  assert.strictEqual(page.actions['update-purchase'](ctx, state), false);
});

test('作废：库存与欠款回滚，列表标记已作废', () => {
  const { ctx, state } = fresh();
  makePurchase(ctx, state, 100);
  const no = ctx.data.purchases[0].no;
  assert.strictEqual(ctx.getSku('X0010138').stock, 2);

  // 走内部作废（ui.confirm 在无 DOM 环境返回 true 的分支）
  const res = engine.voidPurchase(ctx, no);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 0);
  assert.strictEqual(ctx.data.partners[0].balance, 0);
  assert.ok(ctx.data.ledgers.every((l) => l.voided === true || l.type !== 'purchase_expense' || l.voided));
  const html = page.render(ctx, state);
  assert.ok(html.includes('已作废'));
  assert.ok(!html.includes('data-act="void-purchase"'), '已作废单据不再显示作废按钮');
});
