/**
 * V3 修复：登录页切换账户无反馈
 * - 登录页不应出现在侧栏/底栏导航（hideInNav）
 * - 登录成功后若 hash 仍为 #/login，自动跳转到首页，避免"点进入无反应"
 */
const test = require('node:test');
const assert = require('node:assert');
const loginPage = require('../js/ui/page-login.js');
const router = require('../js/ui/router.js');
require('../js/app.js'); // 挂载到 globalThis.ERP.app
const app = globalThis.ERP.app;

function setupEnv(hash) {
  globalThis.location = { hash: hash || '#/login' };
  globalThis.document = {
    getElementById: () => ({ innerHTML: '' }),
    readyState: 'complete',
    addEventListener: () => {}
  };
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.db = { create: async () => ({}) };
  globalThis.ERP.repo = {
    loadAll: async () => ({}),
    createContext: () => ({ settings: {}, dirtyKeys: () => [] })
  };
  globalThis.ERP.schema = {
    dbNameFor: (id) => 'test_' + id,
    ALL_CATEGORIES: ['鞋', '服装', '配饰']
  };
  router.register('login', { name: 'login', render: () => '' });
  router.register('home', { name: 'home', render: () => '' });
}

test('登录页 hideInNav=true，不出现在侧栏导航', () => {
  assert.strictEqual(loginPage.hideInNav, true, 'login 页应标记 hideInNav');
});

test('登录成功后 enterAccount 自动从 login 页跳转到首页', async () => {
  setupEnv('#/login');
  // 记录 router.go 调用
  let goArg = null;
  const origGo = router.go;
  router.go = function (name) { goArg = name; };
  try {
    // acct2 跳过存量迁移
    await app.enterAccount({ id: 'acct2', shopName: '测试店', scopeCategories: ['服装'] });
  } finally {
    router.go = origGo;
  }
  assert.strictEqual(goArg, 'home', '登录后应调用 router.go("home") 离开登录页');
});

test('登录成功后若已在非 login 页则不强制跳转', async () => {
  setupEnv('#/home');
  let goArg = null;
  const origGo = router.go;
  router.go = function (name) { goArg = name; };
  try {
    await app.enterAccount({ id: 'acct2', shopName: '测试店' });
  } finally {
    router.go = origGo;
  }
  assert.strictEqual(goArg, null, '已在首页时不应重复跳转');
});
