// 问题 3 测试：尺码默认从童码开始 + 删除 0.5 半号；条码规则（产品类型+颜色+四位随机码，同款同色共用，扫码显示共几色几码库存）
//
// 修复要点（见 js/ui/page-product.js / js/core/coding.js / js/barcode/scan.js）：
//   - presetSizes：鞋/服装/裤 默认从童码（小朋友）从小到大排，移除 0.5 半号；
//   - coding.genColorBarcode：条码 = 类别前缀(1) + 颜色码(1) + 四位随机码(4)；
//   - coding.preview/create：同一「款 + 色」复用同一份条码（同款同色可贴同一个条码）；
//   - scan.resolve：支持按 SKU 条码（色码条码）定位到商品；
//   - scan.card / openCard：扫码后显示「共 X 色 Y 个号码在库」汇总。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'js');
const schema = require(path.join(ROOT, 'core/schema.js'));
const util = require(path.join(ROOT, 'core/util.js'));
const coding = require(path.join(ROOT, 'core/coding.js'));
const inventory = require(path.join(ROOT, 'core/inventory.js'));
const scan = require(path.join(ROOT, 'barcode/scan.js'));
const product = require(path.join(ROOT, 'ui/page-product.js'));

/* ---------------- ① 尺码：默认从童码开始、无 0.5 半号 ---------------- */

test('问题3-尺码：鞋类预设从童码 26 开始、且不含 0.5 半号', () => {
  const sizes = product.presetSizes('鞋');
  assert.strictEqual(sizes[0], '26', '鞋应从小朋友最小码 26 开始');
  assert.ok(sizes.indexOf('44') >= 0, '应包含成人最大码 44');
  assert.strictEqual(sizes.indexOf('36.5'), -1, '不应有 0.5 半号');
  assert.strictEqual(sizes.indexOf('37.5'), -1, '不应有 0.5 半号');
  assert.strictEqual(sizes.indexOf('38.5'), -1, '不应有 0.5 半号');
});

test('问题3-尺码：服装预设从童装身高 90 开始、不含 0.5 半号', () => {
  const sizes = product.presetSizes('服装');
  assert.strictEqual(sizes[0], '90', '服装应从童装身高 90 开始');
  assert.ok(sizes.indexOf('均码') >= 0, '应保留成人均码');
  assert.strictEqual(sizes.indexOf('36.5'), -1, '服装不应有 0.5 半号');
});

test('问题3-尺码：裤类预设从童裤 22 开始、不含 0.5 半号', () => {
  const sizes = product.presetSizes('裤');
  assert.strictEqual(sizes[0], '22', '裤应从童裤 22 开始');
  assert.strictEqual(sizes.indexOf('36.5'), -1, '裤不应有 0.5 半号');
});

test('问题3-尺码：compareSize 数字升序（童码自然排在成人前）', () => {
  const sorted = ['40', '28', '35', '32'].sort(inventory.compareSize);
  assert.deepStrictEqual(sorted, ['28', '32', '35', '40'], '童码应排在前');
});

/* ---------------- ② 条码规则 ---------------- */

test('问题3-条码：colorCode 返回单个大写字母', () => {
  assert.strictEqual(coding.colorCode('红'), 'R');
  assert.strictEqual(coding.colorCode('黑'), 'K');
  assert.strictEqual(coding.colorCode('蓝'), 'B');
  assert.strictEqual(coding.colorCode('特殊色').length, 1, '未知颜色也兜底为 1 字母');
  assert.ok(/^[A-Z]$/.test(coding.colorCode('特殊色')), '应为大写字母');
});

test('问题3-条码：genColorBarcode = 产品类型(1) + 颜色(1) + 四位随机码(4)，且与已占用不冲突', () => {
  const taken = { 'XR1234': true };
  const code = coding.genColorBarcode('鞋', '红', schema.defaultSettings(), taken);
  assert.match(code, /^[A-Z]{2}\d{4}$/, '格式应为 2 字母 + 4 数字');
  assert.strictEqual(code[0], 'X', '鞋的类别前缀应为 X');
  assert.strictEqual(code[1], 'R', '红色码段应为 R');
  assert.notStrictEqual(code, 'XR1234', '不应与已占用条码冲突');
});

