/**
 * V3-阶段2：V2 存量单账号数据迁移到账号 1 库（core/legacy-migrate.js）
 * - 旧库有数据 → 迁入空 target（含 meta.settings），返回 moved
 * - target 非空跳过；旧库空不迁移；同库名拒绝
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const schema = require('../js/core/schema.js');
const migrate = require('../js/core/legacy-migrate.js');

/** 模拟 IndexedDB 多库：同 name 复用同一 memory backend，不同 name 独立 */
function makeCreateDb() {
  const backends = new Map();
  return {
    backends,
    createDb: (name) => {
      if (!backends.has(name)) backends.set(name, db.memoryBackend());
      return db.create({ backend: backends.get(name), name: name });
    }
  };
}

test('迁移：旧库有数据 → 迁入账号1 空库（含 settings），旧库保留', async () => {
  const { createDb } = makeCreateDb();
  const legacy = await createDb('shoeErp');
  await legacy.put('products', { styleCode: 'X001', name: '小白鞋', category: '鞋' });
  await legacy.put('products', { styleCode: 'X002', name: '凉鞋', category: '鞋' });
  await legacy.put('sales', { no: 'S20260829-001', total: 88 });
  await legacy.put('meta', { key: 'settings', value: { shopName: '旧鞋店' } });

  const r = await migrate.migrate(createDb, 'shoeErp', 'shoeErp_acct1');
  assert.ok(r.migrated, '应迁移成功');
  assert.strictEqual(r.moved, 3, '移动 2 商品 + 1 销售单');

  const target = await createDb('shoeErp_acct1');
  assert.strictEqual(await target.count('products'), 2);
  const p = await target.get('products', 'X001');
  assert.strictEqual(p.name, '小白鞋');
  assert.strictEqual(await target.count('sales'), 1);
  const s = await target.get('meta', 'settings');
  assert.strictEqual(s.value.shopName, '旧鞋店');

  // 旧库数据保留（只复制不删除）
  assert.strictEqual(await legacy.count('products'), 2);
});

test('迁移：target 已有数据则跳过，不覆盖', async () => {
  const { createDb } = makeCreateDb();
  const legacy = await createDb('shoeErp');
  await legacy.put('products', { styleCode: 'X001', name: '小白鞋' });
  const target = await createDb('shoeErp_acct1');
  await target.put('products', { styleCode: 'Y001', name: '账号1已有' });

  const r = await migrate.migrate(createDb, 'shoeErp', 'shoeErp_acct1');
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.reason, 'target-not-empty');
  assert.strictEqual(await target.count('products'), 1, '不覆盖 target 数据');
});

test('迁移：旧库为空 → 不迁移（moved 0）', async () => {
  const { createDb } = makeCreateDb();
  const r = await migrate.migrate(createDb, 'shoeErp', 'shoeErp_acct1');
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.moved, 0);
});

test('迁移：同库名拒绝', async () => {
  const { createDb } = makeCreateDb();
  const r = await migrate.migrate(createDb, 'shoeErp', 'shoeErp');
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.reason, 'same-db');
});

test('迁移：账号2 库不受账号1 迁移影响', async () => {
  const { createDb } = makeCreateDb();
  const legacy = await createDb('shoeErp');
  await legacy.put('products', { styleCode: 'X001', name: '小白鞋' });
  await migrate.migrate(createDb, 'shoeErp', 'shoeErp_acct1');

  const acct2 = await createDb('shoeErp_acct2');
  assert.strictEqual(await acct2.count('products'), 0, '账号2 库为空，不接收迁移数据');
});
