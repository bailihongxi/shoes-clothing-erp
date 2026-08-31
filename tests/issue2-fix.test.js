// 问题 2 修复测试：CSV 导入 / 新款建档 / 新建进货单 按钮无反应
// 根因：js/app.js 中 afterAction() 调用了未定义的全局函数 commit()，
//       实际只有 app.commit；每次点击按钮都抛 ReferenceError: commit is not defined，
//       render() 永远不被调用 → "页面无任何反应"。
// 覆盖：
//   ① 修复后 app.commit 存在且可调用
//   ② afterAction 调用 app.commit 而非未定义变量
//   ③ jsdom 完整模拟：点击"新款建档"按钮 → page.tab 切换到 'new' 并渲染表单
//   ④ jsdom 完整模拟：点击"CSV 导入"按钮 → page.tab 切换到 'csv' 并渲染 CSV 视图
//   ⑤ jsdom 完整模拟：点击"新建进货单"按钮 → page.tab 切换到 'form'
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
// jsdom 装在 workbuddy 全局 node_modules 里；项目本身零依赖
let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  try {
    JSDOM = require('/Users/ybf/.workbuddy/binaries/node/workspace/node_modules/jsdom').JSDOM;
  } catch (e2) {
    JSDOM = null;
  }
}

// 单元可测的副作用：app.js 必须在测试运行前挂载到 globalThis.ERP.app
require('../js/app.js');
const app = globalThis.ERP && globalThis.ERP.app;

/* ---------------- 单元：app.commit 可用 + afterAction 不抛 ReferenceError ---------------- */

test('app.commit 必须存在（commit 实际是挂在 app 上的具名函数表达式）', () => {
  assert.ok(app, 'ERP.app 必须存在');
  assert.strictEqual(typeof app.commit, 'function', 'app.commit 必须是函数');
});

test('bug 复现：旧代码若直接 await commit() 会抛 ReferenceError；修复后调用 app.commit() 不抛错', async () => {
  // 验证：不存在的全局函数 commit() 确实会抛 ReferenceError
  assert.throws(
    () => { (() => { var f = () => commit(); f(); })(); },
    /commit is not defined/,
    'sanity: 当前 Node 中 commit() 必须抛 ReferenceError，证明这就是线上 bug 的根因'
  );
  // 验证：app.commit() 不抛错
  // 没有 db/ctx 的情况下 app.commit 会直接 return {}
  const ret = await app.commit();
  assert.deepStrictEqual(ret, {}, '无 db/ctx 时 app.commit 应安全返回 {}');
});

test('app.js 全文不应再出现裸 await commit() 或裸 commit()（除内部具名函数表达式外）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // 截取 IIFE 内 / 非 app.commit 引用区段，检查是否还有裸露 commit() 调用
  // 允许具名函数表达式 function commit() 在 app.commit = ... 里出现
  // 但 async function commit(){...} 里和 async function afterAction(){...} 不应再有等待/调用 commit() 的语句
  const bugRegex = /await\s+commit\s*\(\s*\)/g;
  const matches = src.match(bugRegex);
  assert.strictEqual(matches, null, '不应再出现裸 await commit()；当前发现：' + JSON.stringify(matches));
});

/* ---------------- jsdom 端到端：完整加载页面 + 模拟 click ---------------- */

