const test = require('node:test');
const assert = require('node:assert');
const coding = require('../js/core/coding.js');
const { newCtx } = require('./helpers/ctx.js');

/* PRD 10.0 —— 编码自动生成 9 条验收 */

test('10.0-① 只填 名称/类别/颜色/号码 → 自动生成 款号 X001 / SKU id X0010138 / 条码 X001', () => {
  const ctx = newCtx();
  const res = coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] },
    ctx
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.styleCode, 'X001');
  assert.strictEqual(res.skus.length, 1);
  assert.strictEqual(res.skus[0].id, 'X0010138');
  assert.strictEqual(res.skus[0].barcode, 'X001');
  assert.strictEqual(ctx.data.products[0].barcode, 'X001');
  assert.strictEqual(ctx.data.products[0].barcodeSource, 'system');
  assert.ok(ctx.data.products[0].barcodeAt);
});

test('10.0-① 保存前实时预览：preview 不落库、给出将生成的款号与 id', () => {
  const ctx = newCtx();
  const pv = coding.preview(
    { name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] },
    ctx
  );
  assert.strictEqual(pv.ok, true);
  assert.strictEqual(pv.styleCode, 'X001');
  assert.strictEqual(pv.rows[0].skuId, 'X0010138');
  assert.strictEqual(pv.rows[0].barcode, 'X001');
  // 预览不能产生任何数据
  assert.strictEqual(ctx.data.products.length, 0);
  assert.strictEqual(ctx.data.skus.length, 0);
});

test('10.0-② 同款 白/39 → 款号仍 X001、id X0010139、条码仍 X001（不新开款）', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['39'] }, ctx);
  assert.strictEqual(res.styleCode, 'X001');
  assert.strictEqual(res.isNewStyle, false);
  assert.strictEqual(res.skus[0].id, 'X0010139');
  assert.strictEqual(res.skus[0].barcode, 'X001');
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.skus.length, 2);
});

test('10.0-③ 同款 黑/38 → 颜色序号自动编为 02 → id X0010238，条码仍 X001', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['黑'], sizes: ['38'] }, ctx);
  assert.strictEqual(res.styleCode, 'X001');
  assert.strictEqual(res.skus[0].colorSeq, 2);
  assert.strictEqual(res.skus[0].id, 'X0010238');
  assert.strictEqual(res.skus[0].barcode, 'X001');
});

test('10.0-③ 同色复用色序：黑/39 仍是 02', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38'] }, ctx);
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['黑'], sizes: ['39'] }, ctx);
  assert.strictEqual(res.skus[0].id, 'X0010239');
});

test('10.0-④ 不同款（名称不同）→ 款号顺延 X002；流水按类别各自计数，服装 = F001', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const r2 = coding.create({ name: '老爹鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(r2.styleCode, 'X002');
  const r3 = coding.create({ name: '纯棉T恤', category: '服装', colors: ['白'], sizes: ['M'] }, ctx);
  assert.strictEqual(r3.styleCode, 'F001');
  assert.strictEqual(r3.skus[0].id, 'F00101M');
  const r4 = coding.create({ name: '牛仔裤', category: '裤', colors: ['蓝'], sizes: ['30'] }, ctx);
  assert.strictEqual(r4.styleCode, 'K001');
});

test('10.0-④ 类别前缀可在设置里自定义', () => {
  const ctx = newCtx({ categoryPrefix: { 鞋: 'S' } });
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(res.styleCode, 'S001');
  assert.strictEqual(res.skus[0].id, 'S0010138');
});

test('10.0-⑤ 尺码含小数或斜杠 → 清洗为 385 / 39-40，不产生非法字符', () => {
  const ctx = newCtx();
  const res = coding.create(
    { name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38.5', '39/40', ' XL '] },
    ctx
  );
  const ids = res.skus.map((s) => s.id);
  assert.ok(ids.includes('X00101385'), ids.join(','));
  assert.ok(ids.includes('X0010139-40'), ids.join(','));
  assert.ok(ids.includes('X00101XL'), ids.join(','));
  ids.forEach((id) => {
    assert.ok(/^[A-Z0-9\-]+$/.test(id), id + ' 含非法字符');
  });
});

test('10.0-⑥ 同款重复建「白/38」→ 拦截不重复生成，并指出已存在的 id', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.duplicates.length, 1);
  assert.strictEqual(res.duplicates[0].skuId, 'X0010138');
  assert.strictEqual(ctx.data.skus.length, 1);

  const pv = coding.preview({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(pv.duplicateCount, 1);
  assert.ok(pv.warnings.join('').includes('X0010138'));
});

test('10.0-⑦ 款号手动改为 X100 → 该款全部 SKU 的 id 与条码同步更新，并提示需重新打印标签', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白', '黑'], sizes: ['38', '39'] }, ctx);
  const r = coding.renameStyleCode('X001', 'X100', ctx);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.updatedSkus, 4);
  assert.strictEqual(r.needReprint, true);
  assert.ok(r.warning.includes('重新打印标签'));

  const ids = ctx.data.skus.map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['X1000138', 'X1000139', 'X1000238', 'X1000239'].sort());
  ctx.data.skus.forEach((s) => {
    assert.strictEqual(s.styleCode, 'X100');
    assert.strictEqual(s.barcode, 'X100');
  });
  assert.strictEqual(ctx.data.products[0].styleCode, 'X100');
  assert.strictEqual(ctx.data.products[0].barcode, 'X100');
});

