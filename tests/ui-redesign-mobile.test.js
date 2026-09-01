/**
 * ui-redesign-mobile.test.js —— 问题14-②：手机端库存 + 我的 v2 设计图验证
 *
 * 验证：
 *  1. page-inventory：薄荷绿 banner + 2 stat cards + 3 segmented + 搜索 + 空状态卡片
 *  2. page-mine：banner + 店铺卡 + 云同步 + 8 格圆形 + 版本信息
 *  3. mobile-only / desktop-only 互斥包裹正确
 *  4. 业务能力（搜索 / 阈值 / 盘点 / 同步设置字段 / 跳转）保留
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const inv = require('../js/core/inventory.js');
const invPage = require('../js/ui/page-inventory.js');
const minePage = require('../js/ui/page-mine.js');

/* ===========================================================
 * 库存页（设计图 1-2）验证
 * =========================================================== */

function seededInvCtx() {
  const ctx = newCtx();
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  return ctx;
}

test('库存页：含薄荷绿 banner 标题「库存管理」与右上角菜单按钮', () => {
  const ctx = seededInvCtx();
  const html = invPage.render(ctx, invPage.init(ctx));
  assert.ok(/<div class="page-banner[^"]*inventory-banner/.test(html), '应有 page-banner inventory-banner');
  assert.ok(/<div class="banner-title">库存管理<\/div>/.test(html), 'banner 标题应为「库存管理」');
  assert.ok(/data-act="inventory-menu"/.test(html), '应有右上角菜单按钮');
});

test('库存页：手机端 2 stat cards（总库存 + 资金占用）', () => {
  // 使用 newCtx() 无商品，期望显示「0款 0件」
  const ctx = newCtx();
  const html = invPage.render(ctx, invPage.init(ctx));
  assert.ok(/class="mobile-only inventory-stats"/.test(html), '应有手机 stat 容器');
  assert.ok(/<div class="stat-card stat-card-lg">/.test(html), '应有 stat-card 大卡');
  assert.ok(/<div class="stat-card stat-card-fund">/.test(html), '应有 stat-card 资金卡');
  assert.ok(/0款\s*0件/.test(html), '总库存数应显示「0款 0件」');
  assert.ok(/总库存/.test(html), '应有「总库存」标签');
  assert.ok(/资金占用/.test(html), '应有「资金占用」标签');
});

test('库存页：手机端 3 段 segmented（库存查询 / 预警 / 盘点）含预警徽标', () => {
  const ctx = seededInvCtx();
  engine.savePurchase(ctx, {
    date: '2026-08-31', partnerName: '温州鞋厂',
    items: [{ skuId: 'X0010138', qty: 1, costPrice: '50' }],
    paid: 99999
  });
  const html = invPage.render(ctx, invPage.init(ctx));
  assert.ok(/class="mobile-only segmented inventory-seg"/.test(html), '应有 segmented');
  assert.ok(/data-tab="list"[\s\S]*?data-tab="alert"[\s\S]*?data-tab="take"/.test(html),
    '应按 库存查询 → 预警 → 盘点 顺序排列');
  assert.ok(/<span class="count">/.test(html), '预警项应有 count 徽标');
});

test('库存页：手机端搜索栏含扫码按钮', () => {
  const ctx = seededInvCtx();
  const html = invPage.render(ctx, invPage.init(ctx));
  assert.ok(/class="mobile-only card inventory-search"/.test(html), '应有 search 卡');
  assert.ok(/data-input="keyword"/.test(html), '搜索 input 应有 data-input');
  assert.ok(/data-act="scan"[\s\S]*?扫码/.test(html) || /aria-label="扫码"/.test(html),
    '应有扫码按钮');
});

test('库存页：空数据时显示「暂无商品数据」空状态卡 + 去进货 CTA', () => {
  const ctx = newCtx(); // 无商品
  const html = invPage.render(ctx, invPage.init(ctx));
  assert.ok(/class="mobile-only empty-state-card"/.test(html), '应有 empty-state-card');
  assert.ok(/暂无商品数据/.test(html), '空状态文案');
  assert.ok(/data-act="go"[\s\S]*?data-page="purchase"[\s\S]*?去进货/.test(html),
    '去进货按钮');
});

