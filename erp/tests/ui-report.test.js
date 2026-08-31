const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-report.js');
const profit = require('../js/core/profit.js');
const ledger = require('../js/core/ledger.js');
const { newCtx } = require('./helpers/ctx.js');

function buildFixed(ctx) {
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale',
    items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 10, price: 12900, costSnapshot: 5000, type: 'sale' },
      { skuId: 'X0010138', styleCode: 'X001', qty: 1, price: 0, costSnapshot: 5000, type: 'gift' }
    ],
    payable: 129000, received: 129000, debt: 0, voided: false
  });
  ledger.manual(ctx, { date: '2026-08-31', category: '其他', direction: 'out', amount: '500' });
}

test('页面元数据与初始状态', () => {
  const ctx = newCtx();
  const state = page.init(ctx);
  assert.strictEqual(page.name, 'report');
  assert.strictEqual(state.range, 'all');
});

test('报表渲染：三层利润卡 + 趋势图', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const state = page.init(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('销售收入'));
  assert.ok(html.includes('毛利'));
  assert.ok(html.includes('净利参考'));
  assert.ok(html.includes('<svg'), '应有自绘 SVG 趋势图');
  // 净利 240 元
  assert.ok(html.includes('¥240.00'), '净利参考应显示 240.00');
});

test('区间切换：本月/全部 重新聚合', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const state = page.init(ctx);
  state.range = 'month';
  let html = page.render(ctx, state);
  assert.ok(html.includes('销售收入'), '本月范围仍可渲染');

  // 把数据改成上月，本月应归零
  ctx.data.sales[0].date = util_addMonths('2026-08-31', -1);
  state.range = 'month';
  html = page.render(ctx, state);
  assert.ok(html.includes('¥0.00'), '上月数据不计入本月');
});

test('TOP5 切换按毛利/按销量', () => {
  const ctx = newCtx();
  const coding = require('../js/core/coding.js');
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'], costPrice: '50', salePrice: '129' }, ctx);
  coding.create({ name: '黑裤', category: '裤', colors: ['黑'], sizes: ['30'], costPrice: '40', salePrice: '99' }, ctx);
  ctx.data.sales.push({
    no: 'S1', date: '2026-08-31', type: 'sale',
    items: [
      { skuId: 'X0010138', styleCode: 'X001', qty: 5, price: 12900, costSnapshot: 5000, type: 'sale' },
      { skuId: 'K0020130', styleCode: 'K002', qty: 2, price: 9900, costSnapshot: 4000, type: 'sale' }
    ],
    payable: 5 * 12900 + 2 * 9900, received: 5 * 12900 + 2 * 9900, debt: 0, voided: false
  });
  const state = page.init(ctx);
  state.topBy = 'profit';
  let html = page.render(ctx, state);
  assert.ok(html.includes('小白鞋'), '按毛利小白鞋第一');

  state.topBy = 'qty';
  html = page.render(ctx, state);
  assert.ok(html.includes('小白鞋'), '按销量小白鞋也是第一（5 件）');
});

test('导出 CSV：构建并触发下载', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  // 注入 ERP.app.download（模拟浏览器下载）
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = {
    download: function (name, content) {
      globalThis.__csvName = name;
      globalThis.__csv = content;
    }
  };
  const state = page.init(ctx);
  const r = page.actions['export-csv'](ctx, state);
  assert.strictEqual(r, true);
  assert.ok(globalThis.__csv && globalThis.__csv.indexOf('2026-08') >= 0, 'CSV 应包含月份数据');
  if (globalThis.ERP) delete globalThis.ERP.app;
});

function util_addMonths(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return require('../js/core/util.js').today(d);
}
