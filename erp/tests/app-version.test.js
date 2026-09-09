/**
 * 应用版本体系 V1.3-x 测试
 * 规则（用户约定）：自 V1.3 起，每次文件更新 / 功能优化在 V1.3- 后递增数字（V1.3-1、V1.3-2 …）。
 * 同步约束：schema.APP_VERSION、系统「我的-关于」渲染、PRD.md、开发计划.md、V3_PRD_开发计划.md 必须一致。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../js/core/schema.js');

const ROOT = path.resolve(__dirname, '../..');

test('schema.APP_VERSION 符合 V1.3-x 版本体系', () => {
  assert.match(schema.APP_VERSION, /^V1\.3-\d+$/, '格式应为 V1.3-N：' + schema.APP_VERSION);
});

test('「我的-关于」模块渲染显示 schema.APP_VERSION', () => {
  const { newCtx } = require('./helpers/ctx.js');
  const mine = require('../js/ui/page-mine.js');
  const ctx = newCtx();
  const html = mine.render(ctx, mine.init(ctx));
  assert.ok(html.includes('版本：' + schema.APP_VERSION), '关于卡片应显示当前 APP_VERSION');
});

test('PRD.md / 开发计划.md / V3_PRD_开发计划.md 版本标注与 APP_VERSION 一致', () => {
  const files = ['PRD.md', '开发计划.md', 'V3_PRD_开发计划.md'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(text.includes(schema.APP_VERSION), f + ' 应包含版本 ' + schema.APP_VERSION);
  }
});
