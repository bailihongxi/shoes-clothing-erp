/**
 * V3-阶段5：GitHub 同步按账号隔离（core/sync.js）
 * - 配置 key 按账号（erp.sync.config.<acctId>）
 * - 默认存储路径按账号（data/<acctId>/erp-snapshot.json）
 * - 各账号配置互不覆盖；无账号兼容旧 key/path
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _m: m
  };
}

test('sync.configKeyFor：按账号隔离，无账号兼容旧 key', () => {
  assert.strictEqual(sync.configKeyFor('acct1'), 'erp.sync.config.acct1');
  assert.strictEqual(sync.configKeyFor('acct2'), 'erp.sync.config.acct2');
  assert.strictEqual(sync.configKeyFor(null), 'erp.sync.config');
  assert.strictEqual(sync.configKeyFor(''), 'erp.sync.config');
  assert.notStrictEqual(sync.configKeyFor('acct1'), sync.configKeyFor('acct2'));
});

test('sync.defaultPathFor：每账号独立存储路径', () => {
  assert.strictEqual(sync.defaultPathFor('acct1'), 'data/acct1/erp-snapshot.json');
  assert.strictEqual(sync.defaultPathFor('acct2'), 'data/acct2/erp-snapshot.json');
  assert.strictEqual(sync.defaultPathFor(null), 'data/erp-snapshot.json');
  assert.notStrictEqual(sync.defaultPathFor('acct1'), sync.defaultPathFor('acct2'));
});

test('loadConfig：账号默认路径按账号，未配置时用默认', () => {
  const store = memStore();
  const c1 = sync.loadConfig(store, 'acct1');
  assert.strictEqual(c1.path, 'data/acct1/erp-snapshot.json');
  const c2 = sync.loadConfig(store, 'acct2');
  assert.strictEqual(c2.path, 'data/acct2/erp-snapshot.json');
  const c0 = sync.loadConfig(store);
  assert.strictEqual(c0.path, 'data/erp-snapshot.json');
});

test('saveConfig/loadConfig：各账号配置互不覆盖', () => {
  const store = memStore();
  sync.saveConfig(store, { owner: 'bailihongxi', repo: 'shoes-clothing-erp', token: 't1', passphrase: 'p1' }, 'acct1');
  sync.saveConfig(store, { owner: 'bailihongxi', repo: 'shoes-clothing-erp', token: 't2', passphrase: 'p2' }, 'acct2');

  const c1 = sync.loadConfig(store, 'acct1');
  assert.strictEqual(c1.token, 't1');
  assert.strictEqual(c1.passphrase, 'p1');
  assert.strictEqual(c1.path, 'data/acct1/erp-snapshot.json');
  const c2 = sync.loadConfig(store, 'acct2');
  assert.strictEqual(c2.token, 't2');
  assert.strictEqual(c2.passphrase, 'p2');
  assert.strictEqual(c2.path, 'data/acct2/erp-snapshot.json');

  // 账号1 与账号2 的 key 不同，互不影响
  assert.notStrictEqual(c1.token, c2.token);
  // 无账号默认不受账号配置影响
  const c0 = sync.loadConfig(store);
  assert.strictEqual(c0.token, '', '无账号默认无 token');
});

test('saveConfig：无账号写旧 key，兼容 V2', () => {
  const store = memStore();
  sync.saveConfig(store, { token: 'legacy' });
  assert.ok(store._m.has('erp.sync.config'), '写旧 key');
  const c0 = sync.loadConfig(store);
  assert.strictEqual(c0.token, 'legacy');
  // 账号配置独立于旧 key
  const c1 = sync.loadConfig(store, 'acct3');
  assert.strictEqual(c1.token, '');
});

test('saveConfig：path 归一化保留账号默认', () => {
  const store = memStore();
  const cfg = sync.saveConfig(store, { owner: 'x', repo: 'y' }, 'acct1');
  assert.strictEqual(cfg.path, 'data/acct1/erp-snapshot.json');
});