test('库存页：mobile-only 与 desktop-only 互斥包裹', () => {
  const ctx = seededInvCtx();
  const html = invPage.render(ctx, invPage.init(ctx));
  // 应至少各出现一次 mobile-only / desktop-only 包裹
  const mobMatches = (html.match(/class="[^"]*\bmobile-only\b[^"]*"/g) || []).length;
  const deskMatches = (html.match(/class="[^"]*\bdesktop-only\b[^"]*"/g) || []).length;
  assert.ok(mobMatches >= 4, '应有多个 mobile-only 块（banner+stat+seg+search），实际 ' + mobMatches);
  assert.ok(deskMatches >= 1, '应有 desktop-only 块');
});

test('库存页：业务能力保留——阈值改写、盘点、扫码动作注册', () => {
  const ctx = seededInvCtx();
  // 阈值需在 list 视图（含表格）才可见；盘点需切到 take tab + 选款 才可见
  const stateList = invPage.init(ctx);
  let html = invPage.render(ctx, stateList);
  assert.ok(/data-change="set-threshold"/.test(html), '阈值编辑（list 视图）');
  assert.strictEqual(typeof invPage.actions['set-threshold'], 'function');
  assert.strictEqual(typeof invPage.actions['scan'], 'function');
  assert.strictEqual(typeof invPage.actions['inventory-menu'], 'function');

  // 切到 take tab + 选款后盘点 input 应可见
  invPage.actions.tab(ctx, stateList, { getAttribute: () => 'take' });
  invPage.actions['pick-take-style'](ctx, stateList, { getAttribute: () => 'X001' });
  html = invPage.render(ctx, stateList);
  assert.ok(/data-change="real"/.test(html), '盘点实盘数（take tab + 已选款）');
  assert.strictEqual(typeof invPage.actions['save-take'], 'function');
});

/* ===========================================================
 * 我的页（设计图 1-3）验证
 * =========================================================== */

test('我的页：banner 标题「我的」', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/<div class="page-banner mine-banner">/.test(html), '应有 banner');
  assert.ok(/<div class="banner-title">我的<\/div>/.test(html), 'banner 标题应为「我的」');
});

test('我的页：店铺信息卡片（圆形头像 + 店铺名 + 经营范围 + 右箭头，V3 点击打开资料编辑）', () => {
  const ctx = newCtx();
  ctx.settings.shopName = '潮流鞋坊';
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/class="shop-info-card"/.test(html), '应有 shop-info-card');
  assert.ok(/<div class="avatar">/.test(html), '应有圆形头像');
  assert.ok(/潮流鞋坊/.test(html), '店铺名');
  assert.ok(/经营：/.test(html), '副标题显示经营范围');
  assert.ok(/<div class="arrow">/.test(html), '应有右箭头');
  assert.ok(/data-act="toggle-shop-edit"/.test(html), '店铺卡点击打开资料编辑（V3）');
});

test('我的页：默认店铺名为「我的鞋服店」', () => {
  const ctx = newCtx();
  delete ctx.settings.shopName;
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/我的鞋服店/.test(html), '默认店铺名');
});

test('我的页：云同步卡含 3 按钮（同步到云端 / 从云端恢复 / 同步设置）', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/class="card sync-card"/.test(html), '应有云同步卡');
  assert.ok(/☁\s*云同步/.test(html), '云同步标题');
  assert.ok(/data-act="sync-up"/.test(html), '同步到云端按钮');
  assert.ok(/data-act="sync-down"/.test(html), '从云端恢复按钮');
  assert.ok(/data-act="toggle-sync-cfg"/.test(html), '同步设置按钮');
  assert.ok(/还没同步过/.test(html), '未同步时默认提示');
});

