/**
 * 问题11 回归测试
 *
 * 严禁：不能删/跳任何已有用例；本题新增测试用例全部追加于此文件。
 * 设计目标：
 *  - 兜底真实复现「按 index.html 顺序加载」时 本地 file:// 启动必须 0 报错；
 *  - 审计代码：未来若再有人写出「IIFE 顶层立即读 root.ERP.x」这种脆弱模式，本测试要拦住；
 *  - 验证 db.js / repo.js 在 schema 较晚就位时也能安全 no-op，不抛错。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

/* ---------------- 辅助：从 index.html 里抠 script src 顺序 ---------------- */

function parseScriptOrder() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /<script\s+src="(js\/[^"]+)"/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

/* 在子进程里跑脚本：清 ERP、清缓存、按顺序 require，模拟浏览器 */
function simulateBrowserLoad(scriptOrder) {
  const code = [
    "'use strict';",
    "const path = require('path');",
    "const root = " + JSON.stringify(ROOT) + ";",
    "const order = " + JSON.stringify(scriptOrder) + ";",
    "if (typeof globalThis !== 'undefined') {",
    "  delete globalThis.ERP;",
    "}",
    "const cacheKeys = Object.keys(require.cache).filter((k) => k.indexOf(path.join(root, 'js')) !== -1);",
    "cacheKeys.forEach((k) => delete require.cache[k]);",
    "for (const rel of order) {",
    "  try {",
    "    require(path.join(root, rel));",
    "  } catch (err) {",
    "    console.error('LOAD_FAIL: ' + rel + ' -> ' + err.message);",
    "    process.exit(2);",
    "  }",
    "}",
    "console.log('LOAD_OK: count=' + order.length);"
  ].join('\n');
  return spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
}

/* 把 JS 字符串做成「全角空白归零」并彻底丢掉反斜杠后再做包含判断 */
function norm(s) {
  return s.replace(/[\s\u3000]+/g, '');
}

/* ---------------- ① 代码静态审计：db.js / repo.js 不再用脆弱模式 ---------------- */

test('问题11-① db.js / repo.js 已改造：不使用 IIFE 顶层立即读 root.ERP.x', () => {
  const dbSrc = fs.readFileSync(path.join(ROOT, 'js/store/db.js'), 'utf8');
  const repoSrc = fs.readFileSync(path.join(ROOT, 'js/store/repo.js'), 'utf8');
  const dbN = norm(dbSrc);
  const repoN = norm(repoSrc);

  // 早期反例写法：var schema = (typeof module !== 'undefined' && module.exports) ? require('../core/schema.js') : root.ERP && root.ERP.schema;
  assert.ok(!dbN.includes("var schema =(typeof module"),
    'db.js 已不应再用 typeof module ? require : root.ERP.schema 顶层立即求值');
  assert.ok(!repoN.includes("var schema =(typeof module"),
    'repo.js 已不应再用 typeof module ? require : root.ERP.schema 顶层立即求值');
  assert.ok(!repoN.includes("var util =(typeof module"),
    'repo.js 已不应再用 typeof module ? require : root.ERP.util 顶层立即求值');

  // 防御层：必须保留延迟读函数
  assert.ok(/\bfunction\s+schemaRef\b/.test(dbSrc), 'db.js 应有 schemaRef 延迟读函数');
  assert.ok(/\bfunction\s+safeKeyPath\b/.test(dbSrc), 'db.js 应有 safeKeyPath 延迟读函数');
  assert.ok(/\bfunction\s+schemaRef\b/.test(repoSrc), 'repo.js 应有 schemaRef 延迟读函数');
  assert.ok(/\bfunction\s+utilRef\b/.test(repoSrc), 'repo.js 应有 utilRef 延迟读函数');
});

/* ---------------- ② 顺序一致性：index.html 加载顺序与 JS 模块分层匹配 ---------------- */

test('问题11-② index.html 加载顺序：core/schema.js 必须早于 store/db.js & store/repo.js', () => {
  const order = parseScriptOrder();
  const idx = (needle) => order.indexOf(needle);
  assert.ok(idx('js/core/schema.js') >= 0, 'index.html 应引用 js/core/schema.js');
  assert.ok(idx('js/store/db.js') >= 0, 'index.html 应引用 js/store/db.js');
  assert.ok(idx('js/store/repo.js') >= 0, 'index.html 应引用 js/store/repo.js');
  assert.ok(idx('js/core/engine.js') >= 0, 'index.html 应引用 js/core/engine.js');
  assert.ok(
    idx('js/core/schema.js') < idx('js/store/db.js'),
    'js/core/schema.js 必须在 js/store/db.js 之前（问题11 真正根因）'
  );
  assert.ok(
    idx('js/core/schema.js') < idx('js/store/repo.js'),
    'js/core/schema.js 必须在 js/store/repo.js 之前'
  );
});

