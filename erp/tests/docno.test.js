const test = require('node:test');
const assert = require('node:assert');
const docNo = require('../js/core/docNo.js');

const docs = [
  { no: 'P20260831-001' },
  { no: 'P20260831-002' },
  { no: 'P20260830-005' },
  { no: 'S20260831-001' }
];

test('单号格式：前缀 + 日期 + 3 位流水', () => {
  assert.strictEqual(docNo.next('P', '2026-08-31', []), 'P20260831-001');
  assert.strictEqual(docNo.purchase('2026-08-31', []), 'P20260831-001');
  assert.strictEqual(docNo.sale('2026-08-31', []), 'S20260831-001');
  assert.strictEqual(docNo.stocktake('2026-08-31', []), 'T20260831-001');
});

test('按日递增，且换日重新从 001 开始', () => {
  assert.strictEqual(docNo.purchase('2026-08-31', docs), 'P20260831-003');
  assert.strictEqual(docNo.sale('2026-08-31', docs), 'S20260831-002');
  assert.strictEqual(docNo.purchase('2026-08-30', docs), 'P20260830-006');
  assert.strictEqual(docNo.purchase('2026-09-01', docs), 'P20260901-001');
});

test('单号被占用时顺延，不重复', () => {
  const list = [{ no: 'P20260831-001' }, { no: 'P20260831-002' }, { no: 'P20260831-003' }];
  // 删掉中间一条后重新生成：应顺延到最大流水 +1，而不是复用空档
  const partial = [list[0], list[2]];
  assert.strictEqual(docNo.purchase('2026-08-31', partial), 'P20260831-004');
  const all = list.concat([{ no: 'P20260831-004' }]);
  assert.strictEqual(docNo.purchase('2026-08-31', all), 'P20260831-005');
});

test('999 以上流水不截断（4 位）', () => {
  const list = [{ no: 'P20260831-999' }];
  assert.strictEqual(docNo.purchase('2026-08-31', list), 'P20260831-1000');
});
