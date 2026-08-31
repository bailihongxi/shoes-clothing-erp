// 问题 6 测试：手机端导航与首页精简
//
// 需求（用户原话）：
//   手机首页去掉开单卡片；底部导航只留 首页/库存/我的；其他入口移到「我的」→常用入口。
//
// 实现要点：
//   - js/app.js：navItems() 底部导航收敛为 [home, inventory, mine]，并导出 app.navItems 便于测试；
//   - js/ui/page-home.js：移除「＋ 去开单」大按钮，快捷入口网格去掉开单磁贴（保留进货/商品/库存/记账/报表）；
//   - js/ui/page-mine.js：「常用入口」新增「开单」，收纳开单/进货/商品/库存/记账/报表/设置，保证所有入口仍可触达。
const test = require('node:test');
const assert = require('node:assert');

require('../js/app.js'); // 副作用：设置 globalThis.ERP.app（Node 下不触发 boot）
const app = globalThis.ERP.app;

const { newCtx } = require('./helpers/ctx.js');
const home = require('../js/ui/page-home.js');
const mine = require('../js/ui/page-mine.js');

/* ---------------- ① 底部导航只留 3 个 ---------------- */

test('问题6-导航：底部导航仅含 首页/库存/我的（无开单、无报表）', () => {
  assert.ok(app && app.navItems, 'app.navItems 应导出');
  const names = app.navItems().map((n) => n.name);
  assert.deepStrictEqual(names, ['home', 'inventory', 'mine'], '底部导航应只剩 3 项');
  assert.strictEqual(names.length, 3);
  assert.ok(!names.includes('sale'), '开单不应在底部导航');
  assert.ok(!names.includes('report'), '报表不应在底部导航');
});

/* ---------------- ② 手机首页去掉开单卡片 ---------------- */

test('问题6-首页：不再渲染「去开单」大按钮与开单磁贴', () => {
  const ctx = newCtx();
  const html = home.render(ctx, home.init(ctx));
  assert.ok(!/去开单/.test(html), '首页不应再有「去开单」大按钮');
  assert.ok(!/data-page="sale"/.test(html), '首页快捷入口不应含开单磁贴');
  // 其余常用入口仍在首页快捷入口
  assert.ok(/快捷入口/.test(html), '快捷入口区块应保留');
  assert.ok(/进货/.test(html) && /报表/.test(html), '进货/报表等快捷入口仍在');
});

/* ---------------- ③ 开单等入口在「我的→常用入口」可触达 ---------------- */

test('问题6-常用入口：开单已移入，且各入口仍可一键直达', () => {
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(/常用入口/.test(html), '应有常用入口区块');
  // 开单已移至常用入口
  assert.ok(/data-page="sale"/.test(html), '常用入口应包含开单（原底部导航项）');
  // 其余入口全部收纳，保证无入口丢失
  ['sale', 'purchase', 'product', 'inventory', 'account', 'report', 'setting'].forEach((p) => {
    assert.ok(new RegExp('data-page="' + p + '"').test(html), '常用入口应含 ' + p);
  });
});
