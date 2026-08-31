const schema = require('../../js/core/schema.js');
const repo = require('../../js/store/repo.js');

/** 构造一个干净的工作上下文（可传自定义设置） */
function newCtx(settings) {
  const data = schema.emptyData();
  data.settings = schema.mergeSettings(settings || {});
  return repo.createContext(data);
}

module.exports = { newCtx };
