const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const schema = require('../js/core/schema.js');

async function newDb() {
  return db.create({ backend: db.memoryBackend() });
}

test('打开数据库：仓库清单与主键', async () => {
  const d = await newDb();
  assert.strictEqual(d.backendName, 'memory');
  Object.keys(schema.KEY_PATH).forEach((s) => {
    assert.ok(d.stores.includes(s), s + ' 未创建');
  });
  assert.strictEqual(await d.count('products'), 0);
});

test('put / get / getAll：主键去重，重复 put 覆盖', async () => {
  const d = await newDb();
  await d.put('products', { styleCode: 'X001', name: '小白鞋' });
  await d.put('products', { styleCode: 'X002', name: '凉鞋' });
  await d.put('products', { styleCode: 'X001', name: '小白鞋-改名' });

  assert.strictEqual(await d.count('products'), 2);
  const one = await d.get('products', 'X001');
  assert.strictEqual(one.name, '小白鞋-改名');
  assert.strictEqual((await d.getAll('products')).length, 2);
  assert.strictEqual(await d.get('products', 'NONE'), null);
});

test('bulkPut：批量写入与空数组安全', async () => {
  const d = await newDb();
  const skus = [];
  for (let i = 0; i < 50; i++) {
    skus.push({ id: 'X00101' + (30 + i), styleCode: 'X001', stock: 0 });
  }
  await d.bulkPut('skus', skus);
  assert.strictEqual(await d.count('skus'), 50);
  assert.strictEqual(await d.bulkPut('skus', []), 0);
});

test('缺少主键的记录必须报错，而不是写进库', async () => {
  const d = await newDb();
  await assert.rejects(() => d.put('skus', { styleCode: 'X001' }), /缺少主键/);
  assert.strictEqual(await d.count('skus'), 0);
});

test('del / clear / clearAll', async () => {
  const d = await newDb();
  await d.bulkPut('skus', [{ id: 'A' }, { id: 'B' }]);
  await d.del('skus', 'A');
  assert.strictEqual(await d.count('skus'), 1);
  await d.clear('skus');
  assert.strictEqual(await d.count('skus'), 0);

  await d.put('products', { styleCode: 'X001' });
  await d.clearAll();
  assert.strictEqual(await d.count('products'), 0);
});

test('query：函数条件与 {field,value} 条件', async () => {
  const d = await newDb();
  await d.bulkPut('sales', [
    { no: 'S1', date: '2026-08-30', type: 'sale' },
    { no: 'S2', date: '2026-08-31', type: 'sale' },
    { no: 'S3', date: '2026-08-31', type: 'refund' }
  ]);
  const byFn = await d.query('sales', (s) => s.date === '2026-08-31');
  assert.deepStrictEqual(byFn.map((s) => s.no), ['S2', 'S3']);
  const byField = await d.query('sales', { field: 'type', value: 'refund' });
  assert.deepStrictEqual(byField.map((s) => s.no), ['S3']);
  assert.strictEqual((await d.query('sales')).length, 3);
});

test('exportAll / importAll：整体导出后可完整回灌', async () => {
  const d = await newDb();
  await d.put('products', { styleCode: 'X001', name: '小白鞋' });
  await d.put('skus', { id: 'X0010138', styleCode: 'X001', stock: 3 });
  await d.put('meta', { key: 'settings', value: { shopName: '测试店' } });

  const dump = await d.exportAll();
  assert.strictEqual(dump.schemaVersion, schema.VERSION);
  assert.strictEqual(dump.products.length, 1);
  assert.strictEqual(dump.meta.length, 1);

  const d2 = await newDb();
  await d2.importAll(dump);
  assert.strictEqual(await d2.count('products'), 1);
  assert.strictEqual((await d2.get('products', 'X001')).name, '小白鞋');
  assert.strictEqual((await d2.get('meta', 'settings')).value.shopName, '测试店');
});

test('importAll 是整体覆盖：旧数据被清掉', async () => {
  const d = await newDb();
  await d.put('products', { styleCode: 'OLD', name: '旧款' });
  await d.importAll(schema.emptyData());
  assert.strictEqual(await d.count('products'), 0);
});

test('无 indexedDB 环境自动降级为内存后端，不抛错', async () => {
  const d = await db.create({});
  assert.strictEqual(d.backendName, 'memory');
  await d.put('products', { styleCode: 'X001' });
  assert.strictEqual(await d.count('products'), 1);
});
