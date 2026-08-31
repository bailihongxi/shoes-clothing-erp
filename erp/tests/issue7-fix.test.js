// 问题 7 测试：新增供应商管理页面（入口在「我的 → 常用入口」）
//
// 需求（用户原话）：增加供应商管理页面，入口放常用入口模块。
//
// 实现要点（见 js/ui/page-supplier.js + js/ui/page-mine.js + index.html）：
//   - 列表：名称/电话/备注/应付余额 + 搜索；
//   - 新增/编辑：名称(必填、按名称+类型去重)、电话、备注；
//   - 删除：有未结清余额或已有进货记录则禁止，避免账目断裂；
//   - 付款：跳转记账中心对该供应商付款（复用既有挂账能力）；
//   - 入口：page-mine.js「常用入口」新增供应商磁贴；index.html 注册脚本。
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const debt = require('../js/core/debt.js');
const supplier = require('../js/ui/page-supplier.js');
const mine = require('../js/ui/page-mine.js');

function el(attrs, value) {
  return {
    value: value,
    getAttribute: function (k) {
      return attrs[k] === undefined ? null : attrs[k];
    }
  };
}

/* ---------------- ① 页面注册 ---------------- */

test('问题7-注册：供应商页已注册且字段齐全', () => {
  assert.strictEqual(supplier.name, 'supplier');
  assert.strictEqual(typeof supplier.render, 'function');
  assert.strictEqual(typeof supplier.actions['save-supplier'], 'function');
  assert.strictEqual(typeof supplier.actions['delete-supplier'], 'function');
});

/* ---------------- ② 新增 ---------------- */

test('问题7-新增：open-new → field → save 创建供应商（type=supplier, balance=0）', () => {
  const ctx = newCtx();
  const state = supplier.init(ctx);
  supplier.actions['open-new'](ctx, state);
  assert.strictEqual(state.editing, 'new');
  supplier.actions.field(ctx, state, el({ 'data-name': 'name' }, '温州鞋厂'));
  supplier.actions.field(ctx, state, el({ 'data-name': 'phone' }, '13800000000'));
  const r = supplier.actions['save-supplier'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.data.partners.length, 1);
  const p = ctx.data.partners[0];
  assert.strictEqual(p.type, 'supplier');
  assert.strictEqual(p.name, '温州鞋厂');
  assert.strictEqual(p.balance, 0);
  assert.strictEqual(p.phone, '13800000000');
  assert.strictEqual(state.editing, null, '保存后应退出编辑态');
});

test('问题7-新增：名称为空 → 拒绝创建', () => {
  const ctx = newCtx();
  const state = supplier.init(ctx);
  supplier.actions['open-new'](ctx, state);
  const r = supplier.actions['save-supplier'](ctx, state);
  assert.strictEqual(r, false);
  assert.strictEqual(ctx.data.partners.length, 0);
});

test('问题7-新增：同名供应商去重 → 拒绝', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const state = supplier.init(ctx);
  supplier.actions['open-new'](ctx, state);
  supplier.actions.field(ctx, state, el({ 'data-name': 'name' }, '温州鞋厂'));
  const r = supplier.actions['save-supplier'](ctx, state);
  assert.strictEqual(r, false, '同名应被拒绝');
  assert.strictEqual(ctx.data.partners.length, 1);
});

/* ---------------- ③ 编辑 ---------------- */

test('问题7-编辑：edit-supplier → field → save 改名且不计新增', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const p = ctx.data.partners[0];
  const state = supplier.init(ctx);
  supplier.actions['edit-supplier'](ctx, state, el({ 'data-id': p.id }));
  assert.strictEqual(state.editing, p.id);
  supplier.actions.field(ctx, state, el({ 'data-name': 'name' }, '温州鞋业'));
  const r = supplier.actions['save-supplier'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.data.partners.length, 1, '编辑不应新增记录');
  assert.strictEqual(ctx.data.partners[0].name, '温州鞋业');
});

/* ---------------- ④ 删除（带保护） ---------------- */

test('问题7-删除：有未结清应付余额 → 禁止删除', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const p = ctx.data.partners[0];
  p.balance = 5000;
  ctx.touch('partners', p);
  const state = supplier.init(ctx);
  const r = supplier.actions['delete-supplier'](ctx, state, el({ 'data-id': p.id }));
  assert.strictEqual(r, false);
  assert.strictEqual(ctx.data.partners.length, 1);
});

test('问题7-删除：已有进货记录 → 禁止删除', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const p = ctx.data.partners[0];
  ctx.data.purchases.push({ no: 'P1', partnerName: '温州鞋厂', date: '2026-08-01', voided: false, total: 100 });
  const state = supplier.init(ctx);
  const r = supplier.actions['delete-supplier'](ctx, state, el({ 'data-id': p.id }));
  assert.strictEqual(r, false);
  assert.strictEqual(ctx.data.partners.length, 1);
});

test('问题7-删除：无余额且无数记录 → 成功移除', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const p = ctx.data.partners[0];
  const state = supplier.init(ctx);
  const r = supplier.actions['delete-supplier'](ctx, state, el({ 'data-id': p.id }));
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.data.partners.length, 0);
  assert.strictEqual(ctx.getPartner(p.id), null);
});

/* ---------------- ⑤ 列表 / 搜索 / 入口 ---------------- */

test('问题7-列表：空态提示；有供应商显示名称与应付余额', () => {
  const ctx = newCtx();
  let html = supplier.render(ctx, supplier.init(ctx));
  assert.ok(/还没有供应商/.test(html), '空态应提示');

  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  ctx.data.partners[0].balance = 5000;
  html = supplier.render(ctx, supplier.init(ctx));
  assert.ok(/温州鞋厂/.test(html));
  assert.ok(/我方应付/.test(html), '应展示应付余额标签');
});

test('问题7-搜索：按关键字过滤供应商', () => {
  const ctx = newCtx();
  debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  debt.ensurePartner(ctx, { name: '广州皮具', type: 'supplier' });
  const state = supplier.init(ctx);
  state.keyword = '广州';
  const html = supplier.render(ctx, state);
  assert.ok(/广州皮具/.test(html));
  assert.ok(!/温州鞋厂/.test(html), '不匹配项应被过滤');
});

test('问题7-入口：常用入口含「供应商」可直达', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(/data-page="supplier"/.test(html), '常用入口应含供应商磁贴');
});
