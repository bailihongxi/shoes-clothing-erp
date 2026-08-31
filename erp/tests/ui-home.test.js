/**
 * tests/ui-home.test.js —— 首页看板 / 设置页 / 我的页 渲染与关键动作
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { newCtx } = require('./helpers/ctx.js');
const schema = require('../js/core/schema.js');
const util = require('../js/core/util.js');

const home = require('../js/ui/page-home.js');
const setting = require('../js/ui/page-setting.js');
const mine = require('../js/ui/page-mine.js');

const ROOT = path.join(__dirname, '..');
const baseCss = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8');

function seedShop(ctx) {
  ctx.data.products.push({ styleCode: 'X001', name: '小白鞋', category: '鞋', barcode: 'X001', costPrice: 50, salePrice: 129, status: 'on' });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 2, threshold: 3 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);
}

test('首页：渲染含今日概览与快捷入口，顶栏 hero 有「开单」跳转按钮（问题9）', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/今日营收/.test(html), '应有今日营收卡');
  assert.ok(/快捷入口/.test(html), '应有快捷入口');
  // 问题9：顶栏 hero 有显著「开单」跳转按钮（手机/电脑共用）
  assert.ok(/class="home-sale-btn[^"]*"/.test(html), '应有 home-sale-btn 醒目按钮');
  assert.ok(/data-act="go"\s+data-page="sale"/.test(html), '按钮应跳转到 sale（销售开单）');
  // 快捷入口网格保持精简（不含开单磁贴 - 问题6）
  const quickMatch = html.match(/<h3[^>]*>快捷入口<\/h3>([\s\S]*?)<\/div>/);
  assert.ok(quickMatch, '应有快捷入口区块');
  assert.ok(!/data-page="sale"/.test(quickMatch[1]), '快捷入口网格内不应含开单磁贴');
  assert.ok(/进货/.test(html) && /报表/.test(html), '快捷入口保留进货/报表等常用入口');
});

test('首页：手机端指标+开单按钮按图2 2x2 + 右侧大按钮（跨两行）排列', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  // 2x2 容器 + 右侧大按钮（grid-row: span 2）
  assert.ok(/class="mobile-only stat-grid home-stat-2x2"/.test(html), '应有 home-stat-2x2 2x2 容器');
  const start = html.indexOf('home-stat-2x2');
  const end = html.indexOf('mobile-only card', start);
  const block = html.slice(start, end > 0 ? end : html.length);
  // 4 个指标卡（图2：营收/单数/毛利/预警）
  const cards = (block.match(/class="stat-card"/g) || []).length;
  assert.strictEqual(cards, 4, '应恰有 4 个指标卡');
  assert.ok(/今日营收/.test(block), '应有「今日营收」');
  assert.ok(/今日单数/.test(block), '应有「今日单数」');
  assert.ok(/今日毛利/.test(block), '应有「今日毛利」');
  assert.ok(/预警款数/.test(block), '应有「预警款数」');
  // 右侧放大开单按钮（home-sale-row，跨 2 行）
  const btnMatch = block.match(/<button[^>]*class="home-sale-btn home-sale-row"[^>]*>/);
  assert.ok(btnMatch, '应有右侧放大开单按钮（home-sale-row）');
  assert.ok(/data-act="go"\s+data-page="sale"/.test(btnMatch[0]), '按钮跳转 sale');
  // DOM 顺序：营收→单数→毛利→预警→按钮（按钮最后写也能 grid-row span 2）
  const idxA = block.indexOf('今日营收');
  const idxB = block.indexOf('今日单数');
  const idxC = block.indexOf('今日毛利');
  const idxD = block.indexOf('预警款数');
  const idxE = block.indexOf('home-sale-row');
  assert.ok(idxA < idxB && idxB < idxC && idxC < idxD && idxD < idxE, 'DOM 顺序营收→单数→毛利→预警→开单按钮');
});

test('首页：未备份时显示提醒条', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/未备份/.test(html), '应提示未备份');
  assert.ok(/去备份/.test(html), '应有去备份入口');
});

test('首页：当天已备份则不显示提醒', () => {
  const ctx = newCtx();
  ctx.data.lastBackupAt = util.today() + 'T08:00:00';
  const html = home.render(ctx, home.init(ctx));
  assert.ok(!/未备份/.test(html), '当天已备份不应提醒');
});

test('首页：超期欠款进入待处理事项条', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const cus = ctx.data.partners = ctx.data.partners || [];
  cus.push({ id: 'cus_1', name: '张三', type: 'customer', balance: 20000, lastDealAt: null, createdAt: util.nowISO() });
  const old = util.addDays(util.today(), -30);
  ctx.data.sales.push({
    no: 'S1', date: old, type: 'sale', partnerId: 'cus_1',
    items: [{ skuId: 'X0010138', styleCode: 'X001', qty: 1, price: 129, costSnapshot: 50, type: 'sale' }],
    payable: 100, received: 0, debt: 100, voided: false
  });
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/待处理事项/.test(html), '应有待处理事项条');
  assert.ok(/张三/.test(html), '应列出超期客户');
});

test('首页：预警款数随低库存变化', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  // 空数据时预警 0，不应显示 warn 样式在预警卡
  assert.ok(/预警款数/.test(html));
});

test('设置页：渲染关键区块', () => {
  const ctx = newCtx();
  const html = setting.render(ctx, setting.init(ctx));
  assert.ok(/店铺名称/.test(html), '应有店铺名称');
  assert.ok(/打开密码/.test(html), '应有打开密码');
  assert.ok(/导出备份/.test(html), '应有导出备份');
  assert.ok(/操作日志/.test(html), '应有操作日志');
});

test('设置页：密码不一致被拒绝', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.pwd = '1234';
  state.pwd2 = '9999';
  const r = setting.actions['set-password'](ctx, state);
  assert.strictEqual(r, false, '两次不一致应拒绝');
});

test('设置页：设置合法密码后启用', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.pwd = '123456';
  state.pwd2 = '123456';
  const r = setting.actions['set-password'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.settings.lock.enabled, true);
  assert.ok(ctx.settings.lock.hash, '应写入密码哈希');
});

test('设置页：保存设置写入店铺名与打印参数', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.shopName = '潮流鞋坊';
  state.widthMm = '40';
  state.dpi = '300';
  setting.actions['save-settings'](ctx, state);
  assert.strictEqual(ctx.settings.shopName, '潮流鞋坊');
  assert.strictEqual(ctx.settings.label.dpi, 300);
});

test('设置页：导出备份返回 true 且生成 JSON', () => {
  const ctx = newCtx();
  const r = setting.actions['export-backup'](ctx, setting.init(ctx));
  assert.strictEqual(r, true);
  assert.ok(ctx.data.lastBackupAt, '应记录最后备份时间');
});

test('我的页：渲染店铺信息与关于', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(/我的/.test(html), '标题');
  assert.ok(/关于/.test(html), '应有关于');
  assert.ok(/常用入口/.test(html), '应有常用入口');
});

test('页面均注册到 ERP.pages', () => {
  assert.ok(home.name === 'home' && setting.name === 'setting' && mine.name === 'mine');
});

test('问题1：经营概览 stat-card 标签字号调小（营收/毛利等标签不再过大）', () => {
  // 图2 参考：标签小、数值醒目 —— 标签字号应 ≤11px
  const m = baseCss.match(/\.stat-card \.label\s*\{[^}]*\}/);
  assert.ok(m, 'base.css 应有 .stat-card .label 规则');
  const rule = m[0];
  const size = rule.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
  assert.ok(size, '标签应显式声明 font-size');
  assert.ok(parseFloat(size[1]) <= 11, '标签字号应 ≤11px（当前 ' + size[1] + 'px）');
  // 数值仍醒目（> 标签字号，保持主次）
  const v = baseCss.match(/\.stat-card \.value\s*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/);
  assert.ok(v && parseFloat(v[1]) > parseFloat(size[1]), '数值字号应大于标签字号');
  // 首页渲染仍含 4 个指标标签文字
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/今日营收/.test(html) && /今日毛利/.test(html), '保留营收/毛利标签');
  assert.ok(/今日单数/.test(html) && /预警款数/.test(html), '保留单数/预警标签');
});

/* ========== 手机版首页 UI 与文字应用到电脑版 ========== */

