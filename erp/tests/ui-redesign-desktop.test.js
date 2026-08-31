/**
 * tests/ui-redesign-desktop.test.js —— 问题15：全项目 UI v3（参照设计图重设计）
 * 覆盖：① 手机端通用薄荷绿 banner 自动注入；② 库存页桌面 4 统计卡 + 分类筛选；
 *       ③ 开单页桌面三栏布局；④ 首页/我的页 手机端与桌面端分区渲染。
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const schema = require('../js/core/schema.js');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');

require('../js/app.js');
const app = globalThis.ERP.app;

const home = require('../js/ui/page-home.js');
const mine = require('../js/ui/page-mine.js');
const sale = require('../js/ui/page-sale.js');
const inv = require('../js/ui/page-inventory.js');

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

/* ---------------- ① 手机端通用 banner 注入 ---------------- */

test('app.decorateHtml：无 banner 的页面自动注入手机端薄荷绿 banner', () => {
  const out = app.decorateHtml(
    { name: 'purchase', title: '进货管理' },
    '<div class="page-head"><h2>进货管理</h2></div>'
  );
  assert.ok(/class="page-banner mobile-only/.test(out), '应注入 mobile-only banner');
  assert.ok(/banner-title">进货管理</.test(out), 'banner 标题应为页面标题');
});

test('app.decorateHtml：已带 page-banner 的页面不重复注入', () => {
  const html = '<div class="page-banner"><div class="banner-title">首页</div></div>';
  assert.strictEqual(app.decorateHtml({ name: 'home', title: '首页' }, html), html);
});

test('app.mobileBanner：banner 为 mobile-only，桌面端隐藏', () => {
  const b = app.mobileBanner({ name: 'sale', title: '销售开单' });
  assert.ok(/page-banner mobile-only/.test(b), '应带 mobile-only');
  assert.ok(/销售开单/.test(b), '含标题');
});

/* ---------------- ② 库存页桌面统计卡 + 分类筛选 ---------------- */

test('库存页桌面端：渲染 4 统计卡（总款式/总件数/资金占用/低库存预警）', () => {
  const ctx = newCtx();
  seed(ctx);
  const html = inv.render(ctx, inv.init(ctx));
  assert.ok(/desktop-stats/.test(html), '应有桌面统计卡容器');
  assert.ok(/总款式/.test(html) && /总件数/.test(html), '应有总款式/总件数');
  assert.ok(/资金占用/.test(html) && /低库存预警/.test(html), '应有资金占用/低库存预警');
  assert.ok(/data-act="reset-filter"/.test(html), '应有重置筛选按钮');
});

test('库存页分类筛选：选择分类后只保留该类商品', () => {
  const ctx = newCtx();
  seed(ctx);
  const st = inv.init(ctx);
  st.cat = '鞋';
  const html = inv.render(ctx, st);
  assert.ok(/小白鞋/.test(html), '应仍展示该类商品');
  st.cat = '不存在的分类';
  const html2 = inv.render(ctx, st);
  assert.ok(!/小白鞋/.test(html2), '非该类商品不应出现');
});

test('库存页重置筛选：清空关键词与分类', () => {
  const ctx = newCtx();
  seed(ctx);
  const st = inv.init(ctx);
  st.keyword = 'X001';
  st.cat = '鞋';
  inv.actions['reset-filter'](ctx, st);
  assert.strictEqual(st.keyword, '');
  assert.strictEqual(st.cat, '');
  assert.strictEqual(st.page, 1);
});

/* ---------------- ③ 开单页桌面三栏布局 ---------------- */

test('开单页：桌面三栏布局（选货区/当前订单/收款）且保留出单按钮', () => {
  const ctx = newCtx();
  seed(ctx);
  const st = sale.init(ctx);
  sale.actions['pick-style'](ctx, st, { getAttribute: () => 'X001' });
  sale.actions['add-sale'](ctx, st, { getAttribute: () => 'X0010138' });
  const html = sale.render(ctx, st);
  assert.ok(/sale-three-col/.test(html), '应有三栏容器');
  assert.ok(/sale-col-pick/.test(html), '应有选货区列');
  assert.ok(/sale-col-order/.test(html), '应有当前订单列');
  assert.ok(/sale-col-pay/.test(html), '应有收款列');
  assert.ok(/当前订单/.test(html), '订单列标题');
  assert.ok(/保存并出单/.test(html), '保留出单按钮');
  assert.ok(/add-sale/.test(html), '选货矩阵可点击');
});

/* ---------------- ④ 首页 / 我的页 端区分布局 ---------------- */

test('首页：手机端与桌面端分区渲染，banner 仅在手机端', () => {
  const ctx = newCtx();
  seed(ctx);
  const html = home.render(ctx, home.init(ctx));
  const mobile = /<div class="mobile-only">[\s\S]*?<\/div>\s*<div class="desktop-only">/.test(html);
  assert.ok(mobile, '应同时输出 mobile-only 与 desktop-only 分区');
  assert.ok(/page-banner/.test(html), '手机端含薄荷绿 banner');
  assert.ok(/今日营收/.test(html) && /快捷入口/.test(html), '保留概览与快捷入口');
  assert.ok(/销售趋势/.test(html) || /近7天/.test(html) || /TOP5/.test(html), '桌面端保留看板');
});

test('我的页：桌面端显示 page-head 且不显示手机 banner', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(/mobile-only/.test(html) && /desktop-only/.test(html), '分区渲染');
  assert.ok(/class="page-banner mine-banner"/.test(html), '手机端保留 banner');
  assert.ok(/<div class="page-head"><h2>我的<\/h2>/.test(html), '桌面端有 page-head');
  assert.ok(/云同步/.test(html) && /常用入口/.test(html), '保留核心内容');
});

test('我的页：常用入口为 9 格 3×3 九宫格且含退换货', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  const m = html.match(/<div class="quick-grid mine-quick">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, '应有 mine-quick 九宫格容器');
  const inner = m[1];
  const count = (inner.match(/quick-circle/g) || []).length;
  assert.strictEqual(count, 9, '应恰好 9 个快捷入口');
  assert.ok(/data-page="exchange"/.test(inner), '九宫格应含退换货入口');
  assert.ok(/退换货/.test(inner), '退换货文字显示');
});