test('10.0-⑦ 改款号后历史单据的 skuId / styleCode 引用同步，避免断链', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  ctx.data.sales.push({
    no: 'S1',
    date: '2026-08-31',
    type: 'sale',
    items: [{ skuId: 'X0010138', styleCode: 'X001', qty: 1 }]
  });
  ctx.data.stockLogs.push({ id: 'L1', skuId: 'X0010138', styleCode: 'X001', delta: -1 });

  coding.renameStyleCode('X001', 'X100', ctx);
  assert.strictEqual(ctx.data.sales[0].items[0].skuId, 'X1000138');
  assert.strictEqual(ctx.data.sales[0].items[0].styleCode, 'X100');
  assert.strictEqual(ctx.data.stockLogs[0].skuId, 'X1000138');
});

test('10.0-⑦ 新款式号冲突/非法要报错，不产生脏数据', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  coding.create({ name: '老爹鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(coding.renameStyleCode('X001', 'X002', ctx).ok, false);
  assert.strictEqual(coding.renameStyleCode('X001', '', ctx).ok, false);
  assert.strictEqual(coding.renameStyleCode('X001', 'X#001', ctx).ok, false);
  assert.strictEqual(coding.renameStyleCode('X999', 'X100', ctx).ok, false);
  assert.strictEqual(ctx.data.products.length, 2);
});

test('10.0-⑧ 一次勾选 2 色 × 3 码 → 一次生成 6 个 SKU，款号相同、6 个不同 id、共用同一条码', () => {
  const ctx = newCtx();
  const res = coding.create(
    {
      name: '小白鞋',
      category: '鞋',
      colors: ['白', '黑'],
      sizes: ['38', '39', '40'],
      costPrice: '50',
      salePrice: '129'
    },
    ctx
  );
  assert.strictEqual(res.created, 6);
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(new Set(res.skus.map((s) => s.id)).size, 6);
  res.skus.forEach((s) => {
    assert.strictEqual(s.styleCode, 'X001');
    assert.strictEqual(s.barcode, 'X001', '同款必须共用一条码');
  });
  assert.strictEqual(ctx.data.products[0].costPrice, 5000);
  assert.strictEqual(ctx.data.products[0].salePrice, 12900);
});

test('10.0-⑨ 打开「一码一色码」开关 → 条码内容切换为 SKU id', () => {
  const ctx = newCtx({ oneCodePerSku: true });
  const res = coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38', '39'] }, ctx);
  assert.strictEqual(res.skus[0].barcode, 'X0010138');
  assert.strictEqual(res.skus[1].barcode, 'X0010139');
  assert.strictEqual(new Set(res.skus.map((s) => s.barcode)).size, 2);
});

/* 其他编码规则 */

test('必填校验：缺名称/类别/颜色/号码时不建档并给出明确错误', () => {
  const ctx = newCtx();
  let r = coding.create({ name: '', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.join().includes('名称'));
  r = coding.create({ name: 'A', category: '', colors: ['白'], sizes: ['38'] }, ctx);
  assert.strictEqual(r.ok, false);
  r = coding.create({ name: 'A', category: '鞋', colors: [], sizes: ['38'] }, ctx);
  assert.strictEqual(r.ok, false);
  r = coding.create({ name: 'A', category: '鞋', colors: ['白'], sizes: [] }, ctx);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(ctx.data.products.length, 0);
});

test('同名不同类别 → 视为不同款，各自计数', () => {
  const ctx = newCtx();
  const a = coding.create({ name: '帆布鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const b = coding.create({ name: '帆布鞋', category: '服装', colors: ['白'], sizes: ['38'] }, ctx);
  assert.notStrictEqual(a.styleCode, b.styleCode);
  assert.strictEqual(a.styleCode, 'X001');
  assert.strictEqual(b.styleCode, 'F001');
});

test('同名同类（名字大小写/空格差异）→ 仍判为同款', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const res = coding.create({ name: ' 小白鞋 ', category: '鞋', colors: ['白'], sizes: ['39'] }, ctx);
  assert.strictEqual(res.isNewStyle, false);
  assert.strictEqual(res.styleCode, 'X001');
});

test('款号冲突顺延：手工指定已占用的款号不再新建重复款', () => {
  const ctx = newCtx();
  coding.create({ name: 'A', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const res = coding.create(
    { name: 'B', category: '鞋', colors: ['白'], sizes: ['38'], styleCode: 'X001' },
    ctx
  );
  // 指定款号已存在 → 复用该款并追加该色码（不产生第二个 X001 款）
  assert.strictEqual(res.styleCode, 'X001');
  assert.strictEqual(ctx.data.products.length, 1);
});

test('10.6-① 条码唯一性：录两个相同条码 → 第二条被拦截并指出占用款号', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  coding.create({ name: '老爹鞋', category: '鞋', colors: ['黑'], sizes: ['38'] }, ctx);

  assert.ok(coding.barcodeOwner('X001', ctx, 'X002'), 'X001 应被 X001 款占用');
  const r = coding.setSupplierBarcode('X002', 'X001', ctx);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('X001'), r.error);

  const ok = coding.setSupplierBarcode('X002', '6901234567890', ctx);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ctx.data.products[1].barcodeSource, 'supplier');
  assert.strictEqual(ctx.data.products[1].barcode, '6901234567890');
  ctx.data.skus.filter((s) => s.styleCode === 'X002').forEach((s) => {
    assert.strictEqual(s.barcode, '6901234567890');
  });
});

test('系统生成的条码写入档案时标记来源=系统生成 + 生成时间', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const p = ctx.data.products[0];
  assert.strictEqual(p.barcodeSource, 'system');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(p.barcodeAt));
});

