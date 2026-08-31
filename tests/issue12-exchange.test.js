/**
 * tests/issue12-exchange.test.js —— 退换货功能（问题9 新需求）
 * 1) 核心 engine.exchange：退货 + 换货，与原单双向链接，库存/流水/欠款联动；
 * 2) 退换页面：选原单 → 退货 / 换货 流程与动作；
 * 3) 首页常用入口新增「退换」磁贴并跳转到 exchange 页。
 */
const test = require('node:test');
const assert = require('node:assert');

const coding = require('../js/core/coding.js');
const engine = require('../js/core/engine.js');
const docNo = require('../js/core/docNo.js');
const { newCtx } = require('./helpers/ctx.js');
const schema = require('../js/core/schema.js');
const L = schema.LEDGER;

const page = require('../js/ui/page-exchange.js');
const home = require('../js/ui/page-home.js');

/* 建一款：白/黑 × 38/39，进价 50 售价 129 */
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
}
/** 开一张原销售单：白38 ×2、黑39 ×1，全现金 */
function makeOriginal(ctx) {
  const r = engine.saveSale(ctx, {
    date: '2026-08-31',
    items: [
      { skuId: 'X0010138', qty: 2, price: '129' },
      { skuId: 'X0010239', qty: 1, price: '129' }
    ],
    payments: [{ method: 'cash', amount: '387' }]
  });
  return r.doc;
}

/* ============ 核心：engine.exchange ============ */

test('退换：纯退货（无换新）→ 仅生成退货单、入库、与原单链接', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  assert.strictEqual(ctx.getSku('X0010138').stock, 3, '原单卖出后白38 剩 3');

  const r = engine.exchange(ctx, {
    originalNo: original.no,
    returns: [{ skuId: 'X0010138', qty: 1 }],
    replacements: []
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.refund, '应生成退货单');
  assert.strictEqual(r.sale, null, '纯退货不应生成销售单');
  assert.strictEqual(ctx.getSku('X0010138').stock, 4, '退货入库 3 → 4');

  // 与原单双向链接
  assert.strictEqual(r.refund.refNo, original.no, '退货单 refNo 指向原单');
  assert.strictEqual(r.refund.exchangeOf, original.no, '退货单 exchangeOf 指向原单');
  assert.strictEqual(r.refund.exchangeLinked, null, '无换新则无关联销售单');

  // 财务：退货退款流水
  const out = ctx.data.ledgers.filter((l) => l.type === L.REFUND_OUT && !l.voided);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].amount, 12900);
  assert.strictEqual(out[0].refNo, r.refund.no);
});

test('退换：退旧 + 换新 → 退货单与销售单均与原单链接，库存/账目正确', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);

  const r = engine.exchange(ctx, {
    originalNo: original.no,
    returns: [{ skuId: 'X0010138', qty: 1 }],              // 退白38 ×1（129）
    replacements: [{ skuId: 'X0010238', qty: 1, price: '129' }] // 换黑38 ×1（129）
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.refund && r.sale, '应同时生成退货单与销售单');
  assert.strictEqual(r.net, 0, '同价换货差价应为 0');

  // 库存：白38 退 1（3→4），黑38 换出 1（5→4）
  assert.strictEqual(ctx.getSku('X0010138').stock, 4);
  assert.strictEqual(ctx.getSku('X0010238').stock, 4);

  // 双向链接
  const refund = r.refund, sale = r.sale;
  assert.strictEqual(refund.refNo, original.no);
  assert.strictEqual(refund.exchangeOf, original.no);
  assert.strictEqual(refund.exchangeLinked, sale.no, '退货单应指向关联销售单');
  assert.strictEqual(sale.exchangeOf, original.no, '销售单 exchangeOf 指向原单');
  assert.strictEqual(sale.exchangeLinked, refund.no, '销售单应指回退货单');

  // 账目：退货红冲 12900 + 新销售 12900 → 净额 0
  const refundOut = ctx.data.ledgers.filter((l) => l.type === L.REFUND_OUT && !l.voided);
  const saleIn = ctx.data.ledgers.filter((l) => l.type === L.SALE_INCOME && !l.voided && l.refNo === sale.no);
  assert.strictEqual(refundOut.length, 1);
  assert.strictEqual(saleIn.length, 1);
  assert.strictEqual(refundOut[0].amount, 12900);
  assert.strictEqual(saleIn[0].amount, 12900);

  // 原单本身不被改动（仍可继续退剩余）
  assert.strictEqual(ctx.getDoc('sales', original.no).voided, false);
});

