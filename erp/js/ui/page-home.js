/**
 * ui/page-home.js —— 首页经营看板（PRD 3 / 10.4 / 10.5）
 * 今日概览 + 主按钮 + 快捷入口 + 待办条（超期欠款）+ 未备份提醒条；
 * 桌面端（.desktop-only）加月度卡 + 趋势图 + 畅销 TOP5。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var inventory = isNode ? require('../core/inventory.js') : (ERP.inventory || null);
  var debt = isNode ? require('../core/debt.js') : (ERP.debt || null);
  var profit = isNode ? require('../core/profit.js') : (ERP.profit || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var mod = factory(ERP, util, ui, inventory, debt, profit, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.home = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, inventory, debt, profit, schema) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;
  var D = schema.DOC;

  function todayStr(ctx) {
    return util.today();
  }

  /** 今日销售单（含退货，用于计数与营收） */
  function todaySales(ctx, date) {
    return (ctx.data.sales || []).filter(function (d) {
      return !d.voided && d.date === date;
    });
  }

  function stats(ctx) {
    var today = todayStr(ctx);
    var sales = todaySales(ctx, today);
    var revenue = 0;
    sales.forEach(function (d) {
      if (d.type === D.REFUND) revenue -= (d.payable || 0);
      else revenue += (d.payable || 0);
    });
    var p = profit.summary(ctx, { from: today, to: today });
    var alertCount = inventory.alertStyleCount(ctx);
    return {
      revenue: revenue,
      count: sales.length,
      grossProfit: p.grossProfit,
      alertCount: alertCount
    };
  }

  /** 近 N 个月（含本月）列表 ['YYYY-MM', ...] */
  function lastMonths(n) {
    var out = [];
    var d = new Date(util.today() + 'T00:00:00');
    for (var i = n - 1; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(x.getFullYear() + '-' + util.pad2(x.getMonth() + 1));
    }
    return out;
  }

  /** 缩短金额用于柱顶标注 */
  function shortMoney(fen) {
    if (fen >= 1000000) return (fen / 1000000).toFixed(1) + '万';
    return String(Math.round(fen / 100));
  }

  function backupReminder(ctx) {
    var last = ctx.data.lastBackupAt;
    if (last && util.diffDays(String(last).slice(0, 10), util.today()) === 0) return '';
    var days = last ? util.diffDays(String(last).slice(0, 10), util.today()) : '从未';
    return C.notice(
      '📦 你已 ' + (typeof days === 'number' ? days + ' 天' : days) + '未备份，建议每天导出一份账本（存电脑 + 网盘各一份）',
      'warn',
      { act: 'go', page: 'setting', text: '去备份' }
    );
  }

  function todoBar(ctx) {
    var list = debt.overdue(ctx, ctx.settings.debtOverdueDays || 15);
    if (!list.length) return '';
    var items = list.slice(0, 5).map(function (o) {
      return '<li class="todo-item"><span>🔔 ' + esc(o.partner.name) +
        ' 欠款 ' + C.money(o.balance) + '，已超期 ' + o.days + ' 天</span>' +
        '<button class="btn btn-sm" data-act="go" data-page="account">去收款</button></li>';
    }).join('');
    return '<div class="card todo-card"><h3 class="card-title">待处理事项</h3><ul class="todo-list">' + items + '</ul></div>';
  }

  function desktopExtras(ctx) {
    var months = lastMonths(6);
    var points = months.map(function (m) {
      var range = util.monthRange(m);
      var s = profit.summary(ctx, { from: range.start, to: range.end });
      return { label: m.slice(5) + '月', value: s.revenue, labelValue: shortMoney(s.revenue) };
    });
    var top = profit.topProducts(ctx, { by: 'profit', n: 5 });
    var topRows = top.length ? top.map(function (t, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(t.name || t.styleCode) + '</td>' +
        '<td>' + t.qty + '</td><td>' + C.money(t.grossProfit) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="muted">暂无销售</td></tr>';

    return '<div class="desktop-only">' +
      '<div class="grid grid-3 mb8">' +
      C.stat('本月营收', C.money(profit.summary(ctx, util.monthRange(util.monthOf(util.today()))).revenue), 'primary') +
      C.stat('本月毛利', C.money(profit.summary(ctx, util.monthRange(util.monthOf(util.today()))).grossProfit), 'ok') +
      C.stat('库存资金占用', C.money(profit.stockValue(ctx)), 'warn') +
      '</div>' +
      '<div class="card mb8"><h3 class="card-title">近 6 个月营收趋势</h3>' + C.barChart(points, { color: '#2563eb' }) + '</div>' +
      '<div class="card"><h3 class="card-title">畅销 TOP5（按毛利）</h3>' +
      '<table class="tbl"><thead><tr><th>#</th><th>商品</th><th>销量</th><th>毛利</th></tr></thead><tbody>' +
      topRows + '</tbody></table></div>' +
      '</div>';
  }

  var page = {
    name: 'home',
    title: '首页',
    icon: '📊',

    init: function () {
      return {};
    },

    render: function (ctx, state) {
      var s = stats(ctx);
      var st = '<div class="stat-grid">' +
        C.stat('今日营收', C.money(s.revenue), 'primary') +
        C.stat('今日单数', s.count, '') +
        C.stat('今日毛利', C.money(s.grossProfit), 'ok') +
        C.stat('预警款数', s.alertCount, s.alertCount > 0 ? 'warn' : '') +
        '</div>';

      // 首页显著「开单」按钮——手机/电脑两套布局共用，靠 CSS 调尺寸
      var saleBtn =
        '<button class="home-sale-btn" type="button" data-act="go" data-page="sale" ' +
        'aria-label="开单，前往销售开单页面">' +
        '<span class="ico" aria-hidden="true">🛒</span>' +
        '<span class="t">开单</span>' +
        '<span class="s">扫码 / 选货</span>' +
        '</button>';

      var quick = C.quickGrid([
        { page: 'purchase', icon: '📥', text: '进货' },
        { page: 'product', icon: '📦', text: '商品' },
        { page: 'inventory', icon: '📋', text: '库存' },
        { page: 'account', icon: '💰', text: '记账' },
        { page: 'report', icon: '📈', text: '报表' }
      ]);

      return (
        '<div class="page-head"><h2>👋 ' + esc(ctx.settings.shopName || '我的鞋服店') + '</h2>' +
        '<span class="desc">' + util.today() + '</span></div>' +
        backupReminder(ctx) +
        todoBar(ctx) +
        '<div class="card mb8"><div class="home-top">' + st + saleBtn + '</div></div>' +
        '<div class="card mb8"><h3 class="card-title">快捷入口</h3>' + quick + '</div>' +
        desktopExtras(ctx)
      );
    }
  };

  return page;
});
