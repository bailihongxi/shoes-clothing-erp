const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const page = require('../js/ui/page-product.js');
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
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'product');
  assert.strictEqual(page.title, '商品档案');
  const { state } = fresh();
  assert.strictEqual(state.tab, 'list');
  assert.strictEqual(state.form.colors.length, 0);
  assert.strictEqual(state.form.category, '鞋');
});

test('空列表：显示引导而不是报错', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('新款建档'));
  assert.ok(html.includes('没有匹配的商品'));
});

test('列表：显示款号、名称、售价、条码、色码数与库存', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('X001'));
  assert.ok(html.includes('小白鞋'));
  assert.ok(html.includes('¥129.00'));
  assert.ok(html.includes('4</td>'), '应有 4 个色码');
  assert.ok(html.includes('CSV 导入'));
});

test('列表：按款号/名称/条码搜索能过滤', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  coding.create({ name: '纯棉T恤', category: '服装', colors: ['白'], sizes: ['M'] }, ctx);

  state.keyword = 'F001';
  let html = page.render(ctx, state);
  assert.ok(html.includes('纯棉T恤'));
  assert.ok(!html.includes('小白鞋'));

  state.keyword = '小白';
  html = page.render(ctx, state);
  assert.ok(html.includes('小白鞋'));
  assert.ok(!html.includes('纯棉T恤'));

  // 扫码/扫描枪输入条码 → 定位到该款
  page.actions['scan-input'](ctx, state, { value: 'X001' });
  html = page.render(ctx, state);
  assert.ok(html.includes('小白鞋'));
  assert.ok(!html.includes('纯棉T恤'));
});

test('列表：有无条码 / 打印状态 / 在售状态筛选', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  coding.create({ name: '纯棉T恤', category: '服装', colors: ['白'], sizes: ['M'] }, ctx);
  ctx.data.products[1].printedAt = '2026-08-31T10:00:00';

  state.filterPrinted = 'printed';
  let html = page.render(ctx, state);
  assert.ok(html.includes('纯棉T恤') && !html.includes('小白鞋'));

  state.filterPrinted = 'all';
  state.filterStatus = 'off';
  html = page.render(ctx, state);
  assert.ok(html.includes('没有匹配的商品'));

  state.filterStatus = 'all';
  state.filterBarcode = 'has';
  html = page.render(ctx, state);
  assert.ok(html.includes('小白鞋') && html.includes('纯棉T恤'));
});

test('建档：填 4 项后实时预览出款号与条码，切换类别换尺码预置', () => {
  const { ctx, state } = fresh();
  page.actions['open-new'](ctx, state);
  state.form.name = '小白鞋';
  state.form.colors = ['白'];
  state.form.sizes = ['38'];
  let html = page.render(ctx, state);
  assert.ok(html.includes('将生成：款号 <b>X001</b>'), html);
  assert.ok(html.includes('<b>X001</b>'));
  assert.ok(html.includes('X0010138'));
  assert.ok(html.includes('新开款'));

  // 同款再次建档 → 提示复用
  seed(ctx);
  html = page.render(ctx, state);
  assert.ok(html.includes('复用同款 X001'));
  assert.ok(html.includes('跳过重复 1 个'));

  page.actions.field(ctx, state, { getAttribute: () => 'category', value: '服装' });
  assert.strictEqual(state.form.category, '服装');
});

test('建档：勾选 2 色 × 3 码 → 预览 6 个色码，保存后落库', () => {
  const { ctx, state } = fresh();
  page.actions['open-new'](ctx, state);
  state.form.name = '老爹鞋';
  ['白', '黑'].forEach((c) => page.actions['toggle-color'](ctx, state, { getAttribute: () => c }));
  ['38', '39', '40'].forEach((s) => page.actions['toggle-size'](ctx, state, { getAttribute: () => s }));
  assert.deepStrictEqual(state.form.colors, ['白', '黑']);
  assert.deepStrictEqual(state.form.sizes, ['38', '39', '40']);

  let html = page.render(ctx, state);
  assert.ok(html.includes('新增 <b>6</b> 个色码'));

  page.actions.field(ctx, state, { getAttribute: () => 'costPrice', value: '50' });
  page.actions.field(ctx, state, { getAttribute: () => 'salePrice', value: '129' });
  assert.strictEqual(page.actions['save-product'](ctx, state), true);
  assert.strictEqual(ctx.data.skus.length, 6);
  assert.strictEqual(ctx.data.products[0].salePrice, 12900);
  assert.strictEqual(state.tab, 'list');
});

test('建档：重复勾选可取消（toggle 双向）', () => {
  const { state } = fresh();
  const el = { getAttribute: () => '白' };
  page.actions['toggle-color'](null, state, el);
  assert.deepStrictEqual(state.form.colors, ['白']);
  page.actions['toggle-color'](null, state, el);
  assert.deepStrictEqual(state.form.colors, []);
});

test('编辑：改名改价 + 改款号 → SKU id 与条码同步', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['edit-product'](ctx, state, { getAttribute: () => 'X001' });
  assert.strictEqual(state.editing, 'X001');
  assert.strictEqual(state.form.name, '小白鞋');

  page.actions.field(ctx, state, { getAttribute: () => 'styleCode', value: 'X100' });
  page.actions.field(ctx, state, { getAttribute: () => 'salePrice', value: '139' });
  assert.strictEqual(page.actions['save-product'](ctx, state), true);
  assert.strictEqual(ctx.getProduct('X100').salePrice, 13900);
  assert.ok(ctx.getSku('X1000138'));
  assert.ok(!ctx.getSku('X0010138'));
});