test('退换：差价为正（换新更贵）→ 顾客应补差价，账面净额 = Vp − Vr', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  // 退 1 件白38（129），换 2 件黑38（258）→ 差价 +129
  const r = engine.exchange(ctx, {
    originalNo: original.no,
    returns: [{ skuId: 'X0010138', qty: 1 }],
    replacements: [{ skuId: 'X0010238', qty: 2, price: '129' }]
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.net, 12900, '差价应为 +129');
  // 新销售单实收应为全款 258（差价由退货红冲冲抵，现金净额 = +129）
  assert.strictEqual(r.sale.received, 25800, '新销售单按全款记账');
  assert.strictEqual(r.sale.debt, 0);
});

test('退换：未选退货商品 → 拒绝', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  const r = engine.exchange(ctx, { originalNo: original.no, returns: [], replacements: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('退'));
});

test('退换：原单已作废 / 原单是退货单 → 均拒绝', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  const ref = engine.refundSale(ctx, { originalNo: original.no, items: [{ skuId: 'X0010138', qty: 1 }] });

  // 用退货单作为原单
  const r1 = engine.exchange(ctx, { originalNo: ref.doc.no, returns: [{ skuId: 'X0010138', qty: 1 }] });
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.error.includes('退货单'));

  // 作废原单后再退换
  engine.voidSale(ctx, original.no);
  const r2 = engine.exchange(ctx, { originalNo: original.no, returns: [{ skuId: 'X0010138', qty: 1 }] });
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.error.includes('作废'));
});

test('退换：部分退，超过可退数量则忽略超出部分', () => {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  // 原单白38 共 2 件，第一次退 2 件（全退）
  const r1 = engine.exchange(ctx, { originalNo: original.no, returns: [{ skuId: 'X0010138', qty: 2 }] });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(ctx.getSku('X0010138').stock, 5, '全退后回到 5');
  // 再退白38 → 已无可退
  const r2 = engine.exchange(ctx, { originalNo: original.no, returns: [{ skuId: 'X0010138', qty: 1 }] });
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.error.includes('可退'));
});

/* ============ 页面：退换页流程 ============ */

function freshEx() {
  const ctx = newCtx();
  seed(ctx);
  const original = makeOriginal(ctx);
  const state = page.init(ctx);
  return { ctx, state, original };
}
function elAttr(map) {
  return { getAttribute: (n) => (map[n] !== undefined ? map[n] : null) };
}

test('退换页：选原单页渲染销售单列表', () => {
  const { ctx, state, original } = freshEx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('退换货'), '标题');
  assert.ok(html.includes(original.no), '应列出原销售单');
  assert.ok(html.includes('选为原单'), '应有选原单按钮');
});

test('退换页：选原单 → 进入退货视图，展示原单明细并可确认退货', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));
  assert.strictEqual(state.originalNo, original.no);
  assert.strictEqual(state.tab, 'return');

  const html = page.render(ctx, state);
  assert.ok(html.includes('已关联原销售单'), '应展示与原单的链接');
  assert.ok(html.includes('确认退货'), '应有确认退货按钮');

  state.returnQty['X0010138'] = 1;
  const r = page.actions['do-return'](ctx, state);
  assert.strictEqual(r, true);
  const refund = ctx.data.sales.find((s) => s.type === 'refund');
  assert.ok(refund, '应生成退货单');
  assert.strictEqual(refund.refNo, original.no);
  assert.strictEqual(state.tab, 'pick', '完成后回到选单');
});

