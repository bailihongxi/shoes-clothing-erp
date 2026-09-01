/**
 * 品牌 Logo / Icon：favicon、侧栏/顶栏/手机头部/锁屏 logo 图片、manifest 图标
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('favicon：index.html 引用品牌图标（icon-192.png + apple-touch-icon）', () => {
  const html = read('index.html');
  assert.ok(/<link rel="icon" type="image\/png" href="assets\/icon-192\.png">/.test(html), '含 favicon link');
  assert.ok(/<link rel="apple-touch-icon" href="assets\/icon-192\.png">/.test(html), '含 apple-touch-icon');
});

test('图标资源文件存在（192/512/原始图）', () => {
  ['assets/icon.png', 'assets/icon-192.png', 'assets/icon-512.png'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f + ' 应存在');
  });
});

test('界面 logo：侧栏 / 手机头部 / 顶栏头像 / 锁屏均使用品牌图片（V3：账号头像优先，品牌图回退）', () => {
  const appJs = read('js/app.js');
  const html = read('index.html');
  // 品牌图仍作为默认回退资源存在
  assert.ok(appJs.includes('assets/icon-192.png'), 'app.js 含品牌图回退路径');
  // V3：头像优先逻辑（侧栏/头部）
  assert.ok(appJs.includes("var brandLogo = (app.ctx.settings.avatar) ? app.ctx.settings.avatar : 'assets/icon-192.png';"), '侧栏/头部头像优先逻辑');
  assert.ok(appJs.includes('sbrand.innerHTML'), '侧栏 brand 渲染存在');
  assert.ok(appJs.includes('brand.innerHTML'), '手机头部 brand 渲染存在');
  // 锁屏
  assert.ok(appJs.includes('<img class="lock-logo" src="assets/icon-192.png" alt="">'), '锁屏用 logo 图片');
  // 顶栏头像
  assert.ok(html.includes('<img src="assets/icon-192.png" alt="我的">'), '顶栏头像用 logo 图片');
});

test('logo 图片样式：侧栏/头部/锁屏/头像均含图片适配（object-fit 圆角）', () => {
  const base = read('css/base.css');
  const desk = read('css/desktop.css');
  assert.ok(/\.app-sidebar \.brand img\.logo\s*{[^}]*object-fit:\s*cover/.test(base), '侧栏 logo 图片裁剪适配');
  assert.ok(/\.app-header \.brand img\.brand-logo\s*{[^}]*border-radius:\s*50%/.test(base), '头部 logo 圆形');
  assert.ok(/\.lock-card \.lock-logo\s*{[^}]*border-radius:\s*50%/.test(base), '锁屏 logo 圆形');
  assert.ok(/\.top-bar \.avatar img\s*{[^}]*object-fit:\s*cover/.test(desk), '顶栏头像图片裁剪适配');
});

test('manifest：PWA 图标指向 assets 下已存在文件', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest 含图标');
  manifest.icons.forEach((ic) => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', ic.src)), ic.src + ' 文件存在');
    assert.ok(/^assets\//.test(ic.src), ic.src + ' 位于 assets/');
  });
});

test('首页 banner：手机/电脑端显示店铺头像（无则品牌 logo）+ 动态店名', () => {
  const homeJs = read('js/ui/page-home.js');
  const css = read('css/base.css');
  // V3：头像优先、品牌图回退、店名动态
  const avatarCount = (homeJs.match(/ctx\.settings\.avatar/gi) || []).length;
  assert.ok(avatarCount >= 2, '手机/电脑端 banner 均含头像优先逻辑（' + avatarCount + ' 处）');
  assert.ok(homeJs.includes("'assets/icon-192.png'"), 'banner 含品牌图回退路径');
  assert.ok(homeJs.includes("ctx.settings.shopName || '我的鞋服店'"), 'banner 店名动态显示账号店铺名');
  assert.ok(/\.page-banner \.banner-title \.banner-logo\s*{[^}]*border-radius:\s*50%/.test(css), 'banner logo 圆形样式');
});
