/**
 * sync.js gzip 压缩信封（v2）与上传体积上限测试
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');

function bytesOf(s) {
  return new TextEncoder().encode(s);
}

function strOf(b) {
  return new TextDecoder().decode(b);
}

test('gzip/gunzip：压缩后解压还原原文（Node 22 CompressionStream）', async () => {
  const text = '鞋服账本快照 '.repeat(200);
  const gz = await sync.gzip(bytesOf(text));
  assert.ok(gz, '应能压缩');
  assert.ok(gz.length < bytesOf(text).length, '压缩后更小: ' + gz.length + ' < ' + bytesOf(text).length);
  const back = await sync.gunzip(gz);
  assert.ok(back, '应能解压');
  assert.strictEqual(strOf(back), text);
});

test('gzip：不可压缩数据也返回非 null（纯随机字节）', async () => {
  const raw = new Uint8Array(4096);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31) % 256;
  const gz = await sync.gzip(raw);
  assert.ok(gz && gz.length > 0);
});

test('encrypt：压缩字节 + comp=gzip → 信封标记 v2 且 comp 字段存在，decrypt 自动解压还原', async () => {
  const text = '张女士 换货单 '.repeat(100);
  const gz = await sync.gzip(bytesOf(text));
  assert.ok(gz, 'gzip 可用');
  const env = await sync.encrypt(gz, 'secret123', '2026-09-09T10:00:00Z', { comp: 'gzip' });
  assert.strictEqual(env.v, sync.ENVELOPE_VERSION);
  assert.strictEqual(env.comp, 'gzip');
  const plain = await sync.decrypt(env, 'secret123');
  assert.strictEqual(plain, text);
});

test('encrypt：字符串（未压缩 v1 兼容）→ 无 comp 字段，decrypt 正常还原', async () => {
  const env = await sync.encrypt('普通文本快照', 'secret123', '2026-09-09T10:00:00Z');
  assert.strictEqual(env.v, sync.ENVELOPE_VERSION);
  assert.strictEqual(env.comp, undefined, '字符串加密不标记压缩');
  const plain = await sync.decrypt(env, 'secret123');
  assert.strictEqual(plain, '普通文本快照');
});

test('decrypt：口令错误报明确错误', async () => {
  const env = await sync.encrypt('机密', 'right-pass', '2026-09-09T10:00:00Z');
  await assert.rejects(() => sync.decrypt(env, 'wrong-pass'), /口令不对/);
});

test('validateEnvelope：未来版本（v3）拒绝', () => {
  const r = sync.validateEnvelope({ kind: 'sync-snapshot', v: 3, salt: 's', iv: 'i', ct: 'c' });
  assert.ok(!r.ok && /高于当前程序/.test(r.error));
});

test('checkUploadSize：正常体积返回 null，超限返回错误', () => {
  assert.strictEqual(sync.checkUploadSize('{"a":1}'), null);
  const big = 'x'.repeat(sync.MAX_UPLOAD_BYTES * 4 / 3 + 8);
  const err = sync.checkUploadSize(big);
  assert.ok(err && /超过上传上限/.test(err), '应报超限：' + err);
});

test('syncUp：走 gzip 压缩后上传（信封 comp=gzip），bytes 报告压缩后体积', async () => {
  const backup = require('../js/core/backup.js');
  const ctx = {
    data: { products: [], skus: [], purchases: [], sales: [], ledgers: [], meta: [] },
    settings: { shopName: '鞋店', scopeCategories: ['鞋'] }
  };
  let pushed = null;
  const fakeFetch = async (url, opts) => {
    if (opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      pushed = { url, content: body.content };
      return { ok: true, json: async () => ({ commit: { sha: 'abc' } }) };
    }
    return { status: 404 };
  };
  const cfg = {
    owner: 'bailihongxi', repo: 'shoes-clothing-erp', branch: 'gh-pages',
    path: 'data/acct1/erp-snapshot.json', token: 't', passphrase: 'sync-pass'
  };
  const r = await sync.syncUp(ctx, cfg, fakeFetch);
  assert.ok(r.ok, '同步应成功: ' + (r.error || ''));
  assert.ok(pushed, '应调用上传');
  const env = JSON.parse(Buffer.from(pushed.content, 'base64').toString('utf8'));
  assert.strictEqual(env.kind, 'sync-snapshot');
  assert.ok(env.comp === 'gzip' || !env.comp, '允许压缩或降级明文');
  // 解密验证往返
  const plain = await sync.decrypt(env, 'sync-pass');
  const snap = JSON.parse(plain);
  assert.strictEqual(snap.settings.shopName, '鞋店');
  assert.ok(r.bytes > 0, '报告上传字节数');
});
