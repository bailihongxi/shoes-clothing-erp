/**
 * 修复：手机版本登录为空白页
 * 根因：sw.js Service Worker 缓存列表缺少 V3 新增文件（accounts.js/page-login.js/legacy-migrate.js），
 *       且缓存版本号未升级，手机端 SW 返回缓存的旧版 index.html（无 V3 脚本）→ 登录页渲染失败空白。
 * 验证：CACHE 版本升级、SHELL 包含 V3 新增文件、导航请求后台更新。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('sw.js CACHE 版本已升级（不再是旧版 v6）', () => {
  const m = sw.match(/var CACHE\s*=\s*'([^']+)'/);
  assert.ok(m, '应定义 CACHE 变量');
  assert.notStrictEqual(m[1], 'shoe-erp-v6', '缓存版本应已升级，不能停留在 v6');
  assert.ok(/v\d+/.test(m[1]), '版本号格式应为 vN');
});

test('sw.js SHELL 包含 V3 新增核心文件', () => {
  const required = [
    './js/core/accounts.js',
    './js/core/legacy-migrate.js',
    './js/ui/page-login.js'
  ];
  required.forEach((f) => {
    assert.ok(sw.includes("'" + f + "'"), 'SHELL 应包含 ' + f);
  });
});

test('sw.js SHELL 包含所有已有页面和核心模块（无遗漏）', () => {
  // 核心模块
  ['util.js', 'schema.js', 'sync.js', 'db.js', 'repo.js', 'engine.js'].forEach((f) => {
    assert.ok(sw.includes(f), 'SHELL 应包含核心模块 ' + f);
  });
  // 所有业务页面
  ['page-home.js', 'page-product.js', 'page-sale.js', 'page-inventory.js',
   'page-mine.js', 'page-setting.js', 'page-report.js', 'page-login.js'].forEach((f) => {
    assert.ok(sw.includes(f), 'SHELL 应包含页面 ' + f);
  });
});

test('sw.js 导航请求使用 network-first（在线拿最新，离线回退缓存）', () => {
  // 导航请求块：先 fetch 网络，失败才回退缓存（避免长期停留在旧版）
  const navBlock = sw.slice(sw.indexOf("req.mode === 'navigate'"));
  assert.ok(navBlock.includes('fetch(req)'), '导航请求应优先 fetch 网络');
  assert.ok(navBlock.includes('caches.open(CACHE)'), '导航请求应将新响应写入缓存');
  assert.ok(navBlock.indexOf('fetch(req)') < navBlock.indexOf('caches.match'), 'fetch 应先于缓存匹配（network-first）');
  assert.ok(navBlock.includes("return cached || caches.match('./')") || navBlock.includes("cached || caches.match('./')"),
    '离线时应回退缓存外壳');
});

test('sw.js activate 事件清除旧版本缓存', () => {
  assert.ok(sw.includes("keys.filter(function (k) { return k !== CACHE; })"),
    'activate 应删除非当前版本的旧缓存');
  assert.ok(sw.includes('self.skipWaiting()'), 'install 应 skipWaiting 立即生效');
});
