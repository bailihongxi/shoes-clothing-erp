// 问题 2（深度修复）测试：保存进货单按钮 + 持久化 + 成功提醒 + 清空表单
//
// 用户反馈：
//   ① 保存进货单按钮无反应（没明确反馈）
//   ② 保存后刷新页面，数据（库存）自动清空 —— 浏览器 IndexedDB 在页面卸载瞬间，
//      若"落库"是"发射后不管"的异步操作，事务可能被中断导致数据丢失。
//
// 修复要点（见 js/app.js / js/ui/page-purchase.js）：
//   - 统一动作派发 actHandler：动作抛错给出明确错误提示，不再整页静默无反应；
//   - afterAction 内部 await 落库，落库失败明确提示（避免"假保存"）；
//   - 新增 pagehide / visibilitychange 安全网：页面隐藏或卸载前强制把脏数据落库；
//   - 保存成功提示明确写明"已入库 N 件，库存已更新"，并清空表单便于再次开单。
//
// 覆盖：
//   ① 端到端持久化：保存进货单 → flush → 「刷新页面」(重新打开 IndexedDB) → 数据仍在、库存已加
//   ② 保存动作成功提示文案包含「已保存 / 已入库 N 件 / 库存已更新」
//   ③ 保存成功后表单被清空（state.form.items 为空，tab 回到 list）
//   ④ app.js 提供页面卸载前落库安全网（flushOnHide 逻辑存在）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 注入 fake-indexeddb，模拟浏览器 IndexedDB（可跨「会话/刷新」保持数据）
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

const ROOT = path.join(__dirname, '..', 'js');
const schema = require(path.join(ROOT, 'core/schema.js'));
const util = require(path.join(ROOT, 'core/util.js'));
const docNo = require(path.join(ROOT, 'core/docNo.js'));
const inventory = require(path.join(ROOT, 'core/inventory.js'));
const ledger = require(path.join(ROOT, 'core/ledger.js'));
const debt = require(path.join(ROOT, 'core/debt.js'));
const cart = require(path.join(ROOT, 'core/cart.js'));
const engine = require(path.join(ROOT, 'core/engine.js'));
const repo = require(path.join(ROOT, 'store/repo.js'));
const dbmod = require(path.join(ROOT, 'store/db.js'));
// 页面动作依赖 ui（components.js）
const ui = require(path.join(ROOT, 'ui/components.js'));
const purchase = require(path.join(ROOT, 'ui/page-purchase.js'));

global.ERP = Object.assign(global.ERP || {}, {
  schema, util, docNo, inventory, ledger, debt, cart, engine, repo, ui
});

async function freshCtx(db) {
  const data = await repo.loadAll(db);
  return repo.createContext(data);
}

/* ---------------- ① 持久化：保存后「刷新页面」数据不丢 ---------------- */

test('问题2-持久化：保存进货单后「刷新页面」（重新打开 IndexedDB）数据仍在、库存已加', async () => {
  // 会话 1：建商品 + 保存进货单 + 落库
  const db = await dbmod.create({ backend: dbmod.indexedDbBackend(indexedDB), name: 'issue2b', version: 1 });
  let ctx = await freshCtx(db);

  ctx.data.products.push({
    styleCode: 'X001', name: '童鞋', category: '鞋', color: '红',
    sizes: ['28'], barcodes: [], status: schema.STATUS.ON,
    costPrice: 100, salePrice: 200, createdAt: util.nowISO()
  });
  ctx.data.skus.push({ id: 'X001#红#28', styleCode: 'X001', color: '红', size: '28', costPrice: 100, stock: 0 });
  await repo.flush(ctx, db);
  ctx.clearDirty();

  const res = engine.savePurchase(ctx, {
    date: util.today(),
    partnerName: '供应商甲',
    items: [{ skuId: 'X001#红#28', qty: 10, costPrice: '120' }],
    paid: '0', note: ''
  });
  assert.ok(res.ok, '保存进货单应成功');
  const flushRes = await repo.flush(ctx, db);
  assert.ok(flushRes.purchases >= 1, 'purchases 表应已落库');
  await db.close();

  // 会话 2：模拟「刷新页面」—— 重新打开同名 IndexedDB
  const db2 = await dbmod.create({ backend: dbmod.indexedDbBackend(indexedDB), name: 'issue2b', version: 1 });
  const ctx2 = await freshCtx(db2);

  assert.strictEqual(ctx2.data.purchases.length, 1, '刷新后进货单应仍存在（未丢失）');
  const sku = ctx2.getSku('X001#红#28');
  assert.ok(sku, '刷新后 SKU 应存在');
  assert.strictEqual(sku.stock, 10, '刷新后库存应为 10（已入库，未被清空）');
  const partner = ctx2.data.partners.find(p => p.name === '供应商甲');
  assert.ok(partner, '刷新后供应商也应持久化');

  await db2.clearAll();
  await db2.close();
});