/* ---------------- ③ 实际仿真：按 index.html 顺序加载，全部不抛错 ---------------- */

test('问题11-③ 仿真浏览器加载：按 index.html 顺序 require 所有核心模块，0 LOAD_FAIL', () => {
  const order = parseScriptOrder();
  // ui/* 与 app.js 在 Node 下浏览器 DOM 不存在的路径上会抛错，这里只验证核心+存储
  const filtered = order.filter((p) =>
    p.indexOf('js/ui/') !== 0 && p !== 'js/app.js'
  );
  const res = simulateBrowserLoad(filtered);
  assert.strictEqual(res.status, 0,
    '加载仿真失败：stderr=' + (res.stderr || '') + ' stdout=' + (res.stdout || ''));
  assert.ok(/LOAD_OK/.test(res.stdout), '加载仿真未输出 LOAD_OK：' + res.stdout);
});

/* ---------------- ④ 防御层：schema 较晚就位时，db.create 不抛错 ---------------- */

test('问题11-④ db.create 在 schema 加载前先加载、再就位 schema 后调用，不应抛错', async () => {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(ROOT, 'js')) !== -1) delete require.cache[k];
  });
  delete globalThis.ERP;
  // 先加载 db（这时 schema 还没就位），闭包内 schema 可能是 null
  const db = require(path.join(ROOT, 'js/store/db.js'));
  // 再加载 schema（schema 就位）
  require(path.join(ROOT, 'js/core/schema.js'));
  // 调用 db.create，必须不抛错（schemaRef / safeKeyPath 应正确回填）
  await assert.doesNotReject(
    () => db.create({ backend: db.memoryBackend() }),
    'schema 较晚就位时 db.create 不应抛错（schemaRef 兜底生效）'
  );
});

/* ---------------- ⑤ 防御层：repo.ctx.touch 不抛错 ---------------- */

test('问题11-⑤ schema 较晚就位时，ctx.touch 能正常打 dirty，不抛错', () => {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(ROOT, 'js')) !== -1) delete require.cache[k];
  });
  delete globalThis.ERP;
  const repo = require(path.join(ROOT, 'js/store/repo.js'));
  const schema = require(path.join(ROOT, 'js/core/schema.js'));
  const data = schema.emptyData();
  const ctx = repo.createContext(data);
  assert.doesNotThrow(() => {
    ctx.touch('products', { styleCode: 'X001', name: '小白鞋' });
    ctx.touch('skus', { id: 'X0010138', styleCode: 'X001', stock: 1 });
  }, 'touch 不应抛错');
  const dirty = ctx.takeDirty();
  assert.strictEqual((dirty.products || []).length, 1, 'products dirty 应有 1 条');
  assert.strictEqual((dirty.skus || []).length, 1, 'skus dirty 应有 1 条');
});

/* ---------------- ⑥ 端到端：保存出单不再 "null is not an object (evaluating 'repo.log')" ---------------- */

test('问题11-⑥ 端到端：保存销售单 + 同步日志依然正常（问题10 保护不被回归）', () => {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(path.join(ROOT, 'js')) !== -1) delete require.cache[k];
  });
  delete globalThis.ERP;
  const schema = require(path.join(ROOT, 'js/core/schema.js'));
  const util = require(path.join(ROOT, 'js/core/util.js'));
  require(path.join(ROOT, 'js/store/db.js'));
  const repo = require(path.join(ROOT, 'js/store/repo.js'));
  const engine = require(path.join(ROOT, 'js/core/engine.js'));

  // 准备数据
  const data = schema.emptyData();
  data.products.push({ styleCode: 'X001', name: '小白鞋', category: '鞋', barcode: 'X001', costPrice: 50, salePrice: 100, status: 'on' });
  data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 5, threshold: 1, costPrice: 50 });
  const ctx = repo.createContext(data);

  // 关键断言：调用不会抛 "undefined is not an object (evaluating 'schema.KEY_PATH')"
  const r = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 1, price: 100, costSnapshot: 50 }],
    payments: [{ method: 'cash', amount: 100 }],
    date: util.today()
  });
  assert.strictEqual(r.ok, true, 'saveSale 应成功：' + (r.error || ''));
  // 操作日志
  assert.ok((ctx.data.logs || []).length >= 1, '操作日志应至少 1 条');
});
