/**
 * 问题2：自研 ZXing 解码桥（zxing-bridge.js）测试
 * - bridge 在官方库上挂 decodeCanvas（同步返回 string|null）
 * - 双二值化（Hybrid → GlobalHistogram → 反色）对噪声图像不抛错、返回 null
 * - install 幂等（不覆盖已有 decodeCanvas）
 * - scan.js zxingDecode 走 decodeCanvas 直调
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const bridge = require('../js/barcode/zxing-bridge.js');
const Z = require(path.join(ROOT, 'vendor/zxing.min.js'));

function noiseCanvas(w, h, seed) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * (seed || 7) + 13) % 256;
  return {
    tagName: 'CANVAS', width: w, height: h,
    getContext() {
      return { getImageData() { return { data, width: w, height: h }; } };
    }
  };
}

test('bridge.install：在官方库挂上 decodeCanvas（幂等不覆盖）', () => {
  const Z2 = Object.assign({}, Z, { decodeCanvas: undefined });
  const out = bridge.install(Z2);
  assert.strictEqual(typeof out.decodeCanvas, 'function', '应挂上 decodeCanvas');
  // 幂等：再次 install 不覆盖
  out.decodeCanvas = 'custom';
  bridge.install(out);
  assert.strictEqual(out.decodeCanvas, 'custom', '已存在的 decodeCanvas 不应被覆盖');
});

test('decodeCanvas：噪声图像返回 null（Hybrid/Global/反色均不误报、不抛错）', () => {
  const saved = global.window;
  global.window = { ZXing: Z };
  try {
    const r = bridge.decodeCanvas(noiseCanvas(96, 48));
    assert.strictEqual(r, null, '噪声不应解码出内容');
    assert.strictEqual(bridge.decodeCanvas(null), null, '空输入返回 null');
    assert.strictEqual(bridge.decodeCanvas(noiseCanvas(64, 64, 3)), null);
  } finally {
    global.window = saved;
  }
});

test('decodeCanvas：无 window.ZXing 时不抛错返回 null', () => {
  const saved = global.window;
  global.window = {};
  try {
    assert.strictEqual(bridge.decodeCanvas(noiseCanvas(10, 10)), null);
  } finally {
    global.window = saved;
  }
});

test('scan.js：hasZxing 依赖 decodeCanvas；zxingDecode 直调 decodeCanvas', () => {
  const scan = require('../js/barcode/scan.js');
  const saved = global.window;
  global.window = { ZXing: { decodeCanvas(c) { return c.width > 0 ? '6921734900099' : null; } } };
  try {
    scan.zxingDecode({ tagName: 'CANVAS', width: 20, height: 10, getContext() { return null; } }, (ok, text) => {
      assert.strictEqual(ok, true);
      assert.strictEqual(text, '6921734900099');
    });
  } finally {
    global.window = saved;
  }
});

test('scan.js：decodeWith 全链路 zxing 通道走 decodeCanvas（注入 impl）', () => {
  const scan = require('../js/barcode/scan.js');
  const saved = global.window;
  global.window = { ZXing: { decodeCanvas(c) { return c.width === 8 ? 'OK' : null; } } };
  const fake = { tagName: 'CANVAS', width: 8, height: 4, getContext() { return null; } };
  try {
    scan.decodeWith(fake, (ok, text) => {
      assert.strictEqual(ok, true);
      assert.strictEqual(text, 'OK');
    }, {
      native: { available: false },
      ean13: { available: false },
      zxing: { available: true, decode: scan.zxingDecode }
    });
  } finally {
    global.window = saved;
  }
});
