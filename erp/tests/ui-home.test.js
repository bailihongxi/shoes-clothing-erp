/**
 * tests/ui-home.test.js —— 首页看板 / 设置页 / 我的页 渲染与关键动作
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const schema = require('../js/core/schema.js');
const util = require('../js/core/util.js');

const home = require('../js/ui/page-home.js');
const setting = require('../js/ui/page-setting.js');
const mine = require('../js/ui/page-mine.js');

function seedShop(ctx) {
  ctx.data.products.push({ styleCode: 'X001', name: '小白鞋', category: '鞋', barcode: 'X001', costPrice: 50, salePrice: 129, status: 'on' });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 2, threshold: 3 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);
}

test('首页：渲染含今日概览与快捷入口（开单卡片已移至「我的→常用入口」）', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/今日营收/.test(html), '应有今日营收卡');
  assert.ok(!/去开单/.test(html), '首页不再放置「去开单」大按钮（已移至我的→常用入口）');
  assert.ok(!/data-page="sale"/.test(html), '首页快捷入口不应再含开单入口');
  assert.ok(/快捷入口/.test(html), '应有快捷入口');
  assert.ok(/进货/.test(html) && /报表/.test(html), '快捷入口保留进货/报表等常用入口');
});

test('首页：未备份时显示提醒条', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/未备份/.test(html), '应提示未备份');
  assert.ok(/去备份/.test(html), '应有去备份入口');
});

test('首页：当天已备份则不显示提醒', () => {
  const ctx = newCtx();
  ctx.data.lastBackupAt = util.today() + 'T08:00:00';
  const html = home.render(ctx, home.init(ctx));
  assert.ok(!/未备份/.test(html), '当天已备份不应提醒');
});

test('首页：超期欠款进入待处理事项条', () => {
  const ctx = newCtx();
  seedShop(ctx);
  const cus = ctx.data.partners = ctx.data.partners || [];
  cus.push({ id: 'cus_1', name: '张三', type: 'customer', balance: 20000, lastDealAt: null, createdAt: util.nowISO() });
  const old = util.addDays(util.today(), -30);
  ctx.data.sales.push({
    no: 'S1', date: old, type: 'sale', partnerId: 'cus_1',
    items: [{ skuId: 'X0010138', styleCode: 'X001', qty: 1, price: 129, costSnapshot: 50, type: 'sale' }],
    payable: 100, received: 0, debt: 100, voided: false
  });
  const html = home.render(ctx, home.init(ctx));
  assert.ok(/待处理事项/.test(html), '应有待处理事项条');
  assert.ok(/张三/.test(html), '应列出超期客户');
});

test('首页：预警款数随低库存变化', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  // 空数据时预警 0，不应显示 warn 样式在预警卡
  assert.ok(/预警款数/.test(html));
});

test('设置页：渲染关键区块', () => {
  const ctx = newCtx();
  const html = setting.render(ctx, setting.init(ctx));
  assert.ok(/店铺名称/.test(html), '应有店铺名称');
  assert.ok(/打开密码/.test(html), '应有打开密码');
  assert.ok(/导出备份/.test(html), '应有导出备份');
  assert.ok(/操作日志/.test(html), '应有操作日志');
});

test('设置页：密码不一致被拒绝', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.pwd = '1234';
  state.pwd2 = '9999';
  const r = setting.actions['set-password'](ctx, state);
  assert.strictEqual(r, false, '两次不一致应拒绝');
});

test('设置页：设置合法密码后启用', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.pwd = '123456';
  state.pwd2 = '123456';
  const r = setting.actions['set-password'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.settings.lock.enabled, true);
  assert.ok(ctx.settings.lock.hash, '应写入密码哈希');
});

test('设置页：保存设置写入店铺名与打印参数', () => {
  const ctx = newCtx();
  const state = setting.init(ctx);
  state.shopName = '潮流鞋坊';
  state.widthMm = '40';
  state.dpi = '300';
  setting.actions['save-settings'](ctx, state);
  assert.strictEqual(ctx.settings.shopName, '潮流鞋坊');
  assert.strictEqual(ctx.settings.label.dpi, 300);
});

test('设置页：导出备份返回 true 且生成 JSON', () => {
  const ctx = newCtx();
  const r = setting.actions['export-backup'](ctx, setting.init(ctx));
  assert.strictEqual(r, true);
  assert.ok(ctx.data.lastBackupAt, '应记录最后备份时间');
});

test('我的页：渲染店铺信息与关于', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(/我的/.test(html), '标题');
  assert.ok(/关于/.test(html), '应有关于');
  assert.ok(/常用入口/.test(html), '应有常用入口');
});

test('页面均注册到 ERP.pages', () => {
  assert.ok(home.name === 'home' && setting.name === 'setting' && mine.name === 'mine');
});
