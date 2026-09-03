/**
 * 修复：登录系统与家电项目混合
 * 根因：家电 ERP（复制本项目）与鞋服项目在同一 origin（file:// 或同一 GitHub Pages 域）共用
 *       localStorage / IndexedDB，且账号 id 相同（acct1/2/3），导致账号列表、登录态被家电账号覆盖。
 * 修复：key 前缀命名空间化（erp.* → shoeErp.*）、IndexedDB 库名前缀隔离（shoeErp_ → shoeClothingErp_）、
 *       旧 erp.accounts 家电残留清理、经营范围统一清洗为鞋服配饰分类。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const accounts = require('../js/core/accounts.js');
const schema = require('../js/core/schema.js');
const sync = require('../js/core/sync.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m
  };
}

test('账号 key 命名空间化：ensurePreset 写入 shoeErp.accounts，不写 erp.accounts', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  assert.ok(store._m.has('shoeErp.accounts'), '应写新 key shoeErp.accounts');
  assert.ok(!store._m.has('erp.accounts'), '不应写旧 key erp.accounts');
  const list = JSON.parse(store._m.get('shoeErp.accounts'));
  assert.strictEqual(list.length, 3, '预置 3 账号');
  assert.deepStrictEqual(list.map(a => a.username), ['shoe', 'clothes', 'accessory']);
});

test('旧 erp.accounts 家电残留：ensurePreset 时被剔除，登录只剩鞋服账号', () => {
  const store = memStore({
    'erp.accounts': JSON.stringify([
      { id: 'admin', username: 'admin', shopName: '管理总控', scopeCategories: ['冰箱', '洗衣机', '空调'], hash: 'h$x.1' },
      { id: 'acct1', username: 'appliance', shopName: '大家电店', scopeCategories: ['冰箱', '电视'], hash: 'h$x.2' },
      { id: 'acct2', username: 'smallapp', shopName: '小家电店', scopeCategories: ['厨房电器'], hash: 'h$x.3' }
    ])
  });
  const list = accounts.ensurePreset(store);
  assert.ok(!store._m.has('erp.accounts'), '家电旧 key 应被删除（剔除家电）');
  assert.ok(store._m.has('shoeErp.accounts'), '新 key 应创建');
  const pubs = accounts.publicList(list);
  assert.strictEqual(pubs.length, 3, '登录列表只剩 3 个鞋服账号');
  const homeApplianceShops = ['管理总控', '大家电店', '小家电店'];
  pubs.forEach((a) => {
    assert.ok(homeApplianceShops.indexOf(a.shopName) < 0, '无家电账号：' + a.shopName);
  });
  assert.deepStrictEqual(pubs.map(a => a.username).sort(), ['accessory', 'clothes', 'shoe'], '3 个鞋服预置账号');
});

test('旧 key 全为鞋服分类（未污染）：迁移到新 key 保留账号资料', () => {
  const store = memStore({
    'erp.accounts': JSON.stringify([
      { id: 'acct1', username: 'shoe', shopName: '老王鞋行', scopeCategories: ['鞋'], hash: 'h$keep.1', createdAt: '2026-08-01' }
    ])
  });
  const list = accounts.ensurePreset(store);
  const pubs = accounts.publicList(list);
  assert.ok(pubs.some(a => a.shopName === '老王鞋行'), '未污染旧账号资料应保留');
  assert.ok(!store._m.has('erp.accounts'), '旧 key 迁移后删除');
  assert.ok(store._m.has('shoeErp.accounts'), '写入新 key');
});

test('sanitizeScope：家电分类被剔除，全部按鞋服配饰分类', () => {
  const shoe = accounts.sanitizeScope(['冰箱', '洗衣机', '空调', '电视']);
  assert.deepStrictEqual(shoe, accounts.ALL_CATEGORIES, '全为家电分类 → 重置为全部分类（鞋服配饰）');
  const mixed = accounts.sanitizeScope(['鞋', '冰箱', '配饰']);
  assert.deepStrictEqual(mixed, ['鞋', '配饰'], '混合分类 → 只保留鞋服配饰分类');
  const all = accounts.sanitizeScope(['鞋', '服装', '裤', '配饰', '包袋', '其他']);
  assert.deepStrictEqual(all, accounts.ALL_CATEGORIES);
});

test('load 时自动清洗经营范围：读入家电分类账号 → 鞋服分类', () => {
  const store = memStore({
    'shoeErp.accounts': JSON.stringify([
      { id: 'acct1', username: 'shoe', shopName: '鞋店', scopeCategories: ['冰箱', '洗衣机'], hash: 'h$x.1' }
    ])
  });
  const list = accounts.load(store);
  assert.strictEqual(list[0].shopName, '鞋店');
  assert.deepStrictEqual(list[0].scopeCategories, accounts.ALL_CATEGORIES, '家电分类清洗为全部分类');
});

test('IndexedDB 库名隔离：dbNameFor 使用 shoeClothingErp_ 前缀（避开家电 shoeErp_ 库）', () => {
  assert.strictEqual(schema.dbNameFor('acct1'), 'shoeClothingErp_acct1');
  assert.strictEqual(schema.dbNameFor('acct2'), 'shoeClothingErp_acct2');
  assert.strictEqual(schema.dbNameFor('acct3'), 'shoeClothingErp_acct3');
  assert.strictEqual(schema.dbNameFor(null), 'shoeErp', '无账号兼容 V2 旧库（迁移读取用）');
  assert.notStrictEqual(schema.dbNameFor('acct1'), 'shoeErp_acct1', '不再使用家电同名库');
});

test('sync 配置 key 命名空间化：shoeErp.sync.config[.<acctId>]', () => {
  assert.strictEqual(sync.CONFIG_KEY, 'shoeErp.sync.config');
  assert.strictEqual(sync.configKeyFor('acct1'), 'shoeErp.sync.config.acct1');
  assert.strictEqual(sync.configKeyFor(null), 'shoeErp.sync.config');
});

test('app.js 登录态与迁移标记使用新命名空间 key', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  assert.ok(appJs.includes("'shoeErp.currentAccount'"), 'CURRENT_KEY 应为 shoeErp.currentAccount');
  assert.ok(!/CURRENT_KEY = 'erp\.currentAccount'/.test(appJs), '不再使用 erp.currentAccount');
  assert.ok(appJs.includes("'shoeErp.migratedV3'"), '迁移标记应为 shoeErp.migratedV3');
});
