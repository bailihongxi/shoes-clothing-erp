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

// ---------- V1.3-4：自动增强路径（行带定位 + 缩放 + 白边静区） ----------
// 背景：用户条码照片（5012345678900）原尺寸 ZXing 全拒——条码贴顶、右静区仅约 1.5 模块。
// bridge 增强路径应解出；本测试用「静区不足 + 条码贴顶」位图复现该特征并回归。

function ean13Bits(code) {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const R = L.map(s => s.split('').map(c => c === '1' ? '0' : '1').join(''));
  const FIRST = { 0:'LLLLLL',1:'LLGLGG',2:'LLGGLG',3:'LLGGGL',4:'LGLLGG',5:'LGGLLG',6:'LGGGLL',7:'LGLGLG',8:'LGLGGL',9:'LGGLGL' };
  const s = String(code);
  const pattern = FIRST[+s[0]];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (pattern[i] === 'L' ? L : G)[+s[1 + i]];
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[+s[7 + i]];
  return bits + '101';
}

/** 静区不足（左右各 2 模块）+ 条码贴顶（上方无静区）+ 底部 40% 空白（模拟照片构图） */
function photoLikeCanvas(code, modulePx) {
  const bits = ean13Bits(code);
  const mw = modulePx || 4;
  const quietL = 2 * mw;
  const quietR = 2 * mw;
  const barH = 60;
  const w = quietL + bits.length * mw + quietR;
  const h = 2 + barH + 80; // 顶部 2px + 条码 + 底部大段空白
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255; }
  for (let x = 0; x < bits.length; x++) {
    if (bits[x] === '1') {
      for (let px = 0; px < mw; px++) {
        const gx = quietL + x * mw + px;
        for (let y = 2; y < 2 + barH; y++) {
          const o = (y * w + gx) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
      }
    }
  }
  return { data, w, h };
}

test('decodeCanvas：静区不足的条码照片经自动增强路径解出（V1.3-4 底层优化回归）', () => {
  const saved = global.window;
  global.window = { ZXing: Z };
  try {
    const { data, w, h } = photoLikeCanvas('5012345678900', 4);
    const canvas = {
      tagName: 'CANVAS', width: w, height: h,
      getContext() { return { getImageData() { return { data, width: w, height: h }; } }; }
    };
    const r = bridge.decodeCanvas(canvas);
    assert.strictEqual(r, '5012345678900', '增强路径应解出 5012345678900，got ' + r);
  } finally {
    global.window = saved;
  }
});

test('enhanceGray：可定位条码行带并缩放+补白边（纯数据层）', () => {
  const { data, w, h } = photoLikeCanvas('5012345678900', 4);
  const canvas = {
    tagName: 'CANVAS', width: w, height: h,
    getContext() { return { getImageData() { return { data, width: w, height: h }; } }; }
  };
  const g = bridge.canvasGray(canvas);
  assert.ok(g, 'canvasGray 应成功');
  const band = bridge.locateBand(g.gray, g.w, g.h);
  assert.ok(band && band.y0 <= 4 && band.y1 >= 2 + 60, `条码行带应覆盖条码区，got ${band ? band.y0 + '-' + band.y1 : 'null'}`);
  const en = bridge.enhanceGray(g.gray, g.w, g.h, 800);
  assert.ok(en, 'enhanceGray 应产出增强图');
  assert.ok(en.w > g.w && en.h > g.h, '白边应放大画布');
});
