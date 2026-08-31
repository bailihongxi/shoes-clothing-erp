// 问题 4 测试：新建进货单 → 进货明细，支持「批量填写进价」，也可逐行自定义
//
// 需求（用户原话）：
//   进货明细模块，需要设定可以批量填写进价的输入框，批量输入后，所有明细中的价格都会更改。
//   也可每行明细自定义更改进价。
//
// 实现要点（见 js/ui/page-purchase.js）：
//   - form.bulkPrice：批量进价输入框的值（data-input="bulk-price"，只记值不重渲染）；
//   - page.applyBulkPrice(form, value)：纯函数，把值写入全部明细行，带格式校验；
//   - 动作 apply-bulk-price：应用 + 成功/失败提示；
//   - 动作 price：逐行自定义进价（批量应用后仍可单独改）；
//   - add-qty：已填批量进价时，新增行直接沿用该进价。
const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const page = require('../js/ui/page-purchase.js');
const { newCtx } = require('./helpers/ctx.js');

function el(attrs, value) {
  return {
    value: value,
    getAttribute: function (k) {
      return attrs[k] === undefined ? null : attrs[k];
    }
  };
}

function fresh() {
  const ctx = newCtx();
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  const state = page.init(ctx);
  page.actions['open-new'](ctx, state);
  page.actions['pick-style'](ctx, state, el({ 'data-code': 'X001' }));
  return { ctx, state };
}

/* ---------------- ① 纯函数 applyBulkPrice ---------------- */

test('问题4-批量进价：applyBulkPrice 把值写入全部明细行', () => {
  const form = { items: [{ skuId: 'A', qty: 1, costPrice: '50' }, { skuId: 'B', qty: 2, costPrice: '60' }] };
  const r = page.applyBulkPrice(form, '38.5');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.price, 3850, '38.5 元 → 3850 分');
  form.items.forEach((it) => assert.strictEqual(it.costPrice, '38.5', '每行都应同步为批量进价'));
});

test('问题4-批量进价：空值 / 非法格式 / 无明细 → 明确报错且不改数据', () => {
  const form = { items: [{ skuId: 'A', qty: 1, costPrice: '50' }] };

  let r = page.applyBulkPrice(form, '');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('请先填写'), r.error);

  r = page.applyBulkPrice(form, 'abc');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('格式'), r.error);

  r = page.applyBulkPrice(form, '-5');
  assert.strictEqual(r.ok, false, '负数应被拦截');

  r = page.applyBulkPrice(form, '12.345');
  assert.strictEqual(r.ok, false, '超过两位小数应被拦截');

  assert.strictEqual(form.items[0].costPrice, '50', '失败时不得改动原价');

  r = page.applyBulkPrice({ items: [] }, '50');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('明细'), r.error);
});

test('问题4-批量进价：0 元（赠品/试销）允许批量应用', () => {
  const form = { items: [{ skuId: 'A', qty: 1, costPrice: '50' }] };
  const r = page.applyBulkPrice(form, '0');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.price, 0);
  assert.strictEqual(form.items[0].costPrice, '0');
});

/* ---------------- ② 动作链路：批量应用 → 全部同步 ---------------- */

test('问题4-动作：apply-bulk-price 让 4 行明细进价全部变为批量值，合计随之变化', () => {
  const { ctx, state } = fresh();
  ['X0010138', 'X0010139', 'X0010238', 'X0010239'].forEach((id) => {
    page.actions['add-qty'](ctx, state, el({ 'data-sku': id }));
  });
  assert.strictEqual(state.form.items.length, 4);
  // 默认取商品档案进价 50（fenToYuan 返回数字）
  state.form.items.forEach((it) => assert.strictEqual(Number(it.costPrice), 50));

  // 批量改成 42
  page.actions['bulk-price'](ctx, state, el({ 'data-name': 'bulkPrice' }, '42'));
  assert.strictEqual(state.form.bulkPrice, '42');
  const ret = page.actions['apply-bulk-price'](ctx, state);
  assert.notStrictEqual(ret, false, '应用成功应触发重渲染');
  state.form.items.forEach((it) => assert.strictEqual(it.costPrice, '42', '4 行明细都应同步为 42'));

  // 合计 = 4 件 × 42 元
  const html = page.render(ctx, state);
  assert.ok(html.includes('合计 ¥168.00'), '合计应为 168.00：' + (html.match(/合计[^<]*/) || [''])[0]);
});

