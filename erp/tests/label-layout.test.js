// V1.3-7 标签排版测试：取消店名行 / 产品名称占一行 / 颜色号码与价格同行左右分布 / 条码更清晰
const test = require('node:test');
const assert = require('node:assert');
const label = require('../js/barcode/label.js');

function sample() {
  return label.buildLabelData({
    name: '小白鞋', styleCode: 'X001', color: '黑', size: '30',
    salePrice: 10000, barcode: 'X001'
  });
}

test('V1.3-7：标签不含店名行（第一行「鞋店」取消）', () => {
  const html = label.labelHTML(sample());
  assert.ok(!html.includes('lb-shop'), '不应渲染店名行');
  assert.ok(!html.includes('鞋店'), '标签内不应出现店名');
});

test('V1.3-7：产品名称占第一行（lb-name）', () => {
  const html = label.labelHTML(sample());
  const nameStart = html.indexOf('class="lb-name"');
  const rowStart = html.indexOf('class="lb-row"');
  assert.ok(nameStart >= 0, '应有 lb-name');
  assert.ok(rowStart > nameStart, '产品名称应位于 lb-row 之前（占一行）');
  assert.ok(html.includes('小白鞋'), '应显示产品名称内容');
});

test('V1.3-7：颜色/号码 与 价格 同一行，左（颜色）右（价格）分布', () => {
  const html = label.labelHTML(sample());
  const m = html.match(/<div class="lb-row">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(m, '应有 lb-row 容器');
  const row = m[1];
  const csIdx = row.indexOf('class="lb-cs"');
  const priceIdx = row.indexOf('class="lb-price"');
  assert.ok(csIdx >= 0 && priceIdx >= 0, 'lb-row 内应同时含颜色号码与价格');
  assert.ok(csIdx < priceIdx, '颜色号码应在左、价格在右');
  assert.ok(row.includes('黑 / 30'), '颜色/号码内容为整体');
  assert.ok(row.includes('¥100.00'), '价格为整体');
  // 左右分布由 CSS .lb-row{justify-content:space-between;gap:6mm} 保证（CSS 断言）
});

test('V1.3-7：条码更清晰——打印入口条码高度 12mm（与 print.css 一致）', () => {
  const fs = require('fs');
  const path = require('path');
  const product = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-product.js'), 'utf8');
  assert.ok(product.includes('heightMm: 12'), '打印条码应使用 12mm 高度');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'print.css'), 'utf8');
  assert.ok(css.includes('.lb-barcode svg { display: block; width: 100%; height: 12mm; }'), 'CSS 条码高度 12mm');
  assert.ok(css.includes('justify-content: space-between'), 'CSS 应左右分布颜色与价格');
  assert.ok(!css.includes('.lb-shop'), 'CSS 不应再有店名样式');
});

test('printPage 整页结构：不含店名、含左右分布行', () => {
  const page = label.printPage([sample(), sample()]);
  assert.ok(page.includes('<!doctype html>'));
  assert.ok(!page.includes('lb-shop'));
  const count = page.split('class="lb-row"').length - 1;
  assert.strictEqual(count, 2, '两张标签各含一行左右分布');
});

test('V1.3-8：颜色/号码 与 价格 文字加粗放大更醒目', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'print.css'), 'utf8');
  assert.ok(css.includes('.lb-cs   { font-size: 10.5pt; font-weight: 700;'), '颜色/号码应加粗放大（10.5pt 700）');
  assert.ok(css.includes('.lb-price{ font-size: 13pt; font-weight: 800;'), '价格应更粗更大（13pt 800）');
});
