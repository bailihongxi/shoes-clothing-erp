/**
 * ui-redesign-tokens.test.js —— 问题14-①：薄荷绿设计令牌 + 通用组件 CSS 验证
 *
 * 验证：
 * 1. base.css 包含完整的薄荷绿主题 CSS 变量
 * 2. 所有 v2 新组件类（page-banner / stat-card / quick-circle / empty-state /
 *    payment-selector / top-bar / filter-bar / product-card / rank-list /
 *    shop-info-card / overview-head / segmented / filter-bar）已声明
 * 3. sw.js CACHE 升级到 v4
 * 4. CSS 文件可被 Node 加载无语法错
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('base.css 包含完整薄荷绿主题 CSS 变量（--c-mint-50 → --c-mint-800）', () => {
  const css = readFile('css/base.css');
  for (const v of ['50', '100', '200', '300', '400', '500', '600', '700', '800']) {
    assert.ok(
      css.includes('--c-mint-' + v + ':'),
      '缺少 CSS 变量 --c-mint-' + v
    );
  }
  // 强调色
  assert.ok(css.includes('--c-mint-600: #3FB89B'), '主色 #3FB89B 未正确配置');
  assert.ok(css.includes('--c-mint-400: #6CC4B0'), 'banner 主色 #6CC4B0 未正确配置');
  // 兼容旧变量名
  assert.ok(css.includes('--c-primary: #3FB89B'), '兼容旧 --c-primary 指向新主色');
});

test('base.css 已声明所有 v2 新组件类', () => {
  const css = readFile('css/base.css');
  const mustHave = [
    '.page-banner',
    '.page-banner .banner-title',
    '.page-banner .banner-action',
    '.page-banner::before', '.page-banner::after',
    '.stat-card',
    '.stat-card .icon.mint',
    '.stat-card .icon.gray',
    '.stat-card .icon.pink',
    '.stat-card .icon.peach',
    '.stat-card .icon.lavender',
    '.stat-card .icon.lemon',
    '.stat-card .value',
    '.stat-card .delta.up',
    '.stat-card .delta.down',
    '.quick-circles',
    '.quick-circle',
    '.quick-circle .disc',
    '.quick-circle.c-green',
    '.quick-circle.c-blue',
    '.quick-circle.c-teal',
    '.quick-circle.c-peach',
    '.quick-circle.c-purple',
    '.quick-circle.c-pink',
    '.empty-state',
    '.empty-state .icon-disc',
    '.pay-grid',
    '.pay-cell',
    '.pay-cell.on',
    '.segmented',
    '.segmented .seg-item.on',
    '.segmented .seg-item .count',
    '.filter-bar',
    '.product-card',
    '.product-card .thumb',
    '.product-card .add-cart',
    '.rank-list',
    '.rank-row',
    '.rank-row:nth-child(1) .rank-num',
    '.shop-info-card',
    '.shop-info-card .avatar',
    '.overview-head',
    '.overview-head .title'
  ];
  for (const sel of mustHave) {
    assert.ok(css.includes(sel), '缺少选择器 ' + sel);
  }
});

test('mobile.css 已适配 v2：薄荷绿 Tab 激活态、quick-circle 6 列、stat-card 紧凑', () => {
  const css = readFile('css/mobile.css');
  assert.ok(css.includes('.tab-item.on'), 'mobile.css 应保留 .tab-item.on');
  assert.ok(
    css.includes('var(--c-mint-600)'),
    'mobile.css 应使用 v2 薄荷绿主色'
  );
  assert.ok(css.includes('.quick-circles'), 'mobile.css 应定义 .quick-circles');
  assert.ok(css.includes('.stat-card'), 'mobile.css 应定义 .stat-card');
  assert.ok(css.includes('.desktop-only'), 'mobile.css 应隐藏 desktop-only');
});

test('desktop.css 已适配 v2：薄荷绿侧栏 + top-bar + 3 列开单布局', () => {
  const css = readFile('css/desktop.css');
  assert.ok(css.includes('.app-sidebar'), 'desktop.css 应保留 .app-sidebar');
  assert.ok(css.includes('.nav-item.on'), 'desktop.css 应保留 .nav-item.on');
  assert.ok(
    css.includes('var(--c-mint-700)') || css.includes('var(--c-mint-500)'),
    'desktop.css 应使用 v2 薄荷绿主色'
  );
  // v2 电脑端专属组件
  for (const sel of [
    '.top-bar',
    '.top-bar .shop-name',
    '.top-bar .global-search input',
    '.top-bar .bell',
    '.top-bar .bell .dot',
    '.top-bar .avatar',
    '.sale-three-col',
    '.trend-chart'
  ]) {
    assert.ok(css.includes(sel), 'desktop.css 缺少选择器 ' + sel);
  }
  assert.ok(css.includes('.mobile-only'), 'desktop.css 应隐藏 mobile-only');
});

test('sw.js CACHE 已升级到 v7（V3 多账号后重新预缓存，修复手机登录空白页）', () => {
  const sw = readFile('sw.js');
  assert.ok(sw.includes("CACHE = 'shoe-erp-v7'"), 'sw.js CACHE 应为 shoe-erp-v7');
  assert.ok(!sw.includes("CACHE = 'shoe-erp-v6'"), 'CACHE 不再是 v6（旧 PWA 不会重新预缓存）');
  // SHELL 列表必须包含全部 CSS 文件 + V3 新增文件
  assert.ok(sw.includes('./css/base.css'), 'SHELL 应包含 css/base.css');
  assert.ok(sw.includes('./css/mobile.css'), 'SHELL 应包含 css/mobile.css');
  assert.ok(sw.includes('./css/desktop.css'), 'SHELL 应包含 css/desktop.css');
  assert.ok(sw.includes('./css/print.css'), 'SHELL 应包含 css/print.css');
  assert.ok(sw.includes('./js/ui/page-inventory.js'), 'SHELL 应包含 page-inventory.js');
  assert.ok(sw.includes('./js/ui/page-mine.js'), 'SHELL 应包含 page-mine.js');
  // V3 新增文件（缺失会导致手机端登录页空白）
  assert.ok(sw.includes('./js/core/accounts.js'), 'SHELL 应包含 V3 accounts.js');
  assert.ok(sw.includes('./js/core/legacy-migrate.js'), 'SHELL 应包含 V3 legacy-migrate.js');
  assert.ok(sw.includes('./js/ui/page-login.js'), 'SHELL 应包含 V3 page-login.js');
});

test('CSS 文件无大括号不匹配（Node 简单静态校验）', () => {
  function check(rel) {
    const css = readFile(rel);
    // 去除字符串后统计大括号（粗略）
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 去注释
      .replace(/'[^']*'/g, "''")            // 去单引号串
      .replace(/"[^"]*"/g, '""');           // 去双引号串
    const open = (stripped.match(/\{/g) || []).length;
    const close = (stripped.match(/\}/g) || []).length;
    assert.strictEqual(open, close, rel + ' 大括号数量不匹配: ' + open + ' != ' + close);
  }
  check('css/base.css');
  check('css/mobile.css');
  check('css/desktop.css');
});
