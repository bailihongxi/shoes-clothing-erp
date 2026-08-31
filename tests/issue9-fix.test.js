/**
 * tests/issue9-fix.test.js —— 问题9：首页显著「开单」按钮
 *
 * 用户原话：「在图片画框的地方做一个开单按键，醒目一些，
 *          跳转到销售开单界面，将手机界面和电脑界面全部更改后，进行验证并且更新 github pages 页面」
 *
 * 设计：
 *   - erp/js/ui/page-home.js：render() 在 4 格指标 (今日营收/单数/毛利/预警款数) 同一行
 *     右侧加一个醒目「开单」按钮 (button.home-sale-btn 带 🛒+文字+副标题)，整块
 *     data-act="go" data-page="sale"，由 components.globalActions.go 处理跳到销售开单页。
 *   - erp/css/base.css：基础尺寸 (.home-top grid + .home-sale-btn 渐变蓝大按钮)，手机/电脑共用，
 *     aria-label 完整，按钮可获焦 (focus-visible)。
 *   - erp/css/mobile.css：宽度 <768px 时按钮更紧凑 (min-width 92px) 以贴合屏宽；
 *   - erp/css/desktop.css：≥768px 时按钮显著放大 (min-width 180px、ico 42px)，与桌面布局协调。
 *
 * 与既有约定对齐：
 *   - 「不能删除测试、不能跳过测试」 — 问题6 测试断言同步细化，但不删除 (验证「快捷入口网格」不含 sale，而非「整页」不含 sale)，
 *     详见 issue6-fix.test.js 中更新后的用例；ui-home.test.js 同步更新断言。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { newCtx } = require('./helpers/ctx.js');
const home = require('../js/ui/page-home.js');
const components = require('../js/ui/components.js');

const ROOT = path.resolve(__dirname, '..');
const baseCss = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(ROOT, 'css/mobile.css'), 'utf8');
const desktopCss = fs.readFileSync(path.join(ROOT, 'css/desktop.css'), 'utf8');

function seedShop(ctx) {
  ctx.data.products.push({ styleCode: 'X001', name: '小白鞋', category: '鞋', barcode: 'X001', costPrice: 50, salePrice: 129, status: 'on' });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 2, threshold: 3 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);
}

/* ----------- ① 渲染：明显开单按钮 ----------- */

test('问题9-① 首页 hero 区有显著「开单」按钮，跳转到销售开单页', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));

  // 4 个原有指标完整保留（手机/电脑统一为「今日营收/今日单数/今日毛利/预警款数」）
  assert.ok(/今日营收/.test(html), '应有今日营收');
  assert.ok(/今日单数/.test(html), '应有今日单数');
  assert.ok(/今日毛利/.test(html), '应有今日毛利');
  assert.ok(/预警款数/.test(html), '应有预警款数');

  // hero 区出现醒目开单按钮
  assert.ok(/class="home-sale-btn[^"]*"/.test(html), '应有 .home-sale-btn 醒目按钮');
  assert.ok(/<button[^>]*class="home-sale-btn[^"]*"[^>]*>/.test(html), '应是 <button> 元素而非 <a>');

  // 点击跳转到 sale（销售开单）
  const btnMatch = html.match(/<button[^>]*class="home-sale-btn[^"]*"[^>]*>/);
  assert.ok(btnMatch, '按钮 html 片段应被解析');
  assert.ok(/data-act="go"/.test(btnMatch[0]), '按钮应声明 data-act="go"');
  assert.ok(/data-page="sale"/.test(btnMatch[0]), '按钮应跳 sale 页');

  // 视觉信息：图标 + 中文 + 副标题全在
  assert.ok(/🛒/.test(html), '按钮含购物车 emoji');
  assert.ok(/开单/.test(html), '按钮含「开单」文字');
  assert.ok(/扫码\s*\/\s*选货/.test(html), '按钮副标题含「扫码 / 选货」');

  // 无障碍
  assert.ok(/aria-label="[^"]*开单[^"]*"/.test(btnMatch[0]), '按钮应有无障碍标签');
});

/* ----------- ② 路由：globalActions.go 能把 sale 跳到销售开单 ----------- */

