/**
 * tests/issue13-fix.test.js —— 修复「退换页提交时误报请填写数量」+「PWA 缓存导致移动端无跳转」
 *
 * 根因：
 * ① 退换页 input.value 显示的是渲染时的默认值（maxQty），但 data-change action
 *   只在用户实际改动时才把值写回 state。用户不改 input 直接点「确认」时，
 *   state.returnQty / state.exchReturnQty 为空，校验误报。
 * ② sw.js 缓存版本 v2 的 SHELL 列表里没有 page-exchange.js，
 *   旧 PWA 仍按 v2 响应，新页面文件未被正确服务。
 *
 * 修复：
 * ① page-exchange.js 加 syncQtyFromDom 兜底：do-return / do-exchange
 *   提交前从当前视图的 input[data-change] 把 value 同步到 state。
 * ② sw.js CACHE v2 → v3，SHELL 加上 js/ui/page-exchange.js。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');
const page = require('../js/ui/page-exchange.js');

/* ---------------- ① 真实浏览器复现 + DOM 兜底修复 ---------------- */

/**
 * 极简 DOM stub：构造一棵 input 树，让 syncQtyFromDom 能 querySelectorAll 找到目标 input。
 */
function buildDomStub(inputs) {
  // inputs: [{ changeName, sku, value }]
  const inputNodes = inputs.map((it) => ({
    tag: 'input',
    attrs: { 'data-change': it.changeName, 'data-sku': it.sku },
    _value: it.value,
    get value() { return this._value; },
    set value(v) { this._value = v; },
    getAttribute(n) { return this.attrs[n] !== undefined ? this.attrs[n] : null; }
  }));
  const allNodes = [view(), ...inputNodes];
  return {
    _nodes: allNodes,
    querySelectorAll(sel) {
      const m = sel.match(/^input\[data-change="([^"]+)"\]$/);
      if (!m) return [];
      return inputNodes.filter((n) => n.attrs['data-change'] === m[1]);
    }
  };
}
function view() {
  return { tag: 'div', attrs: { id: 'view' }, children: [] };
}

function seed(ctx) {
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  engine.savePurchase(ctx, {
    date: '2026-08-31', partnerName: '温州鞋厂',
    items: [
      { skuId: 'X0010138', qty: 5, costPrice: '50' },
      { skuId: 'X0010139', qty: 5, costPrice: '50' },
      { skuId: 'X0010238', qty: 5, costPrice: '50' },
      { skuId: 'X0010239', qty: 5, costPrice: '50' }
    ],
    paid: 99999
  });
  return engine.saveSale(ctx, {
    date: '2026-08-31',
    items: [
      { skuId: 'X0010138', qty: 2, price: '129' },
      { skuId: 'X0010239', qty: 1, price: '129' }
    ],
    payments: [{ method: 'cash', amount: '387' }]
  }).doc;
}

test('Bug 1 复现：state.returnQty 为空 + input 有默认值 → 旧版会误报"请填写数量"', () => {
  const ctx = newCtx();
  const original = seed(ctx);

  // mock engine.refundSale，让它"失败"，从而保留 state.returnQty 供断言
  const origRefund = engine.refundSale;
  engine.refundSale = () => ({ ok: false, error: 'mocked-block' });

  // 模拟 select-original 后进入 return tab，但用户没改 input
  const state = page.init();
  state.originalNo = original.no;
  state.tab = 'return';
  // state.returnQty 仍是空对象（用户没改 input）

  // 渲染（生成的 input value="2" / value="1"，但 state.returnQty 是空的）
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-change="return-qty"'), '应渲染退货数量 input');
  assert.ok(!state.returnQty['X0010138'], '复现：state.returnQty 确实为空（用户没改 input）');

  // 注入 DOM stub
  global.document = buildDomStub([
    { changeName: 'return-qty', sku: 'X0010138', value: '2' },
    { changeName: 'return-qty', sku: 'X0010239', value: '1' }
  ]);

  let toastMsg = null;
  const oldToast = require('../js/ui/components.js').toast;
  require('../js/ui/components.js').toast = (m) => { toastMsg = m; };

  try {
    const handled = page.actions['do-return'](ctx, state);
    assert.strictEqual(handled, false, 'mocked refundSale 失败，应返回 false');
    assert.strictEqual(toastMsg, 'mocked-block', '应把 refundSale 的 error 透传给 toast，而不是误报"请填写"');
    // 关键：state 已被从 DOM 同步（修复生效），do-return 失败后未清空
    assert.strictEqual(state.returnQty['X0010138'], 2, '应从 DOM 同步到 state');
    assert.strictEqual(state.returnQty['X0010239'], 1);
  } finally {
    engine.refundSale = origRefund;
    require('../js/ui/components.js').toast = oldToast;
    delete global.document;
  }
});

