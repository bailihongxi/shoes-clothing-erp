// 问题 5 测试：手机端「我的」增设云同步按钮
//
// 需求（用户确认）：
//   手机端「我的」页增设同步按钮，把手机版操作信息同步到 GitHub Pages 页面并覆盖历史信息。
//   用户选择了「加密同步（推荐）」——上传的是 AES-GCM 密文，公开仓库也看不到经营数据；
//   GitHub Token 由用户自己在页面里填写，只存本机浏览器，不进代码 / 不进 Git。
//
// 实现要点（见 js/core/sync.js + js/ui/page-mine.js）：
//   - 配置只存本机 localStorage：loadConfig / saveConfig / validateConfig；
//   - 加解密：PBKDF2-SHA256 派生密钥 → AES-GCM-256 信封（encrypt / decrypt / validateEnvelope）；
//   - 快照打包：buildSnapshotText（复用 backup.build，剔除 settings.sync）/ summaryText；
//   - GitHub Contents API：push（先取 sha 再 PUT，有 sha 即覆盖历史）/ pull（拉取信封）；
//   - 高层流程：syncUp（打包→加密→上传覆盖）/ syncDown（下载→解密→覆盖本地）；
//   - guessFromLocation：从 *.github.io/repo 网址自动猜 owner/repo；
//   - 页面：renderSync / 动作 sync-up / sync-down / save-sync-cfg / sync-field / toggle-sync-cfg。
const test = require('node:test');
const assert = require('node:assert');

const sync = require('../js/core/sync.js');
const { newCtx } = require('./helpers/ctx.js');

/* ---------------- mock 工具 ---------------- */

function makeStore(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    _data: m
  };
}

function res(status, bodyObj, bodyText) {
  return {
    status: status,
    ok: status >= 200 && status < 300,
    json() { return Promise.resolve(bodyObj); },
    text() { return Promise.resolve(bodyText !== undefined ? bodyText : JSON.stringify(bodyObj)); }
  };
}

// 模拟 GitHub Contents API：记录最后一次 PUT 的 base64 内容，GET 把它原样吐回
function makeGitHub(store) {
  let n = 0;
  return function (url, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET') {
      if (store.contentB64 == null) {
        return Promise.resolve(res(404, { message: 'Not Found' }, '{"message":"Not Found"}'));
      }
      return Promise.resolve(res(200, { sha: store.sha, content: store.contentB64 }));
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      n += 1;
      store.sha = 'sha_' + n;
      store.contentB64 = body.content; // 上传的是 envelope 的 base64
      store.lastBody = body;
      return Promise.resolve(res(200, { commit: { sha: store.sha }, content: body.content }));
    }
    return Promise.resolve(res(405, {}, '{"message":"Method Not Allowed"}'));
  };
}

function validCfg(over) {
  return Object.assign({
    owner: 'bailihongxi',
    repo: 'shoes-clothing-erp',
    branch: 'gh-pages',
    path: 'data/erp-snapshot.json',
    token: 'github_pat_xxx',
    passphrase: 'mysecret123'
  }, over || {});
}

function seed(ctx) {
  ctx.data.products.push({
    styleCode: 'X001', name: '小白鞋', category: '鞋',
    barcode: 'XA1234', costPrice: 50, salePrice: 129, status: 'on'
  });
  ctx.data.skus.push({ id: 'X0010138', styleCode: 'X001', color: '白', size: '38', stock: 3, threshold: 3 });
  ctx.data.purchases.push({ no: 'P0001', date: '2026-08-01', total: 3000, items: [] });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('skus', ctx.data.skus[0]);
  ctx.touch('purchases', ctx.data.purchases[0]);
}

/* ---------------- ① 加解密往返 ---------------- */

test('问题5-加密：encrypt 产出 AES-GCM 信封，decrypt 能还原明文', async () => {
  const env = await sync.encrypt('这是一笔机密账本数据', 'mysecret123');
  assert.strictEqual(env.kind, 'sync-snapshot');
  assert.strictEqual(env.alg, 'AES-GCM-256');
  assert.strictEqual(env.kdf, 'PBKDF2-SHA256');
  assert.strictEqual(env.iter, sync.KDF_ITERATIONS);
  assert.ok(env.salt && env.iv && env.ct, 'salt/iv/ct 都应存在');
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(env.ct), 'ct 应为 base64');

  const text = await sync.decrypt(env, 'mysecret123');
  assert.strictEqual(text, '这是一笔机密账本数据', '明文应原样还原');
});

test('问题5-加密：同一口令每次密文不同（随机 salt/iv），但都能解', async () => {
  const a = await sync.encrypt('相同明文', 'pw');
  const b = await sync.encrypt('相同明文', 'pw');
  assert.notStrictEqual(a.ct, b.ct, '随机 salt/iv 应使密文不同');
  assert.strictEqual(await sync.decrypt(a, 'pw'), '相同明文');
  assert.strictEqual(await sync.decrypt(b, 'pw'), '相同明文');
});

