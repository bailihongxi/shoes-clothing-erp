/**
 * 商品档案 CSV 导入：支持直接导入 CSV / Excel（.xlsx/.xls）文件
 * - 导入页渲染文件选择控件（accept csv/xlsx/xls）
 * - excel.js 解析 xlsx/xls 首个工作表 → rows → rowsToCsv → parseCSV → importFromRows 建款
 */
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const excel = require('../js/core/excel.js');
const util = require('../js/core/util.js');
const coding = require('../js/core/coding.js');
const page = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

function makeWorkbook(rows, bookType) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: bookType || 'xlsx' });
}

const SAMPLE = [
  ['名称', '类别', '颜色', '号码', '进价', '售价', '品牌', '条码'],
  ['Excel鞋', '鞋', '白、黑', '38、39', '50', '129', '', ''],
  ['Excel衣', '服装', '蓝', 'M、L', '30', '79', '', '']
];

test('excel 模块：解析 xlsx 首个工作表为二维数组（含表头）', () => {
  assert.ok(excel.available(), 'SheetJS 已加载');
  const buf = makeWorkbook(SAMPLE);
  const rows = excel.parse(buf);
  assert.strictEqual(rows.length, 3, '表头 + 2 行数据');
  assert.strictEqual(rows[0][0], '名称');
  assert.strictEqual(rows[1][0], 'Excel鞋');
  assert.strictEqual(rows[1][3], '38、39');
});

test('excel 模块：解析老版 .xls（biff8）同样可用', () => {
  const buf = makeWorkbook(SAMPLE, 'biff8');
  const rows = excel.parse(buf);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[2][0], 'Excel衣');
});

test('excel.rowsToCsv → parseCSV → importFromRows：Excel 文件内容可直接建款', () => {
  const rows = excel.parse(makeWorkbook(SAMPLE));
  const csv = excel.rowsToCsv(rows);
  const parsed = util.parseCSV(csv);
  assert.strictEqual(parsed.rows.length, 3, 'CSV 文本行数与 Excel 一致');
  assert.strictEqual(parsed.rows[1][0], 'Excel鞋', '中文内容不丢失');

  const ctx = newCtx();
  const res = coding.importFromRows(parsed.rows, ctx);
  assert.ok(res.ok, '导入成功');
  assert.strictEqual(res.created, 2, '新增 2 款');
  assert.ok(ctx.data.products.some((p) => p.name === 'Excel鞋' && p.category === '鞋'), 'Excel鞋 已建档');
  assert.ok(ctx.data.products.some((p) => p.name === 'Excel衣'), 'Excel衣 已建档');
});

test('CSV 文件内容（文本）同样走 importFromRows 可导入', () => {
  const csvText = util.toCSV(['名称', '类别', '颜色', '号码', '进价', '售价'], [
    ['Csv鞋', '鞋', '红', '40', '45', '119']
  ]);
  const parsed = util.parseCSV(csvText);
  const ctx = newCtx();
  const res = coding.importFromRows(parsed.rows, ctx);
  assert.ok(res.ok);
  assert.strictEqual(res.created, 1);
});

test('商品档案导入页：渲染文件选择控件（accept 支持 csv/xlsx/xls，data-change 派发）', () => {
  const ctx = newCtx();
  const state = page.init(ctx);
  state.tab = 'csv';
  const html = page.render(ctx, state);
  assert.ok(
    /<input class="input" type="file" accept="\.csv,\.xlsx,\.xls,text\/csv" data-change="pick-import-file">/.test(html),
    '应渲染文件选择 input（accept csv/xlsx/xls + data-change="pick-import-file"）'
  );
  assert.ok(html.includes('支持 CSV / Excel .xlsx .xls'), '提示支持 CSV 与 Excel');
  assert.ok(html.includes('data-change="pick-import-file"'), '文件选择走 data-change 派发');
});