test('退换页：换货流程 → 生成退货单 + 销售单并双向链接', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));
  page.actions['goto-exchange'](ctx, state);
  let html = page.render(ctx, state);
  assert.ok(html.includes('换货'), '标题');
  assert.ok(html.includes('选换新商品'), '应有换新商品选择区');
  assert.ok(html.includes('应收差价'), '应展示差价');

  // 选换货款 + 点色码加入换货清单
  page.actions['repl-pick'](ctx, state, elAttr({ 'data-code': 'X001' }));
  page.actions['repl-add'](ctx, state, elAttr({ 'data-sku': 'X0010238' }));
  assert.strictEqual(state.replItems.length, 1);

  // 退还 1 件白38
  state.exchReturnQty['X0010138'] = 1;
  const r = page.actions['do-exchange'](ctx, state);
  assert.strictEqual(r, true);

  const refund = ctx.data.sales.find((s) => s.type === 'refund' && s.exchangeOf === original.no);
  const sale = ctx.data.sales.find((s) => s.type === 'sale' && s.exchangeOf === original.no);
  assert.ok(refund, '应生成退货单');
  assert.ok(sale, '应生成换货销售单');
  assert.strictEqual(refund.exchangeLinked, sale.no, '退货单↔销售单双向链接');
  assert.strictEqual(sale.exchangeLinked, refund.no);
  assert.strictEqual(state.tab, 'pick', '完成后回到选单');
});

test('退换页：未选原单直接渲染退货/换货视图 → 提示先选单', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = page.init(ctx);
  state.tab = 'return';
  assert.ok(page.render(ctx, state).includes('请先在'));
  state.tab = 'exchange';
  assert.ok(page.render(ctx, state).includes('请先在'));
});

/* ============ 首页：常用入口新增退换磁贴 ============ */

test('首页：常用入口含「退换」磁贴并跳转到 exchange 页', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/退换/.test(html), '快捷入口应有退换文字');
  // 退换磁贴应 data-page="exchange"
  const quickMatch = html.match(/<h3[^>]*>快捷入口<\/h3>([\s\S]*?)<\/div>/);
  assert.ok(quickMatch, '应有快捷入口区块');
  assert.ok(/data-act="go"\s+data-page="exchange"/.test(quickMatch[1]), '退换磁贴应跳转到 exchange 页');
});

/* ========== 问题3：退几件输入框实时可识别 ========== */

/** 带 value 的模拟输入元素（data-change 动作读 getAttribute + value） */
function elValue(attrs, value) {
  return { getAttribute: (n) => (attrs[n] !== undefined ? attrs[n] : null), value: String(value) };
}

test('问题3：换货页/退货页「退几件」输入框带 data-live，输入即实时识别', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));

  // 换货视图：退几件输入框带 data-change + data-live
  page.actions['goto-exchange'](ctx, state);
  const exHtml = page.render(ctx, state);
  assert.ok(/data-change="exch-return-qty"[^>]*data-live="1"/.test(exHtml),
    '换货页退几件输入框应带 data-live="1"（输入即实时预览）');
  assert.ok(/data-change="exch-return-qty"[^>]*data-sku="X0010138"/.test(exHtml), '退几件绑定原单 SKU');

  // 退货视图：同样带 data-live
  state.tab = 'return';
  const retHtml = page.render(ctx, state);
  assert.ok(/data-change="return-qty"[^>]*data-live="1"/.test(retHtml),
    '退货页退几件输入框应带 data-live="1"');
});

