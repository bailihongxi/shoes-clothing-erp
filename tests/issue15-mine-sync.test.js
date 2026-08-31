/**
 * tests/issue15-mine-sync.test.js —— 问题15-② 我的页云同步卡按图1重排
 *
 * 图1 关键点：
 *   标题：「☁ 云同步 (GitHub Pages)」 + 右上角「同步设置」边框按钮
 *   主按钮（横向并排 2 列）：
 *     - 「☁ 同步到云端」薄荷绿背景 + 白字
 *     - 「⬇ 从云端恢复」白底 + 灰边框
 *   说明：把本机账本加密上传到仓库固定路径，每次覆盖历史…
 *   状态：还没同步过（未同步时）
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { newCtx } = require('./helpers/ctx.js');
const minePage = require('../js/ui/page-mine.js');
const baseCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');

/* ========== DOM 结构 ========== */

test('问题15-②：云同步标题改为「☁ 云同步 (GitHub Pages)」', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/☁\s*云同步/.test(html), '保留「☁ 云同步」开头');
  assert.ok(/云同步[\s\S]*?\(GitHub Pages\)/.test(html), '副标题「(GitHub Pages)」');
});

test('问题15-②：「同步设置」上移到右上角（与标题并排）', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  // 标题和同步设置按钮都在 .sync-head 容器内
  const headMatch = html.match(/<div class="sync-head">([\s\S]*?)<\/div>\s*<div class="sync-actions"/);
  assert.ok(headMatch, 'sync-head 应包裹「标题 + 设置按钮」，后跟 sync-actions');
  const head = headMatch[1];
  assert.ok(/class="sync-title"/.test(head), '左：sync-title');
  assert.ok(/class="sync-setting-btn"/.test(head), '右：sync-setting-btn 边框按钮');
  assert.ok(/data-act="toggle-sync-cfg"/.test(head), '同步设置按钮 data-act');
});

test('问题15-②：主按钮改成 2 列并排：cloud-up（绿）+ cloud-down（白）', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  // sync-actions 容器
  const actionsMatch = html.match(/<div class="sync-actions">([\s\S]*?)<\/div>\s*<div class="sync-tip"/);
  assert.ok(actionsMatch, 'sync-actions 应包裹 2 主按钮');
  const actions = actionsMatch[1];
  assert.ok(/<button class="sync-btn cloud-up"[^>]*data-act="sync-up"/.test(actions), 'cloud-up 主按钮');
  assert.ok(/<button class="sync-btn cloud-down"[^>]*data-act="sync-down"/.test(actions), 'cloud-down 主按钮');
  // 文字 + 图标
  assert.ok(/☁[\s\S]*同步到云端/.test(actions) || /<span class="ico">☁<\/span>[\s\S]*同步到云端/.test(actions), 'cloud-up 含 ☁ 图标 + 同步到云端');
  assert.ok(/<span class="ico">⬇<\/span>[\s\S]*从云端恢复/.test(actions), 'cloud-down 含 ⬇ 图标 + 从云端恢复');
});

test('问题15-②：图1 风格说明文案（加粗 + 中文关键句）', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/<div class="sync-tip">[\s\S]*?每次覆盖历史/.test(html), '提示语保留「每次覆盖历史」');
  assert.ok(/[\s\S]*?输入同一同步口令即可拿到最新数据/.test(html), '提示语保留「输入同一同步口令即可拿到最新数据」');
});

test('问题15-②：未同步状态文案为「还没同步过」', () => {
  const ctx = newCtx();
  const html = minePage.render(ctx, minePage.init(ctx));
  assert.ok(/<div class="sync-status">[\s\S]*?还没同步过/.test(html), 'sync-status 应显示「还没同步过」');
});

test('问题15-②：动作注册 3 个 sync-* 动作不变', () => {
  const ctx = newCtx();
  minePage.init(ctx);
  assert.strictEqual(typeof minePage.actions['sync-up'], 'function');
  assert.strictEqual(typeof minePage.actions['sync-down'], 'function');
  assert.strictEqual(typeof minePage.actions['toggle-sync-cfg'], 'function');
});

/* ========== CSS 视觉（图1 风格）========== */

test('问题15-②：base.css 含 cloud-up（绿底）和 cloud-down（白底边框）样式', () => {
  assert.ok(/\.sync-btn\.cloud-up\s*\{[^}]*background:\s*var\(--c-mint/.test(baseCss), 'cloud-up 绿底（mint 变量）');
  assert.ok(/\.sync-btn\.cloud-down\s*\{[^}]*background:\s*#fff[^}]*border[^}]*1px/.test(baseCss), 'cloud-down 白底 + 1px 边框');
  // 圆角样式（按图1 圆形胶囊）
  assert.ok(/border-radius:\s*999px/.test(baseCss), 'sync-btn 用 999px 圆角胶囊');
});

test('问题15-②：sync-actions 横向 2 列等宽布局', () => {
  const m = baseCss.match(/\.sync-actions\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr[^}]*\}/);
  assert.ok(m, 'sync-actions 用 grid 1fr 1fr 等宽布局');
});

test('问题15-②：mobile.css @media 中云同步按钮不破图（手机端 2 列仍并排）', () => {
  const m = mobileCss.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'mobile.css 媒体查询块');
  // 没有破坏性覆盖
  const block = m[1];
  // sync-actions 应该不会被覆盖为单列
  const saOverride = block.match(/\.sync-actions\s*\{[^}]*grid-template-columns:\s*1fr\s*\}/);
  assert.ok(!saOverride, '手机端不应将云同步改为单列（2 列并排更紧凑）');
});