/* ---------------- ② 成功提示文案 ---------------- */

test('问题2-反馈：保存成功提示包含「已保存 / 已入库 N 件 / 库存已更新」', async () => {
  const db = await dbmod.create({ backend: dbmod.memoryBackend(), name: 'm1', version: 1 });
  const ctx = await freshCtx(db);
  ctx.data.products.push({
    styleCode: 'X002', name: '童袜', category: '其他', color: '蓝',
    sizes: ['S'], barcodes: [], status: schema.STATUS.ON,
    costPrice: 5, salePrice: 10, createdAt: util.nowISO()
  });
  ctx.data.skus.push({ id: 'X002#蓝#S', styleCode: 'X002', color: '蓝', size: 'S', costPrice: 5, stock: 0 });

  const toasts = [];
  const origToast = ui.toast;
  ui.toast = function (msg, type) { toasts.push({ msg: msg, type: type }); };

  const state = purchase.init(ctx);
  state.tab = 'form';
  state.form = Object.assign(purchase.init(ctx).form, {
    date: util.today(),
    partnerId: '',
    newPartner: '供应商乙',
    items: [{ skuId: 'X002#蓝#S', qty: 7, costPrice: '8' }],
    paid: '0', note: ''
  });

  const ret = purchase.actions['save-purchase'](ctx, state);
  ui.toast = origToast;

  assert.strictEqual(ret, true, '保存成功应返回 true');
  assert.strictEqual(toasts.length, 1, '应弹出一条成功提示');
  const msg = toasts[0].msg;
  assert.match(msg, /已保存/, '提示应含「已保存」');
  assert.match(msg, /已入库\s*7\s*件/, '提示应含「已入库 7 件」');
  assert.match(msg, /库存已更新/, '提示应含「库存已更新」');
  assert.strictEqual(toasts[0].type, 'ok', '应为成功类型');
});

/* ---------------- ③ 保存后清空表单 ---------------- */

test('问题2-清空：保存成功后表单被清空（items 为空、tab 回到 list）', async () => {
  const db = await dbmod.create({ backend: dbmod.memoryBackend(), name: 'm2', version: 1 });
  const ctx = await freshCtx(db);
  ctx.data.products.push({
    styleCode: 'X003', name: '童装', category: '服装', color: '绿',
    sizes: ['110'], barcodes: [], status: schema.STATUS.ON,
    costPrice: 30, salePrice: 60, createdAt: util.nowISO()
  });
  ctx.data.skus.push({ id: 'X003#绿#110', styleCode: 'X003', color: '绿', size: '110', costPrice: 30, stock: 0 });

  const state = purchase.init(ctx);
  state.tab = 'form';
  state.form = Object.assign(purchase.init(ctx).form, {
    date: util.today(),
    newPartner: '供应商丙',
    items: [{ skuId: 'X003#绿#110', qty: 3, costPrice: '35' }],
    paid: '100', note: '测试'
  });

  const ret = purchase.actions['save-purchase'](ctx, state);
  assert.strictEqual(ret, true);
  assert.strictEqual(state.tab, 'list', '保存后应回到列表');
  assert.strictEqual(state.form.items.length, 0, '保存后明细应被清空');
  assert.strictEqual(state.form.styleCode, '', '保存后款号应清空');
  assert.strictEqual(state.form.paid, '', '保存后已付应清空');
  // 库存确实已增加（证明"已加入库存"）
  assert.strictEqual(ctx.getSku('X003#绿#110').stock, 3, '库存应已增加 3');
});

/* ---------------- ④ 页面卸载前落库安全网存在 ---------------- */

test('问题2-安全网：app.js 在页面隐藏/卸载时注册了强制落库监听', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(src, /pagehide/, 'app.js 应监听 pagehide（卸载前落库）');
  assert.match(src, /visibilitychange/, 'app.js 应监听 visibilitychange（隐藏前落库）');
  assert.match(src, /flushOnHide/, 'app.js 应定义 flushOnHide 安全网函数');
  // 不应再出现"发射后不管"的裸 afterAction() 调用（至少 afterAction 已被 try/catch 包裹）
  assert.match(src, /async function afterAction/, 'afterAction 应为 async 并 await 落库');
});