test('问题4-动作：批量应用失败（未填值）→ 返回 false 不重渲染，明细不变', () => {
  const { ctx, state } = fresh();
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  const ret = page.actions['apply-bulk-price'](ctx, state);
  assert.strictEqual(ret, false);
  assert.strictEqual(Number(state.form.items[0].costPrice), 50);
});

/* ---------------- ③ 逐行自定义仍然可用 ---------------- */

test('问题4-逐行：批量应用后再单独改某一行，只改那一行', () => {
  const { ctx, state } = fresh();
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010139' }));
  page.actions['bulk-price'](ctx, state, el({ 'data-name': 'bulkPrice' }, '40'));
  page.actions['apply-bulk-price'](ctx, state);

  // 单独把 39 码改成 45
  page.actions.price(ctx, state, el({ 'data-sku': 'X0010139' }, '45'));
  const a = state.form.items.find((x) => x.skuId === 'X0010138');
  const b = state.form.items.find((x) => x.skuId === 'X0010139');
  assert.strictEqual(a.costPrice, '40', '未改的行保持批量价');
  assert.strictEqual(b.costPrice, '45', '改过的行使用自定义价');
});

test('问题4-新增行：已填批量进价时，后续新增明细自动沿用该进价', () => {
  const { ctx, state } = fresh();
  page.actions['bulk-price'](ctx, state, el({ 'data-name': 'bulkPrice' }, '33'));
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  assert.strictEqual(state.form.items[0].costPrice, '33', '新增行应沿用批量进价而非档案进价');
});

/* ---------------- ④ 界面与保存 ---------------- */

test('问题4-界面：进货明细区渲染出批量进价输入框与「应用到全部明细」按钮', () => {
  const { ctx, state } = fresh();
  // 空明细时也要能看到批量进价输入框（可先填价再点格子）
  let html = page.render(ctx, state);
  assert.ok(html.includes('批量进价'), '应有「批量进价」标签');
  assert.ok(html.includes('data-input="bulk-price"'), '应有批量进价输入框');
  assert.ok(html.includes('data-act="apply-bulk-price"'), '应有应用按钮');

  // 有明细时，逐行自定义进价输入框仍在
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  html = page.render(ctx, state);
  assert.ok(html.includes('data-change="price"'), '逐行进价输入框仍在');
  assert.ok(html.includes('data-input="bulk-price"'), '批量进价输入框仍在');
});

test('问题4-保存：批量进价参与入库金额计算（进货单 total 使用批量价）', () => {
  const { ctx, state } = fresh();
  page.actions.field(ctx, state, el({ 'data-name': 'newPartner' }, '温州鞋厂'));
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010138' }));
  page.actions['add-qty'](ctx, state, el({ 'data-sku': 'X0010239' }));
  page.actions['bulk-price'](ctx, state, el({ 'data-name': 'bulkPrice' }, '30'));
  page.actions['apply-bulk-price'](ctx, state);
  // 其中一行单独调价
  page.actions.price(ctx, state, el({ 'data-sku': 'X0010239' }, '35'));
  page.actions.field(ctx, state, el({ 'data-name': 'paid' }, '0'));

  assert.strictEqual(page.actions['save-purchase'](ctx, state), true);
  const doc = ctx.data.purchases[0];
  assert.strictEqual(doc.total, 2 * 3000 + 1 * 3500, '2×30 + 1×35 = 95 元');
  assert.strictEqual(ctx.getSku('X0010138').stock, 2);
  assert.strictEqual(ctx.getSku('X0010239').stock, 1);
  // 保存后表单清空，批量进价也一并复位
  assert.strictEqual(state.form.items.length, 0);
  assert.strictEqual(state.form.bulkPrice, '');
});
