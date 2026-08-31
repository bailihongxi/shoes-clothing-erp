/**
 * tests/backup.test.js —— 备份导出 / 校验 / 恢复（PRD 7）
 */
const test = require('node:test');
const assert = require('node:assert');

const schema = require('../js/core/schema.js');
const repo = require('../js/store/repo.js');
const backup = require('../js/core/backup.js');

function newCtx(settings) {
  const data = schema.emptyData();
  data.settings = schema.mergeSettings(settings || {});
  return repo.createContext(data);
}

function seed(ctx) {
  ctx.data.products.push({
    styleCode: 'X001', name: '小白鞋', category: '鞋',
    barcode: 'X001', costPrice: 50, salePrice: 129, status: 'on'
  });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 3, threshold: 3 });
  ctx.data.partners.push({ id: 'cus_1', name: '张三', type: 'customer', balance: 20000 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);
  ctx.touch('partners', ctx.data.partners[0]);
}

test('build：导出结构含全部仓库 + schemaVersion + 时间 + 摘要计数', () => {
  const ctx = newCtx();
  seed(ctx);
  const b = backup.build(ctx);
  assert.strictEqual(b.app, 'shoe-erp');
  assert.strictEqual(b.schemaVersion, schema.VERSION);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(b.exportedAt), 'exportedAt 应为 ISO');
  assert.strictEqual(b.summary.products, 1);
  assert.strictEqual(b.summary.skus, 1);
  assert.strictEqual(b.summary.partners, 1);
  schema.DATA_STORES.forEach((n) => {
    assert.ok(Array.isArray(b[n]), n + ' 应为数组');
  });
});

test('导出→清空→恢复：数据一致', () => {
  const ctx = newCtx();
  seed(ctx);
  const json = JSON.stringify(backup.build(ctx));

  const fresh = newCtx();
  assert.strictEqual(fresh.data.products.length, 0);
  const r = backup.restore(fresh, json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fresh.data.products.length, 1);
  assert.strictEqual(fresh.data.products[0].styleCode, 'X001');
  assert.strictEqual(fresh.data.skus.length, 1);
  assert.strictEqual(fresh.data.partners[0].balance, 20000);
});

test('validate：损坏的 JSON 报错且不破坏现有数据', () => {
  const ctx = newCtx();
  seed(ctx);
  const before = ctx.data.products.length;
  const r = backup.restore(ctx, '{这不是合法json');
  assert.strictEqual(r.ok, false);
  assert.ok(/JSON/.test(r.error), '应提示 JSON 错误');
  assert.strictEqual(ctx.data.products.length, before, '现有数据不应被修改');
});

test('validate：结构不完整（缺仓库）报错', () => {
  const bad = { schemaVersion: schema.VERSION, products: [] }; // 缺其余仓库
  const r = backup.validate(bad);
  assert.strictEqual(r.ok, false);
});

test('restore：高版本 schema 被拦截', () => {
  const ctx = newCtx();
  const high = backup.build(ctx);
  high.schemaVersion = 999;
  const r = backup.restore(ctx, JSON.stringify(high));
  assert.strictEqual(r.ok, false);
  assert.ok(/版本/.test(r.error), '应提示版本过高');
});

test('restore：对象形式同样可恢复', () => {
  const ctx = newCtx();
  seed(ctx);
  const obj = backup.build(ctx);
  const r = backup.restore(newCtx(), obj);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.summary.products, 1);
});
