/**
 * 扫码修复：vendor/zxing.min.js 补齐测试
 * 背景：index.html 引用了 vendor/zxing.min.js 但文件缺失（404），拍照通道的 ZXing 解码器实际不可用，
 * 导致手机端拍照识别失败。修复：下载官方 @zxing/library UMD 构建补入 vendor/。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readFile(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

test('vendor/zxing.min.js 存在且是官方 ZXing 库（可加载、含 BrowserCodeReader）', () => {
  const f = path.join(ROOT, 'vendor/zxing.min.js');
  assert.ok(fs.existsSync(f), 'vendor/zxing.min.js 必须存在（此前缺失导致拍照通道 404）');
  const stat = fs.statSync(f);
  assert.ok(stat.size > 100000, '应是完整库文件，大小 >100KB，实际 ' + stat.size);
  const Z = require(f);
  assert.strictEqual(typeof Z.BrowserCodeReader, 'function', '应导出 BrowserCodeReader');
  const reader = new Z.BrowserCodeReader();
  assert.ok(reader, 'BrowserCodeReader 可实例化');
});

test('index.html 引用的所有 vendor 脚本文件都存在（防 404 回归）', () => {
  const html = readFile('index.html');
  const refs = [...html.matchAll(/src="vendor\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 1, '应至少引用一个 vendor 文件（xlsx）：' + refs.join(','));
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, 'vendor', r)), 'vendor/' + r + ' 必须存在');
  }
  // V1.3-5：zxing.min.js 改为扫码时懒加载（scan.js ensureZxing 动态注入），不再静态引用；
  // 但 vendor 文件本身必须保留（供动态加载 + SW 预缓存）
  assert.ok(!refs.includes('zxing.min.js'), 'zxing.min.js 应懒加载，不静态引用');
  assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'zxing.min.js')), 'vendor/zxing.min.js 文件仍须存在（懒加载源）');
});

test('sw.js SHELL 包含 zxing.min.js 与 xlsx.full.min.js（离线可加载扫码/导入库）', () => {
  const sw = readFile('sw.js');
  assert.ok(sw.includes('./vendor/zxing.min.js'), 'SHELL 应含 zxing.min.js');
  assert.ok(sw.includes('./vendor/xlsx.full.min.js'), 'SHELL 应含 xlsx.full.min.js');
});

test('scan.js 的 ZXing 通道期望的 API 与官方库一致（decodeCanvas / HTMLCanvasElementLuminanceSource）', () => {
  const scan = require('../js/barcode/scan.js');
  const Z = require(path.join(ROOT, 'vendor/zxing.min.js'));
  // scan.js zxingDecode 支持两种全局形态：ZXing.decodeCanvas（自定义封装）或
  // ZXing.HTMLCanvasElementLuminanceSource + MultiFormatReader（官方库，直接吃 canvas）
  assert.strictEqual(typeof Z.HTMLCanvasElementLuminanceSource, 'function', '官方库应提供 HTMLCanvasElementLuminanceSource');
  assert.strictEqual(typeof Z.MultiFormatReader, 'function', '官方库应提供 MultiFormatReader');
  assert.strictEqual(typeof Z.DecodeHintType, 'object', '官方库应提供 DecodeHintType');
  assert.ok(scan.ZXING_MAX_EDGE > 0, 'scan.js 应导出 ZXING_MAX_EDGE（拍照缩小上限）');
});

test('zxingDecode：官方库解码噪声图像（不抛错、返回未识别）', () => {
  const scan = require('../js/barcode/scan.js');
  const Z = require(path.join(ROOT, 'vendor/zxing.min.js'));
  const saved = global.window;
  global.window = { ZXing: Z };
  // 伪造 canvas：getContext().getImageData 返回随机噪声
  const w = 96, h = 48;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
  const fakeCanvas = {
    tagName: 'CANVAS', width: w, height: h,
    getContext() {
      return { getImageData() { return { data, width: w, height: h }; } };
    }
  };
  try {
    scan.zxingDecode(fakeCanvas, (ok, text) => {
      assert.strictEqual(ok, false, '噪声图像不应被识别');
    });
  } finally {
    global.window = saved;
  }
});

test('zxingDecode：decodeCanvas 兼容分支命中即返回', () => {
  const scan = require('../js/barcode/scan.js');
  const saved = global.window;
  global.window = { ZXing: { decodeCanvas(c) { return c.width > 0 ? '4006381333931' : null; } } };
  const fakeCanvas = { tagName: 'CANVAS', width: 10, height: 10, getContext() { return null; } };
  try {
    scan.zxingDecode(fakeCanvas, (ok, text) => {
      assert.strictEqual(ok, true);
      assert.strictEqual(text, '4006381333931');
    });
  } finally {
    global.window = saved;
  }
});
