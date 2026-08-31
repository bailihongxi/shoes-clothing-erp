/**
 * ui/page-mine.js —— 我的（店铺信息 + 常用入口 + 关于）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var mod = factory(ERP, util, ui, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.mine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  var page = {
    name: 'mine',
    title: '我的',
    icon: '👤',

    init: function () {
      return {};
    },

    render: function (ctx, state) {
      var s = ctx.settings;
      var info =
        '<div class="card mb8"><div class="row" style="align-items:center;gap:12px">' +
        '<div class="avatar">👟</div>' +
        '<div><div class="strong">' + esc(s.shopName || '我的鞋服店') + '</div>' +
        '<div class="muted small">鞋服进销存记账 · 本地离线可用</div></div>' +
        '</div></div>';

      var links = C.quickGrid([
        { page: 'setting', icon: '⚙️', text: '设置' },
        { page: 'account', icon: '💰', text: '记账中心' },
        { page: 'report', icon: '📈', text: '报表' },
        { page: 'inventory', icon: '📋', text: '库存' },
        { page: 'purchase', icon: '📥', text: '进货' },
        { page: 'product', icon: '📦', text: '商品' }
      ]);

      var about =
        '<div class="card"><h3 class="card-title">关于</h3>' +
        '<ul class="about-list">' +
        '<li>版本：v1.0（schema v' + schema.VERSION + '）</li>' +
        '<li>部署：电脑双击 index.html 即可用；手机端经 https 托管可启用实时扫码与蓝牙打印</li>' +
        '<li>数据：全部保存在本机浏览器（IndexedDB），请勿清除浏览器数据</li>' +
        '<li>备份纪律：每天导出一份账本，电脑 + 网盘各存一份</li>' +
        '</ul></div>';

      return (
        '<div class="page-head"><h2>我的</h2></div>' +
        info +
        '<div class="card mb8"><h3 class="card-title">常用入口</h3>' + links + '</div>' +
        about
      );
    }
  };

  return page;
});
