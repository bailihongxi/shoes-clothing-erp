const test = require('node:test');
const assert = require('node:assert');
const util = require('../js/core/util.js');

test('金额：元 → 分，字符串与数字都要安全', () => {
  assert.strictEqual(util.parseMoney(129), 12900);
  assert.strictEqual(util.parseMoney('129'), 12900);
  assert.strictEqual(util.parseMoney('129.5'), 12950);
  assert.strictEqual(util.parseMoney('129.05'), 12905);
  assert.strictEqual(util.parseMoney('¥1,299.90'), 129990);
  assert.strictEqual(util.parseMoney(''), 0);
  assert.strictEqual(util.parseMoney(null), 0);
  assert.strictEqual(util.parseMoney('-3.20'), -320);
});

test('金额：分 → 展示串，不出现浮点误差', () => {
  assert.strictEqual(util.fmtMoney(12900), '129.00');
  assert.strictEqual(util.fmtMoney(0), '0.00');
  assert.strictEqual(util.fmtMoney(5), '0.05');
  assert.strictEqual(util.fmtMoney(-12345), '-123.45');
  assert.strictEqual(util.fmtYuan(12900), '¥129.00');
  // 0.1 + 0.2 类误差不应出现
  assert.strictEqual(util.fmtMoney(util.parseMoney('0.1') + util.parseMoney('0.2')), '0.30');
});

test('尺码清洗：小数、斜杠、空格、大小写', () => {
  assert.strictEqual(util.cleanSize('38'), '38');
  assert.strictEqual(util.cleanSize('38.5'), '385');
  assert.strictEqual(util.cleanSize('39/40'), '39-40');
  assert.strictEqual(util.cleanSize(' xl '), 'XL');
  assert.strictEqual(util.cleanSize('M/L'), 'M-L');
  assert.strictEqual(util.cleanSize('38码'), '38');
  assert.strictEqual(util.cleanSize(''), '');
});

test('日期：今天、加减天数、跨月与月份区间', () => {
  assert.strictEqual(util.today(new Date(2026, 7, 31)), '2026-08-31');
  assert.strictEqual(util.addDays('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(util.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(util.diffDays('2026-08-01', '2026-08-31'), 30);
  assert.strictEqual(util.monthOf('2026-08-31'), '2026-08');
  assert.deepStrictEqual(util.monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepStrictEqual(util.monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  const range = util.dateRange('2026-08-30', '2026-09-01');
  assert.deepStrictEqual(range, ['2026-08-30', '2026-08-31', '2026-09-01']);
  assert.strictEqual(util.compactDate('2026-08-31'), '20260831');
  assert.ok(util.isDateStr('2026-08-31'));
  assert.ok(!util.isDateStr('2026/08/31'));
});

test('分页：页码越界要收敛，页数计算正确', () => {
  const list = Array.from({ length: 25 }, (_, i) => i + 1);
  const p1 = util.paginate(list, 1, 10);
  assert.strictEqual(p1.pages, 3);
  assert.deepStrictEqual(p1.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const p9 = util.paginate(list, 99, 10);
  assert.strictEqual(p9.page, 3);
  assert.deepStrictEqual(p9.items, [21, 22, 23, 24, 25]);
  const empty = util.paginate([], 1, 10);
  assert.strictEqual(empty.total, 0);
  assert.strictEqual(empty.pages, 1);
  // 每页 ≤300 条硬约束
  assert.ok(util.paginate(list, 1, 300).size <= 300);
});

test('CSV：带引号/换行/转义的解析与生成', () => {
  const text = '名称,颜色,号码\n小白鞋,"白,米白",38\n"双引号""测试""",黑,39\n';
  const { rows } = util.parseCSV(text);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[0], ['名称', '颜色', '号码']);
  assert.deepStrictEqual(rows[1], ['小白鞋', '白,米白', '38']);
  assert.deepStrictEqual(rows[2], ['双引号"测试"', '黑', '39']);

  const csv = util.toCSV(['名称', '备注'], [['小白鞋', '含,逗号'], ['凉鞋', '换行\n第二行']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"含,逗号"'));
  assert.ok(csv.includes('"换行\n第二行"'));
  const back = util.parseCSV(csv);
  assert.deepStrictEqual(back.rows[2], ['凉鞋', '换行\n第二行']);
});

test('口令：哈希稳定、不同口令不同、校验可用', () => {
  const h1 = util.hashPassword('1234');
  const h2 = util.hashPassword('1234');
  const h3 = util.hashPassword('1235');
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.ok(util.verifyPassword('1234', h1));
  assert.ok(!util.verifyPassword('1235', h1));
  assert.ok(!util.verifyPassword('1234', null));
});

test('排序与分组', () => {
  const list = [{ v: 3 }, { v: 1 }, { v: 2 }];
  assert.deepStrictEqual(util.sortBy(list, (x) => x.v).map((x) => x.v), [1, 2, 3]);
  assert.deepStrictEqual(util.sortBy(list, (x) => x.v, true).map((x) => x.v), [3, 2, 1]);
  const g = util.groupBy(list, (x) => (x.v > 1 ? 'big' : 'small'));
  assert.strictEqual(g.big.length, 2);
  assert.strictEqual(g.small.length, 1);
  assert.strictEqual(util.sum([{ n: 1 }, { n: 2 }], (x) => x.n), 3);
});

test('HTML 转义（页面渲染防串标签）', () => {
  assert.strictEqual(util.escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.strictEqual(util.escapeHtml(null), '');
});
