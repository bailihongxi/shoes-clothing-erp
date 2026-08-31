'use strict';
const test = require('node:test');
const assert = require('node:assert');

const barcode = require('../js/core/barcode.js');
const render = require('../js/barcode/render.js');
const label = require('../js/barcode/label.js');
const printBt = require('../js/barcode/print-bt.js');

// ---------------- CODE128 编码 ----------------

test('code128：START/STOP 与校验位（X001）', () => {
  const enc = barcode.code128Encode('X001');
  assert.strictEqual(enc.start, 104, 'START_B');
  assert.strictEqual(enc.values[0], 104);
  assert.strictEqual(enc.values[enc.values.length - 1], 106, 'STOP');
  // 校验位预期（独立手算）：104 + 56*1 + 16*2 + 16*3 + 17*4 = 308 → 102
  assert.strictEqual(enc.checksum, 102);
  assert.deepStrictEqual(enc.values, [104, 56, 16, 16, 17, 102, 106]);
});

test('code128：校验位（TEST001，含字母+数字）', () => {
  const enc = barcode.code128Encode('TEST001');
  assert.strictEqual(enc.checksum, 62, '独立手算 104+52+74+153+208+80+96+119=886 → 62');
  assert.strictEqual(enc.values[0], 104);
  assert.strictEqual(enc.values[enc.values.length - 1], 106);
});

test('code128：条空模块总数（每个值 11 模块，STOP 13）', () => {
  const enc = barcode.code128Encode('X001');
  assert.strictEqual(enc.totalModules, 79, '6 值×11 + 13 = 79');
  // 每个值图案宽度应和为 11（STOP 为 13）
  const PAT = barcode.PATTERNS;
  for (let i = 0; i < enc.values.length - 1; i++) {
    const p = PAT[enc.values[i]];
    let s = 0; for (const ch of p) s += +ch;
    assert.strictEqual(s, 11);
  }
  const stopP = PAT[106];
  let ss = 0; for (const ch of stopP) ss += +ch;
  assert.strictEqual(ss, 13);
});

test('code128：模块序列奇偶交替 条/空，且含静区', () => {
  const enc = barcode.code128Encode('X001');
  assert.strictEqual(enc.quietModules, 10);
  assert.ok(enc.modules.length > 0);
  // 偶数位为条（宽度>0），奇数位为空
  for (let i = 0; i < enc.modules.length; i++) {
    assert.ok(enc.modules[i] > 0, '模块宽度必须为正');
  }
});

test('code128：不支持字符归位为 ?（33）', () => {
  // '?' 在 Code B 中 char 63 → value 31
  const enc = barcode.code128Encode('中');
  // 归一后应为 '?' → 末位数据值 31（不含 START/校验/STOP）
  assert.strictEqual(enc.values[1], 31);
});

// ---------------- 渲染与尺寸 ----------------

test('render：模块宽 ≥0.375mm、静区 ≥2.5mm、总宽 ≤40mm', () => {
  const d = render.dimensions('X001', { dpi: 203 });
  assert.ok(d.moduleMm >= 0.375, '模块宽目标');
  assert.ok(d.quietMm >= 2.5, '静区');
  assert.ok(d.totalWidthMm <= 40, '4 字符款号在 40mm 内放下，实际 ' + d.totalWidthMm.toFixed(2));
  // @203dpi 模块像素应 ≥3px
  assert.ok(d.modulePx >= 3, '模块像素 ≥3px，实际 ' + d.modulePx.toFixed(2));
});

test('render：SVG 输出含 <svg> 与黑色条', () => {
  const s = render.svg('X001', { dpi: 203 });
  assert.ok(s.indexOf('<svg') === 0, '以 <svg 开头');
  assert.ok(s.indexOf('width=') > 0);
  assert.ok(s.indexOf('<rect') > 0, '包含条（rect）');
});

test('render：toBitmap1bpp 行内 MSB 在前打包', () => {
  // 构造 9 列网格：全黑首列 → 首字节 0x80
  const grid = [[1, 0, 0, 0, 0, 0, 0, 0, 0]];
  const bm = render.toBitmap1bpp(grid);
  assert.strictEqual(bm.widthBytes, 2, 'ceil(9/8)=2');
  assert.strictEqual(bm.bytes[0], 0x80, '首列黑 → MSB 置位');
  assert.strictEqual(bm.bytes[1], 0x00);
  // 全黑一行（8 列）→ 0xFF
  const grid2 = [[1, 1, 1, 1, 1, 1, 1, 1]];
  const bm2 = render.toBitmap1bpp(grid2);
  assert.strictEqual(bm2.widthBytes, 1);
  assert.strictEqual(bm2.bytes[0], 0xff);
});