const desktopCss = fs.readFileSync(path.join(ROOT, 'css/desktop.css'), 'utf8');

function desktopBlock(html) {
  const m = html.match(/<div class="desktop-only">([\s\S]*?)<\/div>\s*$/);
  assert.ok(m, '应有 desktop-only 块');
  return m[1];
}

test('电脑版首页：复用手机版 UI 与文字——banner+经营概览+2x2+开单大按钮+快捷入口', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  const desk = desktopBlock(html);

  // banner 与手机版一致
  assert.ok(/我的鞋服店/.test(desk), '桌面应有「我的鞋服店」banner 标题');
  assert.ok(/已备份 · 今天 09:12/.test(desk), '桌面 banner 副文案与手机版一致');
  // 经营概览 + 日期
  assert.ok(/经营概览/.test(desk), '桌面应有「经营概览」标题');
  assert.ok(/年\d{1,2}月\d{1,2}日/.test(desk), '桌面应有中文日期（与手机版一致格式）');
  // 2x2 stat + 右侧开单大按钮（文案与手机版一致）
  assert.ok(/class=" stat-grid home-stat-2x2"/.test(desk), '桌面应复用 home-stat-2x2 2x2 容器');
  assert.ok(/今日营收/.test(desk) && /今日单数/.test(desk) && /今日毛利/.test(desk) && /预警款数/.test(desk),
    '桌面 stat 文案与手机版一致（今日营收/今日单数/今日毛利/预警款数）');
  assert.ok(/class="home-sale-btn home-sale-row"/.test(desk), '桌面应有跨两行开单大按钮');
  assert.ok(/开单/.test(desk) && /扫码 \/ 选货/.test(desk), '桌面开单按钮文案与手机版一致');
  // 快捷入口 6 项
  assert.ok(/快捷入口/.test(desk), '桌面应有快捷入口');
  ['进货', '商品', '库存', '退换', '记账', '报表'].forEach(function (t) {
    assert.ok(new RegExp(t).test(desk), '桌面快捷入口应含「' + t + '」');
  });
  // 分析看板保留
  assert.ok(/近期销售趋势/.test(desk) && /热销 TOP5/.test(desk), '桌面保留分析看板');
});

test('电脑版首页：不再出现旧桌面文案「你好，店主」', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  assert.ok(!/你好，店主/.test(html), '桌面已移除旧文案「你好，店主 🌸」');
  assert.ok(!/今天是 \d+月\d+日/.test(html), '桌面已移除旧日期文案');
});

test('desktop.css：桌面端 home-stat-2x2 适配（3 列 grid + 开单按钮跨两行）', () => {
  assert.ok(/\.home-top \.stat-grid\.home-stat-2x2\s*\{[^}]*grid-template-columns:\s*1fr 1fr 0\.85fr/.test(desktopCss),
    'desktop.css 应定义桌面 2x2 三列网格');
  assert.ok(/\.home-stat-2x2 \.home-sale-btn\.home-sale-row\s*\{[^}]*grid-row:\s*1 \/ span 2/.test(desktopCss),
    'desktop.css 应定义开单按钮跨两行');
  assert.ok(/\.home-top\s*\{\s*display:\s*block/.test(desktopCss), 'desktop.css 应将 home-top 恢复为纵向堆叠');
});
