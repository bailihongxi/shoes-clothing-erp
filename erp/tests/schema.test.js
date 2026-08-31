const test = require('node:test');
const assert = require('node:assert');
const schema = require('../js/core/schema.js');

test('默认设置：类别前缀、阈值、一码一色码默认关闭、标签 40×30mm', () => {
  const s = schema.defaultSettings();
  assert.strictEqual(s.categoryPrefix['鞋'], 'X');
  assert.strictEqual(s.categoryPrefix['服装'], 'F');
  assert.strictEqual(s.defaultThreshold, 3);
  assert.strictEqual(s.oneCodePerSku, false);
  assert.strictEqual(s.label.widthMm, 40);
  assert.strictEqual(s.label.heightMm, 30);
  assert.strictEqual(s.label.dpi, 203);
  assert.strictEqual(s.label.quietMm, 2.5);
  assert.strictEqual(s.label.barcodeHeightMm, 10);
  assert.strictEqual(s.print.protocol, 'tspl');
});

test('设置合并：缺字段补默认，自定义前缀保留', () => {
  const merged = schema.mergeSettings({
    shopName: '小张鞋店',
    categoryPrefix: { 鞋: 'S' },
    label: { dpi: 300 }
  });
  assert.strictEqual(merged.shopName, '小张鞋店');
  assert.strictEqual(merged.categoryPrefix['鞋'], 'S');
  assert.strictEqual(merged.categoryPrefix['服装'], 'F');
  assert.strictEqual(merged.label.dpi, 300);
  assert.strictEqual(merged.label.widthMm, 40);
  assert.deepStrictEqual(schema.mergeSettings(null), schema.defaultSettings());
});

test('空数据结构：包含全部数据表且 schemaVersion=1', () => {
  const data = schema.emptyData();
  assert.strictEqual(data.schemaVersion, schema.VERSION);
  schema.DATA_STORES.forEach((name) => {
    assert.ok(Array.isArray(data[name]), name + ' 应为数组');
    assert.strictEqual(data[name].length, 0);
  });
  assert.ok(schema.DATA_STORES.includes('sales'));
});

test('每个仓库都有主键定义', () => {
  Object.keys(schema.STORES).forEach((name) => {
    assert.ok(schema.KEY_PATH[name], name + ' 缺少 keyPath');
  });
  assert.strictEqual(schema.KEY_PATH.products, 'styleCode');
  assert.strictEqual(schema.KEY_PATH.skus, 'id');
  assert.strictEqual(schema.KEY_PATH.sales, 'no');
  assert.strictEqual(schema.KEY_PATH.purchases, 'no');
});

test('备份校验：结构缺失、非法对象、版本过高都要明确报错', () => {
  assert.strictEqual(schema.validateBackup(null).ok, false);
  assert.strictEqual(schema.validateBackup([]).ok, false);
  assert.strictEqual(schema.validateBackup({ a: 1 }).ok, false);

  const ok = schema.emptyData();
  assert.strictEqual(schema.validateBackup(ok).ok, true);

  const broken = Object.assign({}, ok);
  delete broken.skus;
  const r1 = schema.validateBackup(broken);
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.error.includes('skus'));

  const future = Object.assign({}, ok, { schemaVersion: schema.VERSION + 1 });
  const r2 = schema.validateBackup(future);
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.error.includes('高于当前程序'));
});

test('迁移：低版本可升级，高版本拒绝，数据不丢', () => {
  const old = schema.emptyData();
  old.schemaVersion = 1;
  old.products = [{ styleCode: 'X001', name: '小白鞋' }];
  const m = schema.migrate(old);
  assert.strictEqual(m.ok, true);
  assert.strictEqual(m.data.schemaVersion, schema.VERSION);
  assert.strictEqual(m.data.products.length, 1);

  const future = schema.emptyData();
  future.schemaVersion = schema.VERSION + 1;
  assert.strictEqual(schema.migrate(future).ok, false);
});
