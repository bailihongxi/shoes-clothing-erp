const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const repo = require('../js/store/repo.js');
const schema = require('../js/core/schema.js');

async function boot() {
  const d = await db.create({ backend: db.memoryBackend() });
  const data = await repo.loadAll(d);
  return { db: d, ctx: repo.createContext(data) };
}

test('loadAll：空库得到默认设置', async () => {
  const { ctx } = await boot();
  assert.strictEqual(ctx.settings.shopName, '我的鞋服店');
  assert.strictEqual(ctx.data.products.length, 0);
  assert.strictEqual(ctx.data.lastBackupAt, null);
});

test('loadAll：能读回已保存的设置与最后备份时间', async () => {
  const d = await db.create({ backend: db.memoryBackend() });
  await repo.saveSettings(d, { shopName: '城南鞋店', defaultThreshold: 5 });
  await repo.setMeta(d, schema.META_LAST_BACKUP_KEY, '2026-08-31');
  const data = await repo.loadAll(d);
  assert.strictEqual(data.settings.shopName, '城南鞋店');
  assert.strictEqual(data.settings.defaultThreshold, 5);
  assert.strictEqual(data.lastBackupAt, '2026-08-31');
});

test('touch + flush：只落库被标记的记录', async () => {
  const { db: d, ctx } = await boot();
  const p1 = { styleCode: 'X001', name: '小白鞋' };
  const p2 = { styleCode: 'X002', name: '凉鞋' };
  ctx.data.products.push(p1, p2);
  ctx.touch('products', p1);
  ctx.touch('products', p2);
  ctx.touch('products', p1); // 重复标记应去重
  assert.deepStrictEqual(ctx.dirtyKeys(), ['products']);

  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.products, 2);
  assert.strictEqual(await d.count('products'), 2);
  assert.deepStrictEqual(ctx.dirtyKeys(), []);
});

test('flush：未标记的记录不会被写入', async () => {
  const { db: d, ctx } = await boot();
  ctx.data.products.push({ styleCode: 'X001', name: '未标记' });
  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.products, undefined);
  assert.strictEqual(await d.count('products'), 0);
});

test('flush 后数据可再次 loadAll 读回（模拟重启）', async () => {
  const { db: d, ctx } = await boot();
  const sku = { id: 'X0010138', styleCode: 'X001', stock: 3 };
  ctx.data.skus.push(sku);
  ctx.touch('skus', sku);
  await repo.flush(ctx, d);
  const again = await repo.loadAll(d);
  assert.strictEqual(again.skus.length, 1);
  assert.strictEqual(again.skus[0].stock, 3);
});

test('查询助手：款 / 色码 / 往来单位 / 单据', async () => {
  const { ctx } = await boot();
  ctx.data.products.push({ styleCode: 'X001', name: '小白鞋' });
  ctx.data.skus.push(
    { id: 'X0010138', styleCode: 'X001', color: '白', size: '38' },
    { id: 'X0010139', styleCode: 'X001', color: '白', size: '39' },
    { id: 'X0020138', styleCode: 'X002', color: '白', size: '38' }
  );
  ctx.data.partners.push({ id: 'p1', name: '温州鞋厂', type: 'supplier' });
  ctx.data.sales.push({ no: 'S20260831-001', date: '2026-08-31' });

  assert.strictEqual(ctx.getProduct('X001').name, '小白鞋');
  assert.strictEqual(ctx.getProduct('X999'), null);
  assert.strictEqual(ctx.skusOf('X001').length, 2);
  assert.strictEqual(ctx.getSku('X0010139').size, '39');
  assert.strictEqual(ctx.getPartner('p1').name, '温州鞋厂');
  assert.strictEqual(ctx.getDoc('sales', 'S20260831-001').date, '2026-08-31');
  assert.strictEqual(ctx.getDoc('sales', 'NONE'), null);
});

test('操作日志：写入并标记落库', async () => {
  const { db: d, ctx } = await boot();
  const rec = repo.log(ctx, '建档', '新增款号 X001');
  assert.strictEqual(ctx.data.logs.length, 1);
  assert.strictEqual(rec.action, '建档');
  assert.ok(rec.at);
  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.logs, 1);
});