test('停售 / 上架：款与其色码状态联动并留日志', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['toggle-status'](ctx, state, { getAttribute: () => 'X001' });
  assert.strictEqual(ctx.getProduct('X001').status, 'off');
  ctx.skusOf('X001').forEach((s) => assert.strictEqual(s.status, 'off'));
  assert.ok(ctx.data.logs.some((l) => l.action === '商品停售'));

  let html = page.render(ctx, state);
  assert.ok(html.includes('停售'));
  page.actions['toggle-status'](ctx, state, { getAttribute: () => 'X001' });
  assert.strictEqual(ctx.getProduct('X001').status, 'on');
});

test('CSV 导入：粘贴内容 → 导入成功并显示结果', () => {
  const { ctx, state } = fresh();
  page.actions['open-csv'](ctx, state);
  state.csvText = '名称,类别,颜色,号码,进价,售价\n小白鞋,鞋,白、黑,"38,39",50,129\n,鞋,白,38,1,2\n';
  page.actions['do-import'](ctx, state);
  assert.strictEqual(ctx.data.skus.length, 4);
  assert.strictEqual(state.csvResult.created, 1);
  assert.strictEqual(state.csvResult.errors.length, 1);

  const html = page.render(ctx, state);
  assert.ok(html.includes('导入结果'));
  assert.ok(html.includes('未导入'));
});

test('分页：每页上限 300 条', () => {
  const { ctx, state } = fresh();
  for (let i = 0; i < 305; i++) {
    ctx.data.products.push({ styleCode: 'X' + String(i + 1).padStart(3, '0'), name: '款' + i, category: '鞋', salePrice: 0, barcode: 'X' + i });
  }
  const html = page.render(ctx, state);
  assert.ok(html.includes('共 305 条'), '应显示总数 305');
  assert.ok(html.includes('1 / 2'), '305 条按每页 300 应分 2 页');
  // 每页渲染的行数不超过 300
  const rows = html.split('<tr>').length - 1;
  assert.ok(rows <= 301, '单页行数应 ≤300（含表头），实际 ' + rows);
});

/* ========== 问题4：保存并打印 buildLabelData 报错 + 保存后不刷新 ========== */

const fs4 = require('node:fs');
const path4 = require('node:path');

test('问题4：index.html 加载顺序——barcode/label.js 须在 page-product.js 之前（修复 buildLabelData 为 null）', () => {
  const html = fs4.readFileSync(path4.join(__dirname, '..', 'index.html'), 'utf8');
  const srcs = Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (m) => m[1]);
  const labelIdx = srcs.indexOf('js/barcode/label.js');
  const renderIdx = srcs.indexOf('js/barcode/render.js');
  const prodIdx = srcs.indexOf('js/ui/page-product.js');
  assert.ok(labelIdx >= 0 && renderIdx >= 0 && prodIdx >= 0, '三个脚本都应存在');
  assert.ok(labelIdx < prodIdx, 'label.js 应在 page-product.js 之前加载（否则 buildLabelData 为 null）');
  assert.ok(renderIdx < prodIdx, 'render.js 应在 page-product.js 之前加载（否则 render.svg 为 null）');
});

test('问题4：保存并打印成功后清空表单并回到列表（不残留上次输入）', () => {
  const { ctx, state } = fresh();
  const g = (globalThis.ERP = globalThis.ERP || {});
  g.pages = g.pages || {};
  g.pages.product = g.pages.product || {};
  let printedCode = null;
  g.pages.product.openPrint = function (c, s, code) { printedCode = code; };

  state.tab = 'new';
  state.form.name = '跑鞋';
  state.form.category = '鞋';
  state.form.colors = ['白'];
  state.form.sizes = ['40'];
  state.form.costPrice = '60';
  state.form.salePrice = '159';
  const r = page.actions['save-print'](ctx, state);
  assert.strictEqual(r, true, '保存并打印应成功');
  assert.ok(printedCode, '应调用 openPrint 并传入新款号，实际 ' + printedCode);
  assert.strictEqual(state.tab, 'list', '保存后应回到列表（页面随之刷新）');
  assert.strictEqual(state.form.name, '', '表单应清空，不残留上次输入');
  assert.strictEqual(ctx.data.products.length, 1, '商品应已创建');
});

test('问题4：打印失败不应误报「操作失败」，保存成功且状态已清空（try-catch 兜底）', () => {
  const { ctx, state } = fresh();
  const g = (globalThis.ERP = globalThis.ERP || {});
  g.pages = g.pages || {};
  g.pages.product = g.pages.product || {};
  // 模拟打印环节抛异常（如 buildLabelData 依赖缺失）
  g.pages.product.openPrint = function () {
    throw new Error("Cannot read properties of null (reading 'buildLabelData')");
  };

  state.tab = 'new';
  state.form.name = '凉鞋';
  state.form.category = '鞋';
  state.form.colors = ['黑'];
  state.form.sizes = ['39'];
  state.form.costPrice = '30';
  state.form.salePrice = '79';
  assert.doesNotThrow(() => page.actions['save-print'](ctx, state), '打印失败不应让整个保存抛异常');
  assert.strictEqual(ctx.data.products.length, 1, '商品应已保存');
  assert.strictEqual(state.tab, 'list', '保存成功应回到列表');
  assert.strictEqual(state.form.name, '', '表单应清空');
});