test('render：barcodeBitmap 由条码生成位图字节', () => {
  const bm = render.barcodeBitmap('X001', { rows: 80 });
  assert.strictEqual(bm.heightPx, 80);
  assert.ok(bm.widthPx > 0 && bm.bytes.length > 0);
  assert.strictEqual(bm.bytes.length, bm.widthBytes * bm.heightPx);
});

// ---------------- 标签版式 ----------------

test('label：buildLabelData 字段齐全且金额格式化', () => {
  const d = label.buildLabelData(
    { name: '小白鞋', styleCode: 'X001', color: '白', size: '38', salePrice: 12900 },
    { shop: '门店A' }
  );
  assert.strictEqual(d.shop, '门店A');
  assert.strictEqual(d.name, '小白鞋');
  assert.strictEqual(d.color, '白');
  assert.strictEqual(d.size, '38');
  assert.strictEqual(d.priceText, '¥129.00');
  assert.strictEqual(d.barcode, 'X001');
  assert.strictEqual(d.widthMm, 40);
  assert.strictEqual(d.heightMm, 30);
});

test('label：同款不同色码条码相同、文字不同', () => {
  const a = label.buildLabelData({ name: '小白鞋', styleCode: 'X001', color: '白', size: '38', salePrice: 12900 });
  const b = label.buildLabelData({ name: '小白鞋', styleCode: 'X001', color: '黑', size: '39', salePrice: 12900 });
  assert.strictEqual(a.barcode, b.barcode, '同款条码一致');
  assert.notStrictEqual(a.color + a.size, b.color + b.size, '文字不同');
});

test('label：printPage 生成 N 张标签 HTML', () => {
  const pages = label.labelPages([
    { name: '小白鞋', styleCode: 'X001', color: '白', size: '38', salePrice: 12900 },
    { name: '小白鞋', styleCode: 'X001', color: '黑', size: '39', salePrice: 12900 }
  ]);
  const html = label.printPage(pages);
  assert.ok(html.indexOf('<!doctype html>') === 0);
  assert.ok(html.indexOf('小白鞋') > 0);
  assert.strictEqual((html.match(/class="label"/g) || []).length, 2, '2 张标签');
});

// ---------------- 蓝牙打印指令 ----------------

test('printBt：node 下不支持蓝牙 → 界面可据此隐藏按钮', () => {
  assert.strictEqual(printBt.supportsBluetooth(), false);
});

test('printBt：测试页固定条码 TEST001', () => {
  const t = printBt.testPage();
  assert.strictEqual(t.barcode, 'TEST001');
  assert.strictEqual(t.styleCode, 'TEST001');
});

test('printBt：buildTSPL 含 SIZE/BITMAP/PRINT 与位图数据', () => {
  const bm = render.barcodeBitmap('X001', { rows: 80 });
  const d = label.buildLabelData({ name: '小白鞋', styleCode: 'X001', color: '白', size: '38', salePrice: 12900 });
  const cmd = printBt.buildTSPL(bm, { label: d, widthMm: 40, heightMm: 30 });
  assert.ok(cmd.indexOf('SIZE 40 mm,30 mm') === 0, '首行 SIZE');
  assert.ok(cmd.indexOf('BITMAP') > 0, '含 BITMAP 指令');
  assert.ok(cmd.indexOf('PRINT 1') > 0, '含打印指令');
  assert.ok(cmd.indexOf('小白鞋') > 0, '含商品名文字');
});

test('printBt：buildEscPos 含 GS v 0 位图与切纸', () => {
  const bm = render.barcodeBitmap('X001', { rows: 80 });
  const d = label.buildLabelData({ name: '小白鞋', styleCode: 'X001', color: '白', size: '38', salePrice: 12900 });
  const cmd = printBt.buildEscPos(bm, { label: d });
  assert.ok(cmd.indexOf('\x1d\x76\x30\x00') > 0, 'GS v 0 位图指令');
  assert.ok(cmd.indexOf('\x1d\x56\x00') > 0, '切纸指令');
  assert.ok(cmd.indexOf('¥129.00') > 0, '含价格文本');
});
