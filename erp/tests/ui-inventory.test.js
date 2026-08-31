const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const inv = require('../js/core/inventory.js');
const page = require('../js/ui/page-inventory.js');
const { newCtx } = require('./helpers/ctx.js');

function fresh() {
  const ctx = newCtx();
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  const state = page.init(ctx);
  return { ctx, state };
}

function stockIn(ctx, qtyMap) {
  return engine.savePurchase(ctx, {
    date: '2026-08-31',
    partnerName: '温州鞋厂',
    items: Object.keys(qtyMap).map((skuId) => ({ skuId, qty: qtyMap[skuId], costPrice: '50' })),
    paid: 99999
  });
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'inventory');
  const { state } = fresh();
  assert.strictEqual(state.tab, 'list');
});

test('库存列表：显示款号、总库存、资金占用，可展开颜色×尺码矩阵', () => {
  const { ctx, state } = fresh();
  stockIn(ctx, { X0010138: 3, X0010239: 1 });

  let html = page.render(ctx, state);
  assert.ok(html.includes('X001'));
  assert.ok(html.includes('小白鞋'));
  assert.ok(html.includes('库存管理'));
  assert.ok(html.includes('资金占用'));
  assert.ok(!html.includes('颜色\\尺码'));

  page.actions['toggle-expand'](ctx, state, { getAttribute: () => 'X001' });
  html = page.render(ctx, state);
  assert.ok(html.includes('颜色\\尺码'), '展开后应出现矩阵');
  assert.ok(html.includes('data-sku="X0010138"'));
  assert.ok(html.includes('收起'));
});

test('搜索：按款号 / 名称 / 条码 / SKU id 都能命中', () => {
  const { ctx, state } = fresh();
  coding.create({ name: '纯棉T恤', category: '服装', colors: ['白'], sizes: ['M'] }, ctx);

  state.keyword = 'F001';
  assert.ok(page.render(ctx, state).includes('纯棉T恤'));
  state.keyword = 'T恤';
  assert.ok(page.render(ctx, state).includes('纯棉T恤'));
  state.keyword = 'X0010139';
  assert.ok(page.render(ctx, state).includes('小白鞋'));
  assert.ok(!page.render(ctx, state).includes('纯棉T恤'));
});

test('扫码查库存：输入条码直接定位该款并展开矩阵', () => {
  const { ctx, state } = fresh();
  page.actions['scan-input'](ctx, state, { value: 'X001' });
  assert.strictEqual(state.keyword, 'X001');
  assert.strictEqual(state.expanded, 'X001');
  assert.ok(page.render(ctx, state).includes('颜色\\尺码'));
});

test('阈值可在列表直接改，写入款与其全部色码', () => {
  const { ctx, state } = fresh();
  page.actions['set-threshold'](ctx, state, { getAttribute: () => 'X001', value: '5' });
  assert.strictEqual(ctx.getProduct('X001').threshold, 5);
  ctx.skusOf('X001').forEach((s) => assert.strictEqual(s.threshold, 5));

  stockIn(ctx, { X0010138: 4 });
  assert.ok(inv.getAlerts(ctx).some((a) => a.skuId === 'X0010138'), '库存 4 < 阈值 5 应预警');
});

test('预警页：列出低于阈值的色码与数量', () => {
  const { ctx, state } = fresh();
  stockIn(ctx, { X0010138: 1 });
  page.actions.tab(ctx, state, { getAttribute: () => 'alert' });
  const html = page.render(ctx, state);
  assert.ok(html.includes('库存预警'));
  assert.ok(html.includes('X0010138') || html.includes('白'));
  assert.ok(html.includes('低于阈值的色码共'));
});

test('盘点：选款 → 填实盘数 → 保存 → 库存更新为实盘数并留记录', () => {
  const { ctx, state } = fresh();
  stockIn(ctx, { X0010138: 5, X0010139: 5 });

  page.actions.tab(ctx, state, { getAttribute: () => 'take' });
  page.actions['pick-take-style'](ctx, state, { getAttribute: () => 'X001' });
  let html = page.render(ctx, state);
  assert.ok(html.includes('录入实盘数'));
  assert.ok(html.includes('data-change="real"'));

  page.actions.real(ctx, state, { getAttribute: () => 'X0010138', value: '4' });
  page.actions.real(ctx, state, { getAttribute: () => 'X0010139', value: '6' });
  assert.strictEqual(page.actions['save-take'](ctx, state), true);

  assert.strictEqual(ctx.getSku('X0010138').stock, 4);
  assert.strictEqual(ctx.getSku('X0010139').stock, 6);
  const doc = ctx.data.stocktakes[0];
  assert.ok(/^T\d{8}-001$/.test(doc.no));
  assert.strictEqual(doc.diffQty, 0, '-1 +1 = 0');
  assert.strictEqual(doc.diffCount, 2);

  html = page.render(ctx, state);
  assert.ok(html.includes('最近盘点记录'));
  assert.ok(html.includes('盘点单'));
});

