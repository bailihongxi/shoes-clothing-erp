const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-account.js');
const debt = require('../js/core/debt.js');
const engine = require('../js/core/engine.js');
const ledger = require('../js/core/ledger.js');
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  const coding = require('../js/core/coding.js');
  coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'], costPrice: '50', salePrice: '129' },
    ctx
  );
  const sup = debt.ensurePartner(ctx, { name: '温州鞋厂', type: 'supplier' });
  const cus = debt.ensurePartner(ctx, { name: '张三', type: 'customer' });
  engine.savePurchase(ctx, {
    date: '2026-08-31', partnerId: sup.id,
    items: [{ skuId: 'X0010138', qty: 5, costPrice: '50' }], paid: '100'
  });
  engine.saveSale(ctx, {
    date: '2026-08-31', partnerId: cus.id,
    items: [{ skuId: 'X0010138', qty: 1, price: '129' }],
    payments: [{ method: 'debt', amount: '129' }]
  });
  return { sup, cus };
}

test('页面元数据与初始状态', () => {
  const ctx = newCtx();
  const state = page.init(ctx);
  assert.strictEqual(page.name, 'account');
  assert.strictEqual(state.tab, 'flow');
  assert.strictEqual(state.manualOpen, false);
});

test('流水页渲染：统计 + 流水列表', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = page.init(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('记账中心'));
  assert.ok(html.includes('应付合计'));
  assert.ok(html.includes('应收合计'));
  assert.ok(html.includes('本期净额'));
});

test('应付清单：列出有欠款的供应商 + 付款预填', () => {
  const ctx = newCtx();
  const { sup } = seed(ctx);
  const state = page.init(ctx);
  state.tab = 'payable';
  const html = page.render(ctx, state);
  assert.ok(html.includes('温州鞋厂'), '应付清单应含供应商');
  assert.ok(html.includes('付款'), '应有付款按钮');

  page.actions['open-settle'](ctx, state, { getAttribute: (k) => (k === 'data-partner' ? sup.id : '1') });
  assert.ok(state.settle, '应打开收付款弹窗');
  assert.strictEqual(state.settle.isSupplier, true);
  const modalHtml = page.render(ctx, state);
  assert.ok(modalHtml.includes('确认付款'));
});

test('应收清单：列出有挂账的客户 + 超期提醒横幅', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  const state = page.init(ctx);
  state.tab = 'receivable';
  const html = page.render(ctx, state);
  assert.ok(html.includes('张三'), '应收清单应含客户');
  assert.ok(html.includes('收款'), '应有收款按钮');
  // 刚发生的挂账未超期，不应出现提醒
  assert.ok(!html.includes('欠款超期提醒'), '当日挂账不应超期');
});

test('供应商付款：余额清零 + 生成付款流水', () => {
  const ctx = newCtx();
  const { sup } = seed(ctx);
  const state = page.init(ctx);
  page.actions['open-settle'](ctx, state, { getAttribute: (k) => (k === 'data-partner' ? sup.id : '1') });
  assert.strictEqual(ctx.getPartner(sup.id).balance, 15000);
  const r = page.actions['do-settle'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '应付清零');
  const pay = ledger.list(ctx, { type: 'pay_supplier' });
  assert.strictEqual(pay.length, 1, '生成供应商付款流水');
  assert.strictEqual(state.settle, null, '弹窗关闭');
});

test('客户收款：余额清零 + 生成回款流水', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  const state = page.init(ctx);
  page.actions['open-settle'](ctx, state, { getAttribute: (k) => (k === 'data-partner' ? cus.id : '0') });
  assert.strictEqual(ctx.getPartner(cus.id).balance, 12900);
  const r = page.actions['do-settle'](ctx, state);
  assert.strictEqual(r, true);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0, '应收清零');
  const recv = ledger.list(ctx, { type: 'receive_debt' });
  assert.strictEqual(recv.length, 1, '生成客户回款流水');
});

test('手工记一笔：生成费用流水', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = page.init(ctx);
  page.actions['open-manual'](ctx, state);
  assert.strictEqual(state.manualOpen, true);
  state.manual.amount = '2000';
  state.manual.category = '房租';
  state.manual.direction = 'out';
  const r = page.actions['save-manual'](ctx, state);
  assert.strictEqual(r, true);
  const exp = ledger.list(ctx, { type: 'expense' });
  assert.strictEqual(exp.length, 1);
  assert.strictEqual(exp[0].amount, 200000);
});

test('应收超期提醒：老旧挂账出现横幅', () => {
  const ctx = newCtx();
  seed(ctx);
  const old = debt.ensurePartner(ctx, { name: '老李', type: 'customer' });
  engine.saveSale(ctx, {
    date: '2026-08-01', partnerId: old.id,
    items: [{ skuId: 'X0010138', qty: 1, price: '100' }],
    payments: [{ method: 'debt', amount: '100' }]
  });
  const state = page.init(ctx);
  state.tab = 'receivable';
  const html = page.render(ctx, state);
  assert.ok(html.includes('欠款超期提醒'), '应出现超期提醒横幅');
  assert.ok(html.includes('老李'), '应列出超期客户');
});
