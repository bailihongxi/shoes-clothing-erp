// 问题 1 修复测试：进货「新建进货单」与商品「新款建档」模块可用性 + 加载速度
// 覆盖：输入法组合不打断中文、选款搜索实时过滤、已付金额实时联动欠款预览
const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const purchase = require('../js/ui/page-purchase.js');
const product = require('../js/ui/page-product.js');
require('../js/app.js'); // 副作用：挂载到 globalThis.ERP.app
const app = globalThis.ERP.app;
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' }, ctx);
  coding.create({ name: '运动鞋X', category: '鞋', colors: ['蓝'], sizes: ['40'], costPrice: '80', salePrice: '200' }, ctx);
  return ctx;
}

/* ---------- 输入法（IME）处理：避免中文输入被打断 ---------- */

test('app._isComposing：组合输入中返回 true，输入法事件处理应忽略', () => {
  assert.strictEqual(app._isComposing({ isComposing: true }, {}), true);
  assert.strictEqual(app._isComposing({}, { isComposing: true }), true);
  assert.strictEqual(app._isComposing({ composing: true }, {}), true);
  assert.strictEqual(app._isComposing({}, {}), false);
  assert.strictEqual(app._isComposing(null, {}), false);
});

test('app._isLive：仅 data-live="1" 字段需要实时重渲染并恢复焦点', () => {
  assert.strictEqual(app._isLive({ getAttribute: () => '1' }), true);
  assert.strictEqual(app._isLive({ getAttribute: () => null }), false);
  assert.strictEqual(app._isLive(null), false);
});

/* ---------- 进货：选款搜索实时过滤（问题根因之一） ---------- */

test('进货表单：选款搜索框带 data-live="1"，输入即触发浏览器重渲染过滤', () => {
  const ctx = seed(newCtx());
  const state = purchase.init(ctx);
  purchase.actions['open-new'](ctx, state);
  const html = purchase.render(ctx, state);
  // 搜索框必须带 data-live="1"，否则浏览器里输入不会重渲染、款号搜索“没反应”
  assert.ok(/data-input="form-keyword"[^>]*data-live="1"/.test(html), '搜索框应带 data-live="1"');
  assert.ok(html.includes('小白鞋') && html.includes('运动鞋X'), '初始应同时展示两款');
});

test('进货表单：form-keyword 动作按款号过滤，仅展示命中款', () => {
  const ctx = seed(newCtx());
  const state = purchase.init(ctx);
  purchase.actions['open-new'](ctx, state);
  // 模拟在搜索框输入“X002”后浏览器因 data-live 触发的重渲染
  purchase.actions['form-keyword'](ctx, state, { getAttribute: () => 'X002', value: 'X002' });
  const html = purchase.render(ctx, state);
  assert.ok(html.includes('运动鞋X'), '应展示命中款');
  assert.ok(!html.includes('小白鞋'), '未命中款应被过滤');
  // 清空关键字后恢复全部
  purchase.actions['form-keyword'](ctx, state, { getAttribute: () => '', value: '' });
  const html2 = purchase.render(ctx, state);
  assert.ok(html2.includes('小白鞋') && html2.includes('运动鞋X'), '清空后恢复全部');
});

/* ---------- 进货：已付金额实时联动“本次欠款”预览 ---------- */

test('进货表单：已付金额带 data-live="1"，改已付即联动本次欠款预览', () => {
  const ctx = seed(newCtx());
  const state = purchase.init(ctx);
  purchase.actions['open-new'](ctx, state);
  purchase.actions['pick-style'](ctx, state, { getAttribute: () => 'X001' });
  purchase.actions['add-qty'](ctx, state, { getAttribute: () => 'X0010138' }); // 1 件 × 50 = 50 元
  let html = purchase.render(ctx, state);
  assert.ok(html.includes('¥50.00'), '未付时本次欠款应为合计 50');

  // 输入已付 30（data-live 会让浏览器重渲染，此处直接渲染验证预览联动）
  purchase.actions.field(ctx, state, { getAttribute: () => 'paid', value: '30' });
  html = purchase.render(ctx, state);
  assert.ok(html.includes('¥20.00'), '已付 30 后本次欠款应为 20，实际：' + html.match(/本次欠款[^¥]*¥[\d.]+/));
  assert.ok(/data-input="field"[^>]*data-name="paid"[^>]*data-live="1"/.test(html), '已付框应带 data-live="1"');
});

/* ---------- 商品建档：中文名可正常输入（IME 修复）+ 实时预览 ---------- */

test('商品建档：名称框带 data-live="1"，中文名可正常预览出款号', () => {
  const ctx = newCtx();
  const state = product.init(ctx);
  product.actions['open-new'](ctx, state);
  let html = product.render(ctx, state);
  assert.ok(/data-input="field"[^>]*data-name="name"[^>]*data-live="1"/.test(html), '名称框应带 data-live="1"');

  // 模拟输入法：组合中（compositionupdate）不应更新、结束（compositionend）才生效
  // 这里验证最终态——中文名能进入预览并生成款号/条码
  product.actions.field(ctx, state, { getAttribute: () => 'name', value: '雪地靴' });
  state.form.colors = ['白'];
  state.form.sizes = ['38'];
  html = product.render(ctx, state);
  assert.ok(html.includes('雪地靴'), '中文商品名应正常显示');
  assert.ok(html.includes('新开款'), '应进入“新开款”预览分支');
  assert.ok(/将生成：款号 <b>[A-Z]\d+<\/b>/.test(html), '应生成款号');
});

test('商品建档：完整填 4 项后能保存落库（端到端可用）', () => {
  const ctx = newCtx();
  const state = product.init(ctx);
  product.actions['open-new'](ctx, state);
  product.actions.field(ctx, state, { getAttribute: () => 'name', value: '小白鞋' });
  product.actions['toggle-color'](ctx, state, { getAttribute: () => '白' });
  product.actions['toggle-size'](ctx, state, { getAttribute: () => '38' });
  product.actions.field(ctx, state, { getAttribute: () => 'costPrice', value: '50' });
  product.actions.field(ctx, state, { getAttribute: () => 'salePrice', value: '129' });
  const r = product.actions['save-product'](ctx, state);
  assert.strictEqual(r, true, '保存应成功');
  assert.strictEqual(ctx.data.products.length, 1, '应落库 1 款');
  assert.strictEqual(ctx.data.skus.length, 1, '应生成 1 个色码');
  assert.strictEqual(ctx.data.products[0].name, '小白鞋');
});