/** 在 jsdom 里加载完整 ERP 页面（含所有 <script>），等待 ERP.app.ready=true */
function bootJsdom() {
  if (!JSDOM) throw new Error('jsdom not available; please install it or set NODE_PATH');
  const ROOT = path.join(__dirname, '..');
  const order = [
    'js/core/util.js','js/core/schema.js','js/core/coding.js','js/core/docNo.js',
    'js/core/inventory.js','js/core/ledger.js','js/core/debt.js','js/core/profit.js',
    'js/core/backup.js','js/core/barcode.js','js/core/cart.js','js/core/engine.js',
    'js/store/db.js','js/store/repo.js',
    'js/ui/router.js','js/ui/components.js',
    'js/ui/page-home.js','js/ui/page-product.js','js/ui/page-purchase.js',
    'js/ui/page-sale.js','js/ui/page-inventory.js','js/ui/page-account.js',
    'js/ui/page-report.js','js/ui/page-setting.js','js/ui/page-mine.js',
    'js/barcode/render.js','js/barcode/label.js','js/barcode/scan.js','js/barcode/print-bt.js',
    'js/app.js'
  ];
  const inline = order.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n;\n');
  const html = '<!DOCTYPE html><html><body>' +
    '<div id="app">' +
    '<aside class="app-sidebar"><div class="brand">X</div><nav class="nav-list"></nav></aside>' +
    '<div class="app-column">' +
    '<header class="app-header"><span class="brand">X</span></header>' +
    '<main class="app-main"><div id="view"></div></main>' +
    '</div>' +
    '<nav class="app-tabbar"></nav>' +
    '</div>' +
    '<div id="toast-wrap"></div>' +
    '<script>' + inline + '</' + 'script>' +
    '</body></html>';
  const dom = new JSDOM(html, { url: 'file://' + ROOT + '/', runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

async function waitReady(win, maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (win.ERP && win.ERP.app && win.ERP.app.ready) return true;
    await new Promise(r => setTimeout(r, 30));
  }
  return false;
}

test('jsdom：商品档案页"＋ 新款建档"按钮点击后切换到表单视图', async () => {
  const win = bootJsdom();
  const ok = await waitReady(win);
  assert.ok(ok, 'ERP.app.ready 应为 true');
  win.location.hash = '#/product';
  await new Promise(r => setTimeout(r, 100));
  const view = win.document.getElementById('view');
  assert.match(view.innerHTML, /data-act="open-new"/, '列表页应有 open-new 按钮');

  // 点击前 view 是列表（包含搜索框 placeholder "搜索款号"）
  assert.match(view.innerHTML, /搜索款号 \/ 名称 \/ 条码/, '初始为列表');

  // 模拟点击
  const btn = view.querySelector('[data-act="open-new"]');
  assert.ok(btn, '应能找到按钮');
  btn.click();
  await new Promise(r => setTimeout(r, 100));

  // 修复后 view 应进入 renderForm（包含"新款建档"标题 + 表单字段）
  const html = view.innerHTML;
  assert.match(html, /新款建档/, '点击后应渲染"新款建档"标题（表单视图）');
  assert.match(html, /data-input="field"\s+data-name="name"/, '应有名称输入框');
  // 表单为空时会有错误提示"请填写商品名称"，或者填了之后会显示"将生成"；两者都说明已进入表单视图
  assert.ok(
    /将生成/.test(html) || /请填写商品名称/.test(html),
    '应进入表单视图（要么显示"将生成"预览，要么显示校验提示）'
  );
});

test('jsdom：商品档案页"📥 CSV 导入"按钮点击后切换到 CSV 视图', async () => {
  const win = bootJsdom();
  await waitReady(win);
  win.location.hash = '#/product';
  await new Promise(r => setTimeout(r, 100));
  const view = win.document.getElementById('view');

  const btn = view.querySelector('[data-act="open-csv"]');
  assert.ok(btn, '应能找到 CSV 按钮');
  btn.click();
  await new Promise(r => setTimeout(r, 100));

  const html = view.innerHTML;
  assert.match(html, /CSV 批量导入/, '点击后应进入 CSV 视图（标题）');
  assert.match(html, /粘贴 CSV 内容/, '应显示 CSV 提示');
});

test('jsdom：进货管理页"＋ 新建进货单"按钮点击后切换到表单视图', async () => {
  const win = bootJsdom();
  await waitReady(win);
  win.location.hash = '#/purchase';
  await new Promise(r => setTimeout(r, 100));
  const view = win.document.getElementById('view');

  // 列表视图有 "暂无进货单"
  assert.match(view.innerHTML, /暂无进货单/, '初始为空列表');

  const btn = view.querySelector('[data-act="open-new"]');
  assert.ok(btn, '应能找到新建进货单按钮');
  btn.click();
  await new Promise(r => setTimeout(r, 100));

  const html = view.innerHTML;
  assert.match(html, /新建进货单/, '点击后表单页应有"新建进货单"标题');
  assert.match(html, /按色码批量填数/, '应有"按色码批量填数"卡片');
  assert.match(html, /本次欠款/, '应有"本次欠款"预览区');
});