test('CSV 批量导入：表头映射、多色多码拆分、错误行定位', () => {
  const ctx = newCtx();
  const rows = [
    ['名称', '类别', '颜色', '号码', '进价', '售价'],
    ['小白鞋', '鞋', '白、黑', '38,39', '50', '129'],
    ['纯棉T恤', '服装', '白', 'M/L', '30', '79'],
    ['', '鞋', '白', '38', '10', '20']
  ];
  const res = coding.importFromRows(rows, ctx);
  assert.strictEqual(res.created, 2);
  assert.strictEqual(res.skus, 5); // 2色×2码 + 1色×1码（M/L 是一个尺码 → M-L）
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].row, 4);
  assert.ok(res.errors[0].msg.includes('名称'));

  const ids = ctx.data.skus.map((s) => s.id);
  assert.ok(ids.includes('X0010138'));
  assert.ok(ids.includes('X0010239'));
  assert.ok(ids.includes('F00101M-L'));
  assert.strictEqual(ctx.data.products[0].costPrice, 5000);
});

test('CSV 导入：缺「名称」列直接报错，不产生任何数据', () => {
  const ctx = newCtx();
  const res = coding.importFromRows([['类别', '颜色'], ['鞋', '白']], ctx);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(ctx.data.products.length, 0);
});

test('CSV 导入：带条码列会绑定为供应商吊牌码并做唯一性校验', () => {
  const ctx = newCtx();
  const rows = [
    ['名称', '类别', '颜色', '号码', '条码'],
    ['小白鞋', '鞋', '白', '38', '6900001'],
    ['老爹鞋', '鞋', '黑', '38', '6900001']
  ];
  const res = coding.importFromRows(rows, ctx);
  assert.strictEqual(res.created, 2);
  assert.strictEqual(res.errors.length, 1);
  assert.ok(res.errors[0].msg.includes('占用'));
  assert.strictEqual(ctx.data.products[0].barcode, '6900001');
  assert.strictEqual(ctx.data.products[1].barcode, 'X002');
});

test('建档会标记脏数据以便落库', () => {
  const ctx = newCtx();
  coding.create({ name: '小白鞋', category: '鞋', colors: ['白'], sizes: ['38'] }, ctx);
  const dirty = ctx.takeDirty();
  assert.ok(dirty.products && dirty.products.length === 1);
  assert.ok(dirty.skus && dirty.skus.length === 1);
});
