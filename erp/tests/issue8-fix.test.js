// 问题 8 测试：销售开单页扫码按钮无反应（无摄像头无兜底）→ 修复
//
// 需求（用户原话）：销售开单页面扫码按钮无反应（无摄像头跳转）。
//
// 根因：原 scan.start 在无 BarcodeDetector 时直接走 photoInput（相机/文件选择器），
// 没有可见的「手输」兜底；手动兜底 manualPrompt（window.prompt）只在 realtime 路径内才可达。
// 取消或没相机时用户看到「无反应」。
//
// 修复（见 js/barcode/scan.js）：
//   - 新增 chooseMode() 决策；无实时能力一律走 manualCard；
//   - manualCard 统一弹出「拍照识别 + 手输条码」卡片，任何环境点击扫码都有反应；
//   - realtime 失败 / 点「手输」也改走 manualCard。
const test = require('node:test');
const assert = require('node:assert');

// 用可控的 modal / toast 覆盖真实 DOM 实现（components 在 Node 下不触 DOM，仅替换方法）
const components = require('../js/ui/components.js');
let lastModal = null;
let createdInputs = [];
function mockModal(cfg) {
  lastModal = cfg;
  const registry = {};
  function el() {
    return {
      value: '',
      _h: {},
      addEventListener(ev, fn) { this._h[ev] = fn; },
      focus() {},
      querySelector(sel) { return registry[sel] || (registry[sel] = el()); }
    };
  }
  const body = el();
  const mask = el();
  mockModal._registry = registry;
  if (cfg.onMount) cfg.onMount(body, mask);
  return mask;
}
components.modal = mockModal;
components.closeModal = function () { mockModal._closed = true; };
components.toast = function () {};

// 最小 window / document / navigator，使 hasWindow() 为真
global.window = { BarcodeDetector: undefined, isSecureContext: true };
global.document = {
  createElement() {
    const input = {
      type: '', accept: '', capture: '', style: {}, files: [], value: '',
      addEventListener() {}, click() { createdInputs.push(this); }
    };
    return input;
  },
  body: { appendChild() {}, removeChild() {} }
};
global.navigator = {};

const scan = require('../js/barcode/scan.js');
const sale = require('../js/ui/page-sale.js');
const { newCtx } = require('./helpers/ctx.js');

function reset() {
  lastModal = null;
  createdInputs = [];
  if (mockModal._registry) mockModal._registry = {};
  mockModal._closed = false;
}

/* ---------------- ① 决策逻辑 ---------------- */

test('问题8-决策：无 BarcodeDetector / 非安全上下文 → 走手动兜底（不再无反应）', () => {
  assert.strictEqual(scan.chooseMode(undefined, true), 'manual');
  assert.strictEqual(scan.chooseMode(false, true), 'manual');
  assert.strictEqual(scan.chooseMode(true, false), 'manual', '非安全上下文即便有 detector 也走手动');
  assert.strictEqual(scan.chooseMode(true, true), 'realtime', '有 detector 且安全上下文才实时扫');
});

/* ---------------- ② 兜底卡片：点击扫码必有反应 ---------------- */

test('问题8-修复：无摄像头时点击扫码仍弹出可操作的兜底卡片', () => {
  reset();
  global.window.BarcodeDetector = undefined;
  let result = null;
  scan.start({ onResult: (c) => { result = c; }, onError: () => {} });
  assert.ok(lastModal, '应弹出扫码卡片（有反应）');
  assert.strictEqual(lastModal.title, '扫码');

  const input = mockModal._registry['#scan-manual-input'];
  assert.ok(input, '兜底卡片应含手输输入框');
  const okBtn = mockModal._registry['[data-act="scan-manual-ok"]'];
  assert.ok(okBtn && okBtn._h.click, '应有「确定」按钮');

  input.value = 'XA1234';
  okBtn._h.click();
  assert.strictEqual(result, 'XA1234', '手输条码应作为扫码结果回传');
});

test('问题8-修复：手输为空 → 不回传，仅提示', () => {
  reset();
  global.window.BarcodeDetector = undefined;
  let result = '未触发';
  scan.start({ onResult: (c) => { result = c; }, onError: () => {} });
  const okBtn = mockModal._registry['[data-act="scan-manual-ok"]'];
  okBtn._h.click();
  assert.strictEqual(result, '未触发', '空输入不应回传结果');
});

test('问题8-修复：兜底卡片「拍照」按钮可触发拍照识别', () => {
  reset();
  global.window.BarcodeDetector = undefined;
  scan.start({ onResult: () => {}, onError: () => {} });
  const photoBtn = mockModal._registry['[data-act="scan-photo"]'];
  assert.ok(photoBtn && photoBtn._h.click, '应有拍照按钮');
  photoBtn._h.click();
  assert.ok(createdInputs.length >= 1, '点击拍照应创建并触发文件输入');
  assert.strictEqual(createdInputs[0].type, 'file');
});

/* ---------------- ③ 集成：销售页扫码动作 ---------------- */

test('问题8-集成：销售页扫码动作触发兜底卡片（不再是死按钮）', () => {
  reset();
  global.window.BarcodeDetector = undefined;
  const ctx = newCtx();
  const state = sale.init(ctx);
  sale.actions['scan'](ctx, state);
  assert.ok(lastModal, '销售页扫码按钮应弹出卡片');
});