test('Bug 1 修复：用户主动把 input 改成 0 → 应尊重用户选择，state 也同步为 0', () => {
  const ctx = newCtx();
  const original = seed(ctx);
  const state = page.init();
  state.originalNo = original.no;
  state.tab = 'return';

  // mock refundSale，让 state.returnQty 在 do-return 失败后不被清空
  const origRefund = engine.refundSale;
  engine.refundSale = () => ({ ok: false, error: 'mocked' });

  global.document = buildDomStub([
    { changeName: 'return-qty', sku: 'X0010138', value: '0' },  // 用户主动清零
    { changeName: 'return-qty', sku: 'X0010239', value: '1' }
  ]);

  let toastMsg = null;
  const oldToast = require('../js/ui/components.js').toast;
  require('../js/ui/components.js').toast = (m) => { toastMsg = m; };
  try {
    const handled = page.actions['do-return'](ctx, state);
    assert.strictEqual(handled, false, 'mocked refundSale 失败，应返回 false');
    assert.strictEqual(toastMsg, 'mocked', '应把 refundSale 的 error 透传');
    // mock 阻断后，state.returnQty 保留，可验证 sync 同步
    assert.strictEqual(state.returnQty['X0010138'], 0, '用户主动清零应被尊重（sync 同步 0）');
    assert.strictEqual(state.returnQty['X0010239'], 1);
  } finally {
    engine.refundSale = origRefund;
    require('../js/ui/components.js').toast = oldToast;
    delete global.document;
  }
});

test('Bug 1 修复：do-exchange 同样从 DOM 兜底同步 exchReturnQty', () => {
  const ctx = newCtx();
  const original = seed(ctx);
  const state = page.init();
  state.originalNo = original.no;
  state.tab = 'exchange';
  // 用户提前在状态里加好换新商品
  state.replItems = [{
    skuId: 'X0010238', styleCode: 'X002', color: '黑', size: '38', qty: 1,
    price: 12900, costSnapshot: 5000
  }];

  // mock engine.exchange 让它"失败"，保留 state
  const origEx = engine.exchange;
  engine.exchange = () => ({ ok: false, error: 'mocked-block-ex' });

  // 故意让 state.exchReturnQty 为空（用户没动 input），但 DOM 有默认 2 / 1
  global.document = buildDomStub([
    { changeName: 'exch-return-qty', sku: 'X0010138', value: '2' },
    { changeName: 'exch-return-qty', sku: 'X0010239', value: '1' }
  ]);

  let toastMsg = null;
  const oldToast = require('../js/ui/components.js').toast;
  require('../js/ui/components.js').toast = (m) => { toastMsg = m; };
  try {
    const handled = page.actions['do-exchange'](ctx, state);
    assert.strictEqual(handled, false, 'mocked exchange 失败，应返回 false');
    assert.strictEqual(toastMsg, 'mocked-block-ex', '应把 exchange 的 error 透传');
    assert.strictEqual(state.exchReturnQty['X0010138'], 2, '从 DOM 同步到 state');
    assert.strictEqual(state.exchReturnQty['X0010239'], 1);
  } finally {
    engine.exchange = origEx;
    require('../js/ui/components.js').toast = oldToast;
    delete global.document;
  }
});

test('Bug 1 修复：缺 document 时（旧环境），保持原行为不抛错', () => {
  const ctx = newCtx();
  const original = seed(ctx);
  const state = page.init();
  state.originalNo = original.no;
  state.tab = 'return';
  // 故意不设置 global.document（覆盖 typeof document === "undefined" 路径）
  const origDoc = global.document;
  // 让 typeof document === "undefined" 需删 global.document
  try { delete global.document; } catch (e) {}
  let toastMsg = null;
  const oldToast = require('../js/ui/components.js').toast;
  require('../js/ui/components.js').toast = (m) => { toastMsg = m; };
  try {
    const handled = page.actions['do-return'](ctx, state);
    assert.strictEqual(handled, false, '无 document 时 state 仍为空，应走原"请填写"分支');
    assert.ok(toastMsg && toastMsg.includes('请填写'), '应保持原行为');
  } finally {
    require('../js/ui/components.js').toast = oldToast;
    if (origDoc !== undefined) global.document = origDoc;
  }
});

/* ---------------- ② sw.js 缓存升级 + SHELL 含 page-exchange.js ---------------- */

test('Bug 2 修复：sw.js CACHE 必须是新的版本号（不再是 v2）', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/var\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'sw.js 应定义 CACHE');
  assert.notStrictEqual(m[1], 'shoe-erp-v2', 'CACHE 应已升级，不能仍是 v2（旧 PWA 不会重新预缓存）');
});

test('Bug 2 修复：sw.js SHELL 列表必须包含 page-exchange.js', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shellMatch = sw.match(/var\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(shellMatch, 'sw.js 应定义 SHELL 数组');
  assert.ok(/js\/ui\/page-exchange\.js/.test(shellMatch[1]),
    'SHELL 必须包含 js/ui/page-exchange.js，否则旧 PWA 不会预缓存新页面文件');
});
