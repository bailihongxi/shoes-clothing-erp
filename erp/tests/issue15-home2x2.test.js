/**
 * tests/issue15-home2x2.test.js —— 问题15-① 首页 stat 2x2 + 右侧大按钮（图2）字号控制
 *
 * 设计图 1-2：
 *   [今日营收] [今日单数]   [   ]
 *   [今日毛利] [预警款数]   [开单·扫码/选货]
 *
 * 验证：
 *  1. 4 个 stat 按「今日营收/今日单数/今日毛利/预警款数」顺序 + 文案
 *  2. 开单按钮占 .home-sale-row 类（CSS grid-row span 2）
 *  3. mobile.css @media 内 .home-stat-2x2 使用 3 列网格，前 2 列等宽、第 3 列 0.85fr
 *  4. mobile.css 中 .home-stat-2x2 .stat-card .value font-size ≤ 22px（营收/毛利标签不再过大）
 *  5. mobile.css 中 .home-stat-2x2 .stat-card .label font-size ≤ 14px
 *  6. 移除旧的 home-stat-3col 与 home-sale-col 残留
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { newCtx } = require('./helpers/ctx.js');
const home = require('../js/ui/page-home.js');
const mobileCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');

function seedShop(ctx) {
  ctx.data.shop = { name: '我的鞋服店' };
  ctx.settings.shopName = '我的鞋服店';
}

/* ========== DOM 结构断言 ========== */

test('问题15-①：手机端 stat 2x2 按图2 4 项文案（今日营收/单数/毛利/预警）', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  // 仅检视 .mobile-only stat-grid 内的文案
  const start = html.indexOf('home-stat-2x2');
  const end = html.indexOf('mobile-only card', start);
  const block = html.slice(start, end > 0 ? end : html.length);
  assert.ok(/今日营收/.test(block), '应有「今日营收」');
  assert.ok(/今日单数/.test(block), '应有「今日单数」');
  assert.ok(/今日毛利/.test(block), '应有「今日毛利」');
  assert.ok(/预警款数/.test(block), '应有「预警款数」');
  // 顺序（图2：营收→单数→毛利→预警）
  const a = block.indexOf('今日营收');
  const b = block.indexOf('今日单数');
  const c = block.indexOf('今日毛利');
  const d = block.indexOf('预警款数');
  assert.ok(a < b && b < c && c < d, 'DOM 顺序：营收→单数→毛利→预警');
  // 手机端 2x2 块不再写「今日应收/今日开单」（电脑端现也已统一为「今日营收/今日单数」）
  assert.ok(!/今日应收/.test(block), '手机端已移除旧文案「今日应收」');
  assert.ok(!/今日开单/.test(block), '手机端已移除旧文案「今日开单」');
});

test('问题15-①：开单按钮使用 home-sale-row（图2 右侧跨 2 行）', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  const btnMatch = html.match(/<button[^>]*class="home-sale-btn home-sale-row"[^>]*>/);
  assert.ok(btnMatch, '应有 home-sale-row 类按钮');
  assert.ok(/data-act="go"\s+data-page="sale"/.test(btnMatch[0]), '按钮跳转 sale');
  // 已废弃的 home-sale-col 不应再出现
  assert.ok(!/home-sale-col/.test(html), '已移除旧按钮类 home-sale-col');
});

/* ========== CSS 字号控制（解决「营收/毛利标签过大」） ========== */

test('问题15-①：mobile.css 中 stat-card 字号被抑制到 ≤ 22px（图2 label/value 紧凑）', () => {
  // 截取 @media (max-width: 767px) 块
  const m = mobileCss.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'mobile.css 应有 @media (max-width: 767px)');
  const block = m[1];
  // 提取 .home-stat-2x2 .stat-card .value font-size
  const valMatch = block.match(/\.home-stat-2x2\s+\.stat-card\s+\.value\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(valMatch, '应有 .home-stat-2x2 .stat-card .value font-size');
  const px = parseInt(valMatch[1], 10);
  assert.ok(px <= 22, '手机 stat 值字号应 ≤ 22px（图2 紧凑），实际 ' + px + 'px');
  // label 字号 ≤ 14px
  const lblMatch = block.match(/\.home-stat-2x2\s+\.stat-card\s+\.label\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(lblMatch, '应有 .home-stat-2x2 .stat-card .label font-size');
  const lpx = parseInt(lblMatch[1], 10);
  assert.ok(lpx <= 14, '手机 stat label 字号应 ≤ 14px，实际 ' + lpx + 'px');
});

test('问题15-①：mobile.css 中 .home-stat-2x2 grid 配置为「前 2 列等宽 + 第 3 列 0.85fr」', () => {
  const m = mobileCss.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m);
  const block = m[1];
  const gridMatch = block.match(/\.home-top\s+\.stat-grid\.home-stat-2x2\s*\{[^}]*grid-template-columns:\s*([^;]+);/);
  assert.ok(gridMatch, '应有 grid-template-columns');
  const cols = gridMatch[1];
  assert.ok(/1fr\s+1fr\s+0\.85fr/.test(cols), '图2 grid 列应为 1fr 1fr 0.85fr（4 指标 2x2 + 右侧 0.85fr 大按钮），实际：' + cols);
  // 开单按钮 grid-row: span 2
  const rowMatch = block.match(/\.home-stat-2x2\s+\.home-sale-btn\.home-sale-row\s*\{[^}]*grid-row:\s*(?:1\s*\/\s*)?span\s+2/);
  assert.ok(rowMatch, '开单按钮应 grid-row: span 2（跨两行）');
});

test('问题15-①：旧的 home-stat-3col / home-sale-col 残留已清理', () => {
  assert.ok(!/home-stat-3col/.test(mobileCss), 'mobile.css 应不再出现 home-stat-3col');
  assert.ok(!/home-sale-col/.test(mobileCss), 'mobile.css 应不再出现 home-sale-col');
});
