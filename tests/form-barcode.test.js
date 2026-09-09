/**
 * 问题1：建档表单加「扫码」按钮 + 吊牌条码输入框
 * - coding.preview/create 支持 input.barcode（吊牌条码）：一码一款，全色码共用吊牌条码；
 * - 与既有条码冲突时报错；留空仍自动生成；
 * - 表单含条码输入框 + 📷 扫码动作（scan-form-barcode），扫码结果写入 form.barcode；
 * - 编辑模式条码只读显示。
 */
const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const schema = require('../js/core/schema.js');
const { newCtx } = require('./helpers/ctx.js');

function baseInput() {
  return {
    name: '帆布鞋', category: '鞋', colors: ['白'], sizes: ['38', '39'],
    costPrice: '50', salePrice: '129'
  };
}

test('preview：指定吊牌条码 → 全部色码共用吊牌条码，款级 barcode 同步', () => {
  const ctx = newCtx();
  const pv = coding.preview(Object.assign(baseInput(), { barcode: '6921734900011' }), ctx);
  assert.ok(pv.ok, '应预览成功: ' + (pv.errors || []).join('；'));
  assert.strictEqual(pv.rows.length, 2);
  pv.rows.forEach((r) => {
    assert.strictEqual(r.barcode, '6921734900011', '每个色码条码 = 吊牌条码');
  });
  assert.strictEqual(pv.barcode, '6921734900011');
});

test('create：带吊牌条码建档 → 落库 barcode 与 barcodeSource=hangtag', () => {
  const ctx = newCtx();
  const r = coding.create(Object.assign(baseInput(), { barcode: '6921734900011' }), ctx);
  assert.ok(r.ok, '建档应成功: ' + (r.errors || []).join('；'));
  const p = ctx.getProduct(r.styleCode);
  assert.strictEqual(p.barcode, '6921734900011');
  assert.strictEqual(p.barcodeSource, schema.BARCODE_SOURCE.HANGTAG);
  const skus = ctx.skusOf(r.styleCode);
  assert.ok(skus.length === 2, '2 个色码');
  skus.forEach((s) => assert.strictEqual(s.barcode, '6921734900011'));
  // 扫码 resolve：吊牌条码 → 命中该款
  const scan = require('../js/barcode/scan.js');
  const res = scan.resolve(ctx, '6921734900011');
  assert.ok(res.found && res.product.styleCode === r.styleCode, '扫吊牌条码应命中该款');
});

test('create：不留条码 → 自动生成（barcodeSource=system）', () => {
  const ctx = newCtx();
  const r = coding.create(baseInput(), ctx);
  assert.ok(r.ok);
  const p = ctx.getProduct(r.styleCode);
  assert.ok(p.barcode, '应有自动条码');
  assert.strictEqual(p.barcodeSource, schema.BARCODE_SOURCE.SYSTEM);
});

test('preview：吊牌条码与其他款冲突 → 报错', () => {
  const ctx = newCtx();
  assert.ok(coding.create(Object.assign(baseInput(), { barcode: '6921734900011' }), ctx).ok);
  const pv2 = coding.preview(Object.assign(baseInput(), { name: '另一款鞋', barcode: '6921734900011' }), ctx);
  assert.ok(!pv2.ok && pv2.errors.some((e) => /已被其他款/.test(e)), '冲突应报错: ' + pv2.errors.join('；'));
});

test('表单渲染：含吊牌条码输入框与 📷 扫码按钮（data-act=scan-form-barcode）', () => {
  const page = require('../js/ui/page-product.js');
  const ctx = newCtx();
  const state = page.init(ctx);
  state.tab = 'new';
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-name="barcode"'), '应有条码输入框');
  assert.ok(html.includes('data-act="scan-form-barcode"'), '应有扫码按钮');
  assert.ok(html.includes('吊牌条码'), '应有吊牌条码标签');
});