test('问题5-加密：口令错误 → decrypt 明确报错，不会泄露明文', async () => {
  const env = await sync.encrypt('hello', 'right-pw');
  await assert.rejects(() => sync.decrypt(env, 'wrong-pw'), /解密失败/);
});

test('问题5-编码：textToBase64 / base64ToText 往返（含中文与 emoji）', () => {
  const s = '中文账本 🔒 1/2 款';
  assert.strictEqual(sync.base64ToText(sync.textToBase64(s)), s);
});

/* ---------------- ② 信封校验 ---------------- */

test('问题5-校验：合法信封通过 validateEnvelope', () => {
  const env = { kind: 'sync-snapshot', v: 1, salt: 'a', iv: 'b', ct: 'c' };
  const r = sync.validateEnvelope(env);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.envelope, env);
});

test('问题5-校验：非本软件快照 / 缺字段 / 高版本 → 拒绝', () => {
  assert.strictEqual(sync.validateEnvelope({ kind: 'other' }).ok, false);
  assert.strictEqual(sync.validateEnvelope('{坏json').ok, false, '坏 JSON 应拒绝');
  assert.strictEqual(sync.validateEnvelope({ kind: 'sync-snapshot', v: 1 }).ok, false, '缺 salt/iv/ct');
  const hi = { kind: 'sync-snapshot', v: sync.ENVELOPE_VERSION + 1, salt: 'a', iv: 'b', ct: 'c' };
  assert.strictEqual(sync.validateEnvelope(hi).ok, false, '高于当前版本应拒绝');
});

/* ---------------- ③ 配置 ---------------- */

test('问题5-配置：完整配置通过 validateConfig', () => {
  assert.strictEqual(sync.validateConfig(validCfg()).ok, true);
});

test('问题5-配置：缺项 / 路径非 .json / 口令过短 → 明确报错', () => {
  let v = sync.validateConfig(validCfg({ owner: '' }));
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /owner/.test(e)));

  v = sync.validateConfig(validCfg({ path: 'data/snap.txt' }));
  assert.strictEqual(v.ok, false, '路径需以 .json 结尾');

  v = sync.validateConfig(validCfg({ passphrase: '123' }));
  assert.strictEqual(v.ok, false, '口令至少 6 位');
});

test('问题5-配置：saveConfig 落本机、去空格、归一化 path；loadConfig 可回读', () => {
  const store = makeStore();
  const saved = sync.saveConfig(store, validCfg({ path: '/data/erp-snapshot.json/', token: '  tok_123  ' }));
  assert.strictEqual(saved.path, 'data/erp-snapshot.json', 'path 首尾斜杠应被去掉');
  assert.strictEqual(saved.token, 'tok_123', '应去空格');

  const back = sync.loadConfig(store);
  assert.strictEqual(back.owner, 'bailihongxi');
  assert.strictEqual(back.token, 'tok_123');
  assert.strictEqual(back.path, 'data/erp-snapshot.json');
});

test('问题5-配置：store 里是坏 JSON 时 loadConfig 回退默认值', () => {
  const store = makeStore({ 'erp.sync.config': '{这不是json' });
  const cfg = sync.loadConfig(store);
  assert.strictEqual(cfg.owner, '', '应回退默认空字符串');
  assert.strictEqual(cfg.branch, 'gh-pages');
});

/* ---------------- ④ 网址推测 / 地址 ---------------- */

test('问题5-网址：guessFromLocation 从 github.io 网址猜出 owner/repo', () => {
  const g = sync.guessFromLocation({ hostname: 'bailihongxi.github.io', pathname: '/shoes-clothing-erp/x.html' });
  assert.deepStrictEqual(g, { owner: 'bailihongxi', repo: 'shoes-clothing-erp' });
});

test('问题5-网址：本地 file:// 或非 github 域名 → null', () => {
  assert.strictEqual(sync.guessFromLocation({ hostname: 'localhost', pathname: '/' }), null);
  assert.strictEqual(sync.guessFromLocation({ hostname: 'example.com', pathname: '/' }), null);
  assert.strictEqual(sync.guessFromLocation(null), null);
});

test('问题5-地址：apiUrl / pagesUrl / commitMessage 格式正确', () => {
  const cfg = validCfg();
  assert.strictEqual(
    sync.apiUrl(cfg),
    'https://api.github.com/repos/bailihongxi/shoes-clothing-erp/contents/data/erp-snapshot.json'
  );
  assert.strictEqual(sync.pagesUrl(cfg), 'https://bailihongxi.github.io/shoes-clothing-erp/');
  assert.ok(/^chore\(sync\):/.test(sync.commitMessage()));
});

/* ---------------- ⑤ 快照打包 ---------------- */

test('问题5-快照：buildSnapshotText 产出可解析 JSON，含 app/schemaVersion/摘要', () => {
  const ctx = newCtx();
  seed(ctx);
  const snap = sync.buildSnapshotText(ctx);
  assert.strictEqual(typeof snap.text, 'string');
  assert.ok(snap.bytes > 0);
  const obj = JSON.parse(snap.text);
  assert.strictEqual(obj.app, 'shoe-erp');
  assert.strictEqual(obj.summary.products, 1);
  assert.strictEqual(obj.summary.skus, 1);
  assert.strictEqual(obj.summary.purchases, 1);
});