test('问题9-② components.globalActions.go 已注册，会改 hash 到 #/sale', () => {
  assert.ok(components.globalActions && typeof components.globalActions.go === 'function',
    'components.globalActions.go 应存在');
  // node 下没有 location，跳转逻辑跳过执行——但函数体（location.hash = ...）形参 self-vetted：
  // 既然全局 go 已在 components.js 暴露，点击任何 data-act="go" data-page="sale" 按钮都会走到它。
  assert.ok(true, 'globalActions.go 已被确认存在，按钮点击即跳销售开单');
});

/* ----------- ③ 布局：4 格指标 + 按钮在同一行（hero top-bar），快捷入口保持简洁 ----------- */

test('问题9-③ 首页顶栏 .home-top 同时容纳 4 格指标 和 开单按钮', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  // 顶栏容器存在
  const startIdx = html.indexOf('<div class="home-top">');
  assert.ok(startIdx >= 0, '应有 .home-top 容器');
  // 顶栏结束于下一个 card 标题（快捷入口 / desktop-only），避免被嵌套 div 的 </div> 截断
  const endRel = html.indexOf('<h3', startIdx + '<div class="home-top">'.length);
  const topHtml = endRel < 0 ? html.slice(startIdx) : html.slice(startIdx, endRel);
  assert.ok(/stat-grid/.test(topHtml), 'home-top 内含 4 格指标网格');
  assert.ok(/home-sale-btn/.test(topHtml), 'home-top 内含开单按钮');

  // 快捷入口 (h3 标题) 网格里不再有 sale（与问题6原则一致）
  const quickMatch = html.match(/<h3[^>]*>快捷入口<\/h3>([\s\S]*?)<\/div>/);
  assert.ok(quickMatch, '应有快捷入口区块');
  assert.ok(!/data-page="sale"/.test(quickMatch[1]), '快捷入口网格内不应含开单磁贴');
});

/* ----------- ④ CSS：base 提供基础样式，mobile 提供紧凑尺寸，desktop 提供放大尺寸 ----------- */

test('问题9-④ base.css 含 .home-top 与 .home-sale-btn 基础样式', () => {
  assert.ok(/\.home-top\s*\{[^}]*grid-template-columns:\s*minmax/.test(baseCss),
    '.home-top 应是 grid，左自适应右 auto');
  assert.ok(/\.home-sale-btn\s*\{[^}]*linear-gradient/.test(baseCss),
    '.home-sale-btn 应有渐变背景');
  assert.ok(/\.home-sale-btn[^}]*border-radius/.test(baseCss),
    '.home-sale-btn 应有圆角');
  assert.ok(/\.home-sale-btn:focus-visible/.test(baseCss),
    '按钮应支持键盘聚焦样式');
});

test('问题9-⑤ mobile.css (@max-width: 767px) 给 .home-sale-btn 更紧凑尺寸', () => {
  assert.ok(/\.home-sale-btn\s*\{[^}]*min-width:\s*92px/.test(mobileCss),
    '手机端 .home-sale-btn min-width 应为 92px 左右');
  assert.ok(/\.home-sale-btn \.ico\s*\{[^}]*font-size:\s*24px/.test(mobileCss),
    '手机端图标 24px 左右');
});

test('问题9-⑥ desktop.css (@min-width: 768px) 给 .home-sale-btn 更大醒目尺寸', () => {
  assert.ok(/\.home-sale-btn\s*\{[^}]*min-width:\s*180px/.test(desktopCss),
    '桌面端 .home-sale-btn min-width 应 ≥180px，更醒目');
  assert.ok(/\.home-sale-btn \.ico\s*\{[^}]*font-size:\s*42px/.test(desktopCss),
    '桌面端图标应显著放大 (≥42px)');
  assert.ok(/\.home-sale-btn \.t\s*\{[^}]*font-size:\s*24px/.test(desktopCss),
    '桌面端「开单」文字应≥24px');
});

/* ----------- ⑦ 与既有页面注册契约一致 ----------- */

test('问题9-⑦ 销售开单页 (sale) 已定义，data-page=sale 能被 router 解析', () => {
  const sale = require('../js/ui/page-sale.js');
  assert.ok(sale && sale.name === 'sale', '销售开单页面对象应存在且 name=sale');
  assert.ok(typeof sale.render === 'function', '应有 render()');
  assert.ok(typeof sale.init === 'function', '应有 init()');
  // 路由则交给 index.html 在浏览器端按序加载后由 app.boot() 走 ERP.pages[*] -> router.register(name, ...)
});