test('问题3：退几件输入（input 事件、不 blur）即时写入 state 并联动退货额', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));
  page.actions['goto-exchange'](ctx, state);

  // 初始：未输入，退几件默认值=可退数（白38×2 + 黑39×1）→ 退货额 ¥387.00（默认输入已关联退货额）
  let html = page.render(ctx, state);
  assert.ok(/退货额[\s\S]*?¥387\.00/.test(html), '初始退货额应关联默认输入（¥387.00）');

  // 输入「1」——仅触发 input 事件（data-change action），不依赖 blur/change
  page.actions['exch-return-qty'](ctx, state, elValue({ 'data-sku': 'X0010138' }, 1));
  assert.strictEqual(state.exchReturnQty['X0010138'], 1, '输入即写回 state.exchReturnQty');

  // 重渲染后退货额实时联动：白38×1 + 黑39(默认1)×1 = ¥258.00
  html = page.render(ctx, state);
  assert.ok(/退货额[\s\S]*?¥258\.00/.test(html), '退货额应实时更新为 ¥258.00');

  // 非法输入（负数/空）→ 归 0
  page.actions['exch-return-qty'](ctx, state, elValue({ 'data-sku': 'X0010138' }, -3));
  assert.strictEqual(state.exchReturnQty['X0010138'], 0, '负值应归 0');
  page.actions['exch-return-qty'](ctx, state, elValue({ 'data-sku': 'X0010138' }, ''));
  assert.strictEqual(state.exchReturnQty['X0010138'], 0, '空值应归 0');
});

test('问题3：app.js 的 input 事件同时派发 [data-change]（实时识别机制）', () => {
  const appJs = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(/'\[data-input\],\[data-change\]'/.test(appJs),
    'input 监听应同时命中 data-input 与 data-change 输入框');
  assert.ok(/getAttribute\(['"]data-input['"]\)[\s\S]*?getAttribute\(['"]data-change['"]\)/.test(appJs),
    'input 事件应派发 data-change 对应动作（退几件输入即识别）');
});

/* ========== 问题1（新）：换货页「退几件」默认输入内容与退货额关联 ========== */

test('问题1：换货页「退几件」默认值=可退数，且退货额与默认输入关联', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));
  page.actions['goto-exchange'](ctx, state);
  const html = page.render(ctx, state);

  // 输入框默认值 = 可退数（未手动设置 state 时）
  assert.ok(/data-change="exch-return-qty"[^>]*data-sku="X0010138"[^>]*value="2"/.test(html),
    '白38 默认退 2 件（=可退数）');
  assert.ok(/data-change="exch-return-qty"[^>]*data-sku="X0010239"[^>]*value="1"/.test(html),
    '黑39 默认退 1 件（=可退数）');
  // 退货额应与默认输入关联：2×129 + 1×129 = 387
  assert.ok(/退货额[\s\S]*?¥387\.00/.test(html),
    '初始退货额应关联默认输入内容（¥387.00），而非 ¥0.00');
});

test('问题1：换货页退货额随「退几件」实时更新（含默认值兜底）', () => {
  const { ctx, state, original } = freshEx();
  page.actions['select-original'](ctx, state, elAttr({ 'data-no': original.no }));
  page.actions['goto-exchange'](ctx, state);

  // 白38 改为退 1 件（黑39 未设置，仍按默认 1 件计）→ 1×129 + 1×129 = 258
  page.actions['exch-return-qty'](ctx, state, elValue({ 'data-sku': 'X0010138' }, 1));
  let html = page.render(ctx, state);
  assert.ok(/退货额[\s\S]*?¥258\.00/.test(html), '退货额应随输入实时更新为 ¥258.00');

  // 黑39 置 0 → 仅 1×129 = 129
  page.actions['exch-return-qty'](ctx, state, elValue({ 'data-sku': 'X0010239' }, 0));
  html = page.render(ctx, state);
  assert.ok(/退货额[\s\S]*?¥129\.00/.test(html), '黑39 置 0 后退货额为 ¥129.00');
});