test('问题5-快照：settings.sync 不会进入上传快照', () => {
  const ctx = newCtx();
  ctx.settings.sync = { token: 'should-not-leak', passphrase: 'nope' };
  seed(ctx);
  const obj = JSON.parse(sync.buildSnapshotText(ctx).text);
  assert.strictEqual(obj.settings && obj.settings.sync, undefined, '同步凭据不得进快照');
});

test('问题5-摘要：summaryText 拼出「3 款 / 12 色码 / 5 进货单」样式', () => {
  const t = sync.summaryText({ products: 3, skus: 12, purchases: 5 });
  assert.ok(t.includes('3 款'), t);
  assert.ok(t.includes('12 色码'), t);
  assert.ok(t.includes('5 进货单'), t);
  assert.strictEqual(sync.summaryText({}), '空账本');
});

/* ---------------- ⑥ GitHub push / pull（覆盖历史） ---------------- */

test('问题5-GitHub：push 首次建文件（无 sha），再次 push 带 sha 覆盖历史', async () => {
  const cfg = validCfg();
  const store = {};
  const fetchImpl = makeGitHub(store);

  const r1 = await sync.push(cfg, '{"first":1}', fetchImpl);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.created, true, '首次应视为新建');
  assert.strictEqual(store.sha, 'sha_1');
  assert.strictEqual(store.lastBody.sha, undefined, '首次 PUT 不带 sha');

  const r2 = await sync.push(cfg, '{"second":2}', fetchImpl);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.created, false, '第二次应视为覆盖');
  assert.strictEqual(store.lastBody.sha, 'sha_1', '覆盖历史必须带上旧 sha');
});

test('问题5-GitHub：配置缺失时 push 直接拒绝', async () => {
  await assert.rejects(() => sync.push(validCfg({ token: '' }), 'x', makeGitHub({})),
    /Token|请填写/);
});

test('问题5-GitHub：pull 取回 PUT 上去的内容，且能通过信封校验', async () => {
  const cfg = validCfg();
  const store = {};
  const fetchImpl = makeGitHub(store);
  await sync.push(cfg, JSON.stringify({ kind: 'sync-snapshot', v: 1, salt: 'a', iv: 'b', ct: 'c' }), fetchImpl);

  const env = await sync.pull(cfg, fetchImpl);
  assert.strictEqual(env.kind, 'sync-snapshot');
  assert.strictEqual(env.ct, 'c');
});

test('问题5-GitHub：pull 云端为空 → 友好报错', async () => {
  await assert.rejects(() => sync.pull(validCfg(), makeGitHub({})), /还没有快照/);
});

/* ---------------- ⑦ 高层流程：syncUp / syncDown 端到端 ---------------- */

test('问题5-流程：syncUp 加密上传，syncDown 下载解密并覆盖另一台设备', async () => {
  const cfg = validCfg();
  const store = {};
  const fetchImpl = makeGitHub(store);

  const ctxA = newCtx();
  seed(ctxA);
  const up = await sync.syncUp(ctxA, cfg, fetchImpl);
  assert.strictEqual(up.ok, true);
  assert.strictEqual(up.created, true);
  assert.ok(up.bytes > 0);
  assert.ok(/款/.test(up.summaryText), '摘要应含款数：' + up.summaryText);

  // 另一台设备：空账本
  const ctxB = newCtx();
  assert.strictEqual(ctxB.data.products.length, 0);
  const down = await sync.syncDown(ctxB, cfg, fetchImpl);
  assert.strictEqual(down.ok, true);
  assert.strictEqual(ctxB.data.products.length, 1, '应恢复出 A 的商品');
  assert.strictEqual(ctxB.data.products[0].styleCode, 'X001');
  assert.strictEqual(ctxB.data.skus.length, 1);
});

test('问题5-流程：syncUp 配置不全 → 返回 ok:false 并带错误信息', async () => {
  const r = await sync.syncUp(newCtx(), validCfg({ passphrase: '' }), makeGitHub({}));
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('口令'), r.error);
});

test('问题5-流程：syncDown 口令不对 → 解密失败且不动本地数据', async () => {
  const cfg = validCfg();
  const store = {};
  const fetchImpl = makeGitHub(store);
  const ctxA = newCtx();
  seed(ctxA);
  const up = await sync.syncUp(ctxA, cfg, fetchImpl);
  assert.strictEqual(up.ok, true);

  const ctxB = newCtx();
  seed(ctxB); // B 已有自己的数据
  const badCfg = validCfg({ passphrase: 'different-pw' });
  const down = await sync.syncDown(ctxB, badCfg, fetchImpl);
  assert.strictEqual(down.ok, false);
  assert.ok(/解密失败/.test(down.error), down.error);
  assert.strictEqual(ctxB.data.products.length, 1, '解密失败时本机数据不应被覆盖');
});
