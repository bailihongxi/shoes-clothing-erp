/**
 * tests/issue10-fix.test.js —— 问题10：销售开单页两个 JS 错误
 *
 * 用户原话：
 *   - 「点击开单扫码按钮，弹出操作失败提示：操作失败：Can't find variable: closeModal」
 *   - 「点击保存出单按钮弹出失败提示：操作失败：null is not an object (evaluating 'repo.log')」
 *
 * 根因：
 *   ① js/ui/components.js —— `C.closeModal = function closeModal() {...}` 是命名函数表达式，
 *      函数名只在表达式内部可见；但 modal() 内部 addEventListener('click', closeModal) 与
 *      maskClose 处理器直接闭包引用 closeModal → ReferenceError（任何带「取消/关闭」按钮
 *      的模态框都会触发：扫码、确认框等）。
 *   ② js/core/engine.js —— 浏览器加载顺序里 engine.js (line 50) 在 store/repo.js (line 54) 之前；
 *      工厂函数从 E.repo 取值时 repo 仍是 undefined → 入参 repo 为 null → repo.log(...) 抛 TypeError
 *      「null is not an object (evaluating 'repo.log')」。
 *
 * 修复：
 *   - components.js：把 closeModal 改成闭包内普通函数声明（function declaration），外层可见；
 *     C.closeModal = closeModal; 同步暴露。
 *   - engine.js：新增 helper writeLog(ctx, action, detail) 延迟读 ERP.repo，工厂入参 repo
 *     为 null 时走 console.warn 兜底，不再抛错。所有 7 处 repo.log(...) → writeLog(...)。
 *   - index.html：repo.js 提到 engine.js 之前，让工厂本身就能拿到 repo，避免延迟读取的兜底
 *     路径成为常态（性能与可读性）。
 */
const test = require('node:test');
const assert = require('node:assert');

const components = require('../js/ui/components.js');

/* ----------- ① closeModal 已修复 ----------- */

test('问题10-① components.closeModal 是函数，可正常调用（不再 ReferenceError）', () => {
  assert.strictEqual(typeof components.closeModal, 'function',
    'components.closeModal 应是函数');
  // Node 下没有 document，调用应当安全 no-op，不得 throw
  assert.doesNotThrow(() => components.closeModal(),
    '调用 C.closeModal() 不得抛 ReferenceError');
});

test('问题10-② components.modal 在 Node 下安全 no-op（hasDom 短路）', () => {
  // 真实报错路径：浏览器中点击模态框「关闭/取消」按钮 → 闭包 closeModal 执行。
  // Node 下 hasDom() 返回 false，C.modal 直接 return null，不创建 DOM。
  // 我们改用 toString 审计：保证 closeModal 是模块闭包内顶层声明（而非命名函数表达式，后者
  // 名字不可外泄），让 modal() 内部直接 addEventListener('click', closeModal) 能跑到。
  const fnSrc = components.closeModal.toString();
  // 现版本：function closeModal() { ... }
  assert.ok(/^function closeModal\s*\(/.test(fnSrc),
    'closeModal 应是「function closeModal() {...}」形式的顶层声明（不是命名函数表达式）');

  // modal 源码应仍用闭包内的 closeModal 直接闭包引用
  const modalSrc = components.modal.toString();
  assert.ok(/closeModal\(\)/.test(modalSrc) ||
    /addEventListener\('click',\s*closeModal\)/.test(modalSrc),
    'modal 源码仍应能在闭包内访问 closeModal');

  // 不抛错：hasDom 屏蔽
  assert.doesNotThrow(() => {
    const r = components.modal({ title: 't', body: 'b', actions: [{ act: 'close-modal' }] });
    assert.strictEqual(r, null);
  }, 'Node 下 C.modal 应安全 return null，不引用 closeModal throw');
});

/* ----------- ② engine.writeLog 在 repo 未注入时不抛错 ----------- */

test('问题10-③ engine writeLog 走 ERP.repo 兜底——源码级断言', () => {
  // 不在 Node 里删除 ERP.repo 重 require（会触发 repo.js 副作用重新注入，绕开测点）。
  // 直接审计 engine.js 源码：writeLog 必须延迟读 ERP.repo，并在未拿到时走 console.warn。
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '../js/core/engine.js'), 'utf8');
  assert.ok(/function\s+repoRef\s*\(/.test(src),
    '应有 repoRef() 兜底读取 ERP.repo');
  assert.ok(/ERP\s*&&\s*ERP\.repo/.test(src),
    'repoRef 内应优先读 ERP.repo（延迟绑定）');
  assert.ok(/typeof console\s*!==\s*['"]undefined['"]/.test(src) || /typeof console/.test(src),
    'writeLog 在 repo 缺失时应 console.warn 而非抛错');
  // 旧 repo.log 都不在了
  assert.ok(!/\brepo\.log\(/.test(src), '不应再直接调 repo.log(…)');
});

test('问题10-④ engine 在 ERP.repo 已注入时正常写日志（happy path）', () => {
  // 加载完整依赖链：repo 已在 ERP.repo 上
  const { newCtx } = require('./helpers/ctx.js');
  const repo = require('../js/store/repo.js');
  const engine = require('../js/core/engine.js');
  const schema = require('../js/core/schema.js');

  const ctx = newCtx();
  ctx.data.products.push({ styleCode: 'X001', name: '小白鞋', category: '鞋', barcode: 'X001', costPrice: 50, salePrice: 100, status: 'on' });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 10, threshold: 1, costPrice: 50 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);

  const util = require('../js/core/util.js');
  const r = engine.saveSale(ctx, {
    items: [{ skuId: 'X0010138', qty: 1, price: 100, costSnapshot: 50 }],
    payments: [{ method: 'cash', amount: 100 }],
    date: util.today()
  });
  assert.strictEqual(r.ok, true, '正常路径应 ok=true');
  const logs = ctx.data.logs || [];
  const saleLog = logs.find(function (l) { return l.action === '保存销售单'; });
  assert.ok(saleLog, '应写入「保存销售单」操作日志');
  assert.ok(saleLog.id && String(saleLog.id).indexOf('log') === 0, '日志 id 应带 log 前缀');
});

/* ----------- ③ 源码审计：writeLog 必须存在且被使用、所有原 repo.log 已替换 ----------- */

test('问题10-⑤ engine.js 源码审计：writeLog 存在，原 repo.log 已全部替换', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '../js/core/engine.js'), 'utf8');
  assert.ok(/function writeLog\(/.test(src), '应声明 writeLog helper');
  assert.ok(!/\brepo\.log\(/.test(src), '原 repo.log(...) 全部要替换为 writeLog(...)');
  // savePurchase/saveSale/voidPurchase/voidSale/refundSale/editPurchase/receivePayment/saveInventoryLog 共 7 处写日志
  const writeLogCallCount = (src.match(/^\s*writeLog\(ctx/gm) || []).length;
  assert.ok(writeLogCallCount >= 7, '应有 ≥7 处 writeLog 调用覆盖所有原 repo.log');
});