test('scan-form-barcode 动作：扫码结果写入 form.barcode', () => {
  const page = require('../js/ui/page-product.js');
  const ctx = newCtx();
  const state = page.init(ctx);
  state.tab = 'new';
  const captured = {};
  const savedScan = global.ERP.scan;
  global.ERP.scan = { start(opts) { captured.opts = opts; } };
  try {
    page.actions['scan-form-barcode'](ctx, state);
    assert.ok(captured.opts && typeof captured.opts.onResult === 'function', '应启动扫码');
    captured.opts.onResult('6921734900022');
    assert.strictEqual(state.form.barcode, '6921734900022');
  } finally {
    global.ERP.scan = savedScan;
  }
});

test('scan-form-barcode 动作：扫码结果后触发 UI 重渲染（条码自动填入输入框，V1.3-5 修复）', () => {
  const page = require('../js/ui/page-product.js');
  const ctx = newCtx();
  const state = page.init(ctx);
  state.tab = 'new';
  const captured = {};
  const savedScan = global.ERP.scan;
  const savedApp = global.ERP.app;
  let renderCalls = 0;
  const savedWindow = global.window;
  // window.ERP 与闭包 ERP 必须同一引用（page-product.js 闭包 var ERP = root.ERP）
  global.window = { ERP: global.ERP };
  global.ERP.app = { render() { renderCalls++; } };
  global.ERP.scan = { start(opts) { captured.opts = opts; } };
  try {
    page.actions['scan-form-barcode'](ctx, state);
    captured.opts.onResult('6921734900022');
    assert.strictEqual(renderCalls, 1, '扫码结果后必须调用 ERP.app.render() 刷新表单');
    // 重渲染后输入框应显示条码
    const html = page.render(ctx, state);
    assert.ok(html.includes('value="6921734900022"'), '重渲染后条码输入框应显示扫码结果');
  } finally {
    global.ERP.scan = savedScan;
    global.ERP.app = savedApp;
    global.window = savedWindow;
  }
});

test('商品搜索框扫码动作：扫码结果写入 keyword 并触发重渲染（V1.3-5 修复）', () => {
  const page = require('../js/ui/page-product.js');
  const ctx = newCtx();
  const state = page.init(ctx);
  const captured = {};
  const savedScan = global.ERP.scan;
  const savedApp = global.ERP.app;
  let renderCalls = 0;
  const savedWindow = global.window;
  global.window = { ERP: global.ERP };
  global.ERP.app = { render() { renderCalls++; } };
  global.ERP.scan = {
    start(opts) { captured.opts = opts; },
    resolve() { return null; }
  };
  try {
    page.actions['scan'](ctx, state);
    assert.ok(captured.opts && typeof captured.opts.onResult === 'function', '应启动扫码');
    captured.opts.onResult('6921734900022');
    assert.strictEqual(state.keyword, '6921734900022');
    assert.strictEqual(renderCalls, 1, '扫码结果后必须调用 ERP.app.render() 刷新搜索框与列表');
  } finally {
    global.ERP.scan = savedScan;
    global.ERP.app = savedApp;
    global.window = savedWindow;
  }
});

test('编辑模式：条码输入框禁用（只读）且无扫码按钮', () => {
  const page = require('../js/ui/page-product.js');
  const ctx = newCtx();
  const r = coding.create(Object.assign(baseInput(), { barcode: '6921734900033' }), ctx);
  const state = page.init(ctx);
  state.tab = 'new';
  state.editing = r.styleCode;
  state.form = {
    name: '帆布鞋', category: '鞋', brand: '', costPrice: '', salePrice: '',
    threshold: '3', colors: [], sizes: [], styleCode: r.styleCode, barcode: '6921734900033'
  };
  const html = page.render(ctx, state);
  assert.ok(html.includes('disabled'), '编辑模式条码应禁用');
  assert.ok(!html.includes('scan-form-barcode'), '编辑模式不应有扫码按钮');
});