test('盘点：未选款直接保存会被拦截', () => {
  const { ctx, state } = fresh();
  page.actions.tab(ctx, state, { getAttribute: () => 'take' });
  assert.strictEqual(page.actions['save-take'](ctx, state), false);
  assert.strictEqual(ctx.data.stocktakes.length, 0);
});

test('变动明细：展示某色码的入库/出库/盘点流水', () => {
  const { ctx, state } = fresh();
  stockIn(ctx, { X0010138: 5 });
  engine.saveStocktake(ctx, { styleCode: 'X001', counts: { X0010138: 4 } });

  page.actions['show-logs'](ctx, state, { getAttribute: () => 'X0010138' });
  const html = page.render(ctx, state);
  assert.ok(html.includes('变动明细'));
  assert.ok(html.includes('进货入库'));
  assert.ok(html.includes('盘点调整'));
  assert.ok(html.includes('-1'));
});

test('分页上限 300 条', () => {
  const { ctx, state } = fresh();
  for (let i = 0; i < 400; i++) {
    ctx.data.products.push({
      styleCode: 'X' + String(i + 2).padStart(3, '0'),
      name: '款' + i,
      category: '鞋',
      salePrice: 0,
      barcode: 'X' + i
    });
  }
  const html = page.render(ctx, state);
  // v2 设计图：手机/电脑两套布局同时输出（CSS .mobile-only/.desktop-only 互斥显示）。
  // 分页 300 是电脑端表格逻辑，单设备下不应 > 300 行 tr。
  // 取 desktop-only 块内的 tr 数。
  const deskMatch = html.match(/<div class="desktop-only">([\s\S]*?)<\/div>\s*$/);
  assert.ok(deskMatch, '应有 desktop-only 块');
  const deskRows = (deskMatch[1].match(/<tr>/g) || []).length;
  assert.ok(deskRows <= 301, '电脑端单页行数 ≤300，实际 ' + deskRows);
  assert.ok(html.includes('共 401 条'));
});

/* ========== 手机版库存页：搜索框与按钮同行排列 + 按钮显示图标 ========== */

test('手机版库存页：搜索栏 search-bar 内 🔍 图标 + 输入框 + 扫码按钮同行（同一容器）', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  // 手机端搜索栏：.search-bar 容器内依次是 .ico、input、扫码按钮（同行结构）
  const m = html.match(/<div class="search-bar">([\s\S]*?)<\/div>/);
  assert.ok(m, '应有 search-bar 容器');
  const bar = m[1];
  assert.ok(bar.includes('<span class="ico">🔍</span>'), '含 🔍 图标');
  assert.ok(/<input class="input" data-input="keyword" placeholder="搜款号 \/ 名称 \/ 条码（可扫码）"/.test(bar), '含搜索输入框');
  // 扫码按钮与电脑版相同：.btn 相机图标 📷（非裸文本 ▦）
  assert.ok(/<button class="btn" data-act="scan" title="扫码">📷<\/button>/.test(bar), '含相机图标按钮（📷，与电脑版一致）');
  // 三者顺序：图标 → 输入框 → 按钮
  assert.ok(bar.indexOf('ico') < bar.indexOf('data-input="keyword"'), '图标在输入框前');
  assert.ok(bar.indexOf('data-input="keyword"') < bar.indexOf('data-act="scan"'), '输入框在按钮前');
});

test('手机版库存页：base.css 定义搜索栏同行 flex，扫码按钮复用电脑版 .btn 样式', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  // .search-bar 使用 flex 同行
  assert.ok(/\.search-bar\s*{[^}]*display:\s*flex/.test(css), '.search-bar 应为 flex 同行排列');
  assert.ok(/\.search-bar\s*{[^}]*align-items:\s*center/.test(css), '.search-bar 应垂直居中');
  assert.ok(/\.search-bar \.input\s*{[^}]*flex:\s*1/.test(css), '输入框应 flex:1 占主体');
  // 扫码按钮复用电脑版 .btn（不再使用 .btn-scan 裸文本样式）
  assert.ok(/\.search-bar \.btn\s*{[^}]*flex:\s*0\s+0\s+auto/.test(css), '搜索栏内按钮保持同行不收缩');
  assert.ok(!/\.btn-scan/.test(css), '不再存在 .btn-scan 裸文本按钮样式');
});
