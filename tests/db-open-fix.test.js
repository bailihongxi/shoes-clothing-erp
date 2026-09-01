/**
 * V3-阶段2：db.js indexedDB 后端 open 补齐缺失 store
 * 场景：历史残留/异常创建的库（存在但缺 object store），open 时应版本+1 自动补齐，
 * 避免 loadAll 抛 NotFoundError 导致账号无法进入。
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const schema = require('../js/core/schema.js');

/** 最小 fake IndexedDB：可模拟「已存在但缺 store」的残留库 */
function makeFakeIndexedDB(seed) {
  const dbs = new Map(); // name -> { version, stores:Set<string> }
  function ensure(name) {
    if (!dbs.has(name)) dbs.set(name, { version: 0, stores: new Set() });
    return dbs.get(name);
  }
  (seed || []).forEach((s) => {
    const rec = ensure(s.name);
    rec.version = s.version;
    s.stores.forEach((n) => rec.stores.add(n));
  });
  return {
    _dbs: dbs,
    open(name, version) {
      const rec = ensure(name);
      const req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        error: null,
        result: null
      };
      const dbObj = {
        version: rec.version,
        objectStoreNames: { contains: (n) => rec.stores.has(n) },
        createObjectStore: (n) => { rec.stores.add(n); },
        close: () => {},
        transaction: () => { throw new Error('not used'); }
      };
      // 模拟真实 IDB 的异步事件触发（微任务）；onupgradeneeded 时 result 已就位
      queueMicrotask(() => {
        req.result = dbObj;
        if (version > rec.version) {
          if (req.onupgradeneeded) req.onupgradeneeded();
          rec.version = version;
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
}

const ALL_STORES = Object.keys(schema.KEY_PATH);

test('db open：新库创建全部 store', async () => {
  const fake = makeFakeIndexedDB();
  const d = await db.create({ backend: db.indexedDbBackend(fake), name: 'shoeErp_new' });
  ALL_STORES.forEach((s) => assert.ok(d.stores.includes(s), s + ' 应存在'));
});

test('db open：已存在但缺 store 的残留库 → 自动补齐', async () => {
  // 模拟：shoeErp_acct2 库已存在（version 1）但没有任何 store（坏库）
  const fake = makeFakeIndexedDB([{ name: 'shoeErp_acct2', version: 1, stores: [] }]);
  const d = await db.create({ backend: db.indexedDbBackend(fake), name: 'shoeErp_acct2' });
  ALL_STORES.forEach((s) => {
    assert.ok(d.stores.includes(s), '补齐后 ' + s + ' 应存在');
  });
  const rec = fake._dbs.get('shoeErp_acct2');
  assert.ok(rec.version >= 2, '缺失 store 时版本升级（version=' + rec.version + '）');
  ALL_STORES.forEach((s) => assert.ok(rec.stores.has(s), 'fake 库补齐 ' + s));
});

test('db open：部分缺失 store 也补齐且不破坏已有 store', async () => {
  // 已有 products/meta，缺其他
  const fake = makeFakeIndexedDB([{ name: 'shoeErp_part', version: 1, stores: ['products', 'meta'] }]);
  const d = await db.create({ backend: db.indexedDbBackend(fake), name: 'shoeErp_part' });
  ALL_STORES.forEach((s) => {
    assert.ok(d.stores.includes(s), '部分补齐后 ' + s + ' 应存在');
  });
  const rec = fake._dbs.get('shoeErp_part');
  assert.ok(rec.stores.has('products'), '已有 store 保留');
  assert.ok(rec.stores.has('meta'));
});

test('db open：完整库不触发无谓升级', async () => {
  const fake = makeFakeIndexedDB([{ name: 'shoeErp_ok', version: 1, stores: ALL_STORES }]);
  const d = await db.create({ backend: db.indexedDbBackend(fake), name: 'shoeErp_ok' });
  assert.strictEqual(fake._dbs.get('shoeErp_ok').version, 1, '完整库不升级版本');
  ALL_STORES.forEach((s) => assert.ok(d.stores.includes(s)));
});

test('db open：已升级到高版本(2)的完整库可再次打开，不抛版本过低错误', async () => {
  // 回归：V3 修复缺表时版本+1 升级到 2 后，若再用固定 version 1 打开会抛
  // "requested version is less than existing version"。修复后应以无版本探测方式正常打开。
  const fake = makeFakeIndexedDB([{ name: 'shoeErp_up', version: 2, stores: ALL_STORES }]);
  const d = await db.create({ backend: db.indexedDbBackend(fake), name: 'shoeErp_up' });
  assert.strictEqual(fake._dbs.get('shoeErp_up').version, 2, '不降级不升级，保持 version 2');
  ALL_STORES.forEach((s) => assert.ok(d.stores.includes(s), '高版本库 store 全部可访问'));
});