test('问题3-条码：同一「款 + 色」的所有尺码共用同一条码，且不同色不同码', () => {
  const ctx = {
    data: schema.emptyData(),
    settings: schema.defaultSettings(),
    getProduct: function (c) { return this.data.products.find(p => p.styleCode === c) || null; },
    getSku: function (id) { return this.data.skus.find(s => s.id === id) || null; },
    skusOf: function (c) { return this.data.skus.filter(s => s.styleCode === c); },
    touch: function () {}
  };
  const pv = coding.preview({ name: '童鞋A', category: '鞋', colors: ['红', '蓝'], sizes: ['28', '30'] }, ctx);
  assert.ok(pv.ok, '预览应成功');
  assert.strictEqual(pv.rows.length, 4, '2 色 × 2 码 = 4 行');

  const redBarcodes = pv.rows.filter(r => r.color === '红').map(r => r.barcode);
  const blueBarcodes = pv.rows.filter(r => r.color === '蓝').map(r => r.barcode);
  // 同色共用
  assert.strictEqual(redBarcodes[0], redBarcodes[1], '同色两个尺码应共用同一条码');
  // 异色不同
  assert.notStrictEqual(redBarcodes[0], blueBarcodes[0], '不同色应使用不同条码');
  // 全部符合格式
  pv.rows.forEach(r => assert.match(r.barcode, /^[A-Z]{2}\d{4}$/, '每行条码格式应为 2 字母 + 4 数字'));
});

test('问题3-条码：建档后 SKU 带色码条码，且扫码（按 SKU 条码）可定位到该款', () => {
  const ctx = {
    data: schema.emptyData(),
    settings: schema.defaultSettings(),
    getProduct: function (c) { return this.data.products.find(p => p.styleCode === c) || null; },
    getSku: function (id) { return this.data.skus.find(s => s.id === id) || null; },
    skusOf: function (c) { return this.data.skus.filter(s => s.styleCode === c); },
    touch: function () {},
    touch: function () {}
  };
  const res = coding.create({ name: '童鞋B', category: '鞋', colors: ['红'], sizes: ['28', '30'], costPrice: '50', salePrice: '100' }, ctx);
  assert.ok(res.ok, '建档应成功');
  const redBarcode = res.skus[0].barcode;
  const resolved = scan.resolve(ctx, redBarcode);
  assert.ok(resolved.found, '按色码条码应能定位到商品');
  assert.strictEqual(resolved.styleCode, res.styleCode, '应定位到正确款号');
});

test('问题3-条码：追加同色新码时复用原条码（同款同色共用不变）', () => {
  const ctx = {
    data: schema.emptyData(),
    settings: schema.defaultSettings(),
    getProduct: function (c) { return this.data.products.find(p => p.styleCode === c) || null; },
    getSku: function (id) { return this.data.skus.find(s => s.id === id) || null; },
    skusOf: function (c) { return this.data.skus.filter(s => s.styleCode === c); },
    touch: function () {}
  };
  coding.create({ name: '童鞋C', category: '鞋', colors: ['红'], sizes: ['28'], costPrice: '50', salePrice: '100' }, ctx);
  const firstBarcode = ctx.data.skus[0].barcode;
  // 同一款（同名同类）追加同色新码 30
  const pv = coding.preview({ name: '童鞋C', category: '鞋', colors: ['红'], sizes: ['30'] }, ctx);
  const newRow = pv.rows.find(r => r.size === '30');
  assert.strictEqual(newRow.barcode, firstBarcode, '追加同色新码应复用原条码');
});

/* ---------------- ③ 扫码显示共几色几码库存 ---------------- */

test('问题3-扫码：card 返回 colorCount / sizeCount / summary（共 X 色 Y 个号码在库）', () => {
  const ctx = {
    data: schema.emptyData(),
    settings: schema.defaultSettings(),
    getProduct: function (c) { return this.data.products.find(p => p.styleCode === c) || null; },
    getSku: function (id) { return this.data.skus.find(s => s.id === id) || null; },
    skusOf: function (c) { return this.data.skus.filter(s => s.styleCode === c); },
    touch: function () {}
  };
  coding.create({ name: '童鞋D', category: '鞋', colors: ['红', '蓝'], sizes: ['28', '30'], costPrice: '50', salePrice: '100' }, ctx);
  const card = scan.card(ctx, ctx.data.products[0].styleCode);
  assert.ok(card, 'card 应返回');
  assert.strictEqual(card.colorCount, 2, '应显示 2 色');
  assert.strictEqual(card.sizeCount, 2, '应显示 2 个号码');
  assert.match(card.summary, /共 2 色 2 个号码在库/, 'summary 应为「共 2 色 2 个号码在库」');
});