test('我的页：9 格 3×3 九宫格快捷入口（开单/进货/商品/供应商/库存/记账中心/报表/退换货/设置）', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/class="quick-grid mine-quick"/.test(html), '应有九宫格网格');
  assert.ok(/常用入口/.test(html), '「常用入口」字串保留（兼容既有测试）');
  var pages = ['sale', 'purchase', 'product', 'supplier', 'inventory', 'account', 'report', 'exchange', 'setting'];
  pages.forEach(function (p) {
    assert.ok(html.includes('data-page="' + p + '"'), '应有跳转 ' + p);
  });
  const m = html.match(/<div class="quick-grid mine-quick">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, '应有 mine-quick 容器');
  assert.strictEqual((m[1].match(/quick-circle/g) || []).length, 9, '应恰好 9 格');
});

test('我的页：关于卡片 + 版本 V3.0 + 数据存储于本机 IndexedDB', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/class="card about-card"/.test(html), '应有 about-card');
  assert.ok(/关于/.test(html), '「关于」字串保留（兼容既有测试）');
  assert.ok(/V3\.0/.test(html), '版本 V3.0');
  assert.ok(/IndexedDB/.test(html), 'IndexedDB 字串');
  assert.ok(/自动备份/.test(html), '自动备份字串');
});

test('我的页：同步设置面板展开后含 6 字段 + 保存按钮', () => {
  const ctx = newCtx();
  const state = minePage.init(ctx);
  state.syncOpen = true;
  const html = minePage.render(ctx, state);
  ['owner', 'repo', 'branch', 'path', 'token', 'passphrase'].forEach(function (k) {
    assert.ok(html.includes('data-name="' + k + '"'), '字段 ' + k);
  });
  assert.ok(/data-act="save-sync-cfg"/.test(html), '保存同步设置按钮');
});

test('我的页：sync-up / sync-down / toggle-sync-cfg / save-sync-cfg 动作注册', () => {
  assert.strictEqual(typeof minePage.actions['sync-up'], 'function');
  assert.strictEqual(typeof minePage.actions['sync-down'], 'function');
  assert.strictEqual(typeof minePage.actions['toggle-sync-cfg'], 'function');
  assert.strictEqual(typeof minePage.actions['save-sync-cfg'], 'function');
  assert.strictEqual(typeof minePage.actions['sync-field'], 'function');
  assert.strictEqual(typeof minePage.actions['go-shop-edit'], 'function');
});

test('我的页：sync-field 动作正确写入 cfg', () => {
  const ctx = newCtx();
  const state = minePage.init(ctx);
  minePage.actions['sync-field'](ctx, state, { getAttribute: () => 'owner', value: 'alice' });
  assert.strictEqual(state.cfg.owner, 'alice');
});

test('我的页：toggle-sync-cfg 翻转 syncOpen', () => {
  const ctx = newCtx();
  const state = minePage.init(ctx);
  assert.strictEqual(state.syncOpen, false);
  minePage.actions['toggle-sync-cfg'](ctx, state);
  assert.strictEqual(state.syncOpen, true);
});

/* ===========================================================
 * 跨页集成（库存 + 我的 联动：开单磁贴 → sale、库存 → inventory）
 * =========================================================== */

test('跨页：我的页 九宫格 入口 data-page 全部能在 ERP.pages 中找到', () => {
  // 显式 require 所有页面模块，让它们自注册到 ERP.pages（Node 测试下 global 隔离）
  require('../js/ui/page-sale.js');
  require('../js/ui/page-purchase.js');
  require('../js/ui/page-product.js');
  require('../js/ui/page-supplier.js');
  require('../js/ui/page-account.js');
  require('../js/ui/page-report.js');
  require('../js/ui/page-setting.js');
  require('../js/ui/page-exchange.js');

  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  // 用正则提取所有 data-page 值
  const pages = (html.match(/data-page="([a-z]+)"/g) || []).map(function (m) {
    return m.match(/"([a-z]+)"/)[1];
  });
  const unique = Array.from(new Set(pages));
  unique.forEach(function (p) {
    assert.ok(global.ERP && global.ERP.pages && global.ERP.pages[p], '应注册 ERP.pages.' + p);
  });
});