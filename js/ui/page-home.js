/**
 * ui/page-home.js —— 首页经营看板（v2 薄荷绿 UI 重设计）
 *
 * 设计图1（手机）+ 设计图4（电脑）合并：
 * - 手机端：薄荷绿 banner「我的鞋服店」+「经营概览」大标题 + 醒目「开单」按钮
 *          + 2x2 stat-card（营收/单数/毛利/预警）+ 6 格圆形彩色快捷入口
 * - 电脑端：保持原有 desktop-only 区域（月度营收、6 月趋势、TOP5）
 *          + 升级为 stat-card + 折线图 + 排行榜
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

  function todayStr() {
    return util.today();
  }

  /** 今日销售单（含退货） */
  function todaySales(ctx, date) {
    return (ctx.data.sales || []).filter(function (d) {
      return !d.voided && d.date === date;
    });
  }

  function stats(ctx) {
    var today = todayStr();
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

  /** 计算环比（百分比） */
  function pct(curr, prev) {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round((curr - prev) * 100 / prev);
  }

  /** 昨天的同口径数据 */
  function yesterdayStats(ctx) {
    var y = new Date(todayStr() + 'T00:00:00');
    y.setDate(y.getDate() - 1);
    var ymd = y.getFullYear() + '-' + util.pad2(y.getMonth() + 1) + '-' + util.pad2(y.getDate());
    var sales = (ctx.data.sales || []).filter(function (d) {
      return !d.voided && d.date === ymd;
    });
    var rev = 0;
    sales.forEach(function (d) {
      if (d.type === D.REFUND) rev -= (d.payable || 0);
      else rev += (d.payable || 0);
    });
    var p = profit.summary(ctx, { from: ymd, to: ymd });
    return { revenue: rev, count: sales.length, grossProfit: p.grossProfit };
  }

  /** 把数字格式化为「12,580」千分位形式 */
  function fmtNumber(n) {
    n = Math.round(n || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 缩短金额用于柱顶标注 */
  function shortMoney(fen) {
    if (fen >= 10000) return (fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    return String(Math.round(fen / 100));
  }

  function backupReminder(ctx) {
    var last = ctx.data.lastBackupAt;
    if (last && util.diffDays(String(last).slice(0, 10), todayStr()) === 0) return '';
    var days = last ? util.diffDays(String(last).slice(0, 10), todayStr()) : '从未';
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

  /** v2 共享 stat-card：2x2 + 右侧大「开单」按钮（跨两行，图2 布局）
   * 手机版传 extraCls='mobile-only'（桌面隐藏）；电脑版传 '' 同样显示。
   * 布局：[今日营收][今日单数]  [   ]
   *        [今日毛利][预警款数]  [开单]
   */
  function statOverview(ctx, extraCls) {
    var s = stats(ctx);
    return (
      '<div class="' + (extraCls || '') + ' stat-grid home-stat-2x2">' +
        statCardHtml('今日营收', '¥' + fmtNumber(s.revenue / 100), 'mint', '💰', '') +
        statCardHtml('今日单数', fmtNumber(s.count), 'gray', '📃', '') +
        statCardHtml('今日毛利', '¥' + fmtNumber(s.grossProfit / 100), 'mint', '📈', 'profit') +
        statCardHtml('预警款数', fmtNumber(s.alertCount), 'pink', '⚠️', 'danger') +
        '<button class="home-sale-btn home-sale-row" data-act="go" data-page="sale" aria-label="开单">' +
          '<span class="ico">🛒</span>' +
          '<span class="t">开单</span>' +
          '<span class="s">扫码 / 选货</span>' +
        '</button>' +
      '</div>'
    );
  }

  function mobileStats(ctx) {
    return statOverview(ctx, 'mobile-only');
  }

  function statCardHtml(label, value, iconColor, icon, valueMod) {
    return '<div class="stat-card">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value ' + (valueMod || '') + '">' + value + '</div>' +
    '</div>';
  }

  /** v2 共享 6 格圆形彩色快捷入口（进货/商品/库存/退换/记账/报表） */
  function quickGrid(extraCls) {
    var items = [
      { page: 'purchase',  icon: '🛍️', text: '进货', color: 'c-green' },
      { page: 'product',   icon: '👕', text: '商品', color: 'c-blue' },
      { page: 'inventory', icon: '🗄️', text: '库存', color: 'c-teal' },
      { page: 'exchange',  icon: '🔁', text: '退换', color: 'c-peach' },
      { page: 'account',   icon: '📒', text: '记账', color: 'c-purple' },
      { page: 'report',    icon: '📈', text: '报表', color: 'c-pink' }
    ];
    var h = '<div class="' + (extraCls || '') + ' card"><h3 class="card-title">快捷入口</h3><div class="quick-circles">';
    items.forEach(function (it) {
      h += '<button class="quick-circle ' + it.color + '" data-act="go" data-page="' + esc(it.page) + '">' +
        '<span class="disc">' + it.icon + '</span>' +
        '<span class="text">' + esc(it.text) + '</span>' +
      '</button>';
    });
    h += '</div></div>';
    return h;
  }

  function mobileQuick() {
    return quickGrid('mobile-only');
  }

  /** 手机端首页：banner + 经营概览 + 开单按钮 + stat + 快捷入口
   * 兼容问题9-③：保留 .home-top 容器同时容纳「开单按钮」+「stat-grid」以适配既有断言 */
  function mobileHome(ctx) {
    var today = todayStr();
    var dateObj = new Date(today + 'T00:00:00');
    var cnDate = dateObj.getFullYear() + '年' + (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日';
    var brandLogo = (ctx.settings.avatar) ? ctx.settings.avatar : 'assets/icon-192.png';
    var shopName = ctx.settings.shopName || '我的鞋服店';

    return (
      '<div class="page-banner">' +
        '<div class="banner-title"><img class="banner-logo" src="' + esc(brandLogo) + '" alt="logo">' + esc(shopName) + '</div>' +
        '<div class="banner-sub">已备份 · 今天 09:12</div>' +
        '<button class="banner-action" data-act="go" data-page="setting" aria-label="通知">' +
          '🔔<span class="dot"></span>' +
        '</button>' +
      '</div>' +
      '<div class="home-top">' +
        '<div class="overview-head">' +
          '<div><div class="title">经营概览</div><div class="date">' + cnDate + '</div></div>' +
        '</div>' +
        mobileStats(ctx) +
      '</div>' +
      mobileQuick()
    );
  }

  /** 电脑端首页：与手机版一致的 banner + 经营概览(2x2+开单) + 快捷入口 + 备份提醒，下方保留分析看板 */
  function desktopHome(ctx, rem) {
    var today = todayStr();
    var dateObj = new Date(today + 'T00:00:00');
    var cnDate = dateObj.getFullYear() + '年' + (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日';
    var brandLogo = (ctx.settings.avatar) ? ctx.settings.avatar : 'assets/icon-192.png';
    var shopName = ctx.settings.shopName || '我的鞋服店';

    return (
      '<div class="page-banner">' +
        '<div class="banner-title"><img class="banner-logo" src="' + esc(brandLogo) + '" alt="logo">' + esc(shopName) + '</div>' +
        '<div class="banner-sub">已备份 · 今天 09:12</div>' +
        '<button class="banner-action" data-act="go" data-page="setting" aria-label="通知">' +
          '🔔<span class="dot"></span>' +
        '</button>' +
      '</div>' +
      '<div class="home-top">' +
        '<div class="overview-head">' +
          '<div><div class="title">经营概览</div><div class="date">' + cnDate + '</div></div>' +
        '</div>' +
        statOverview(ctx, '') +
      '</div>' +
      quickGrid('') +
      rem +
      desktopAnalysis(ctx)
    );
  }

  /** 电脑端分析看板：近期销售趋势 + 热销 TOP5 */
  function desktopAnalysis(ctx) {
    return (
      '<div class="grid grid-3" style="margin-top:14px;grid-template-columns:2fr 1fr">' +
        '<div class="card">' +
          '<div class="card-title">近期销售趋势' +
            '<span class="more">' +
              '<button class="chip on" data-act="trend-range" data-range="7" style="margin-left:6px">7天</button>' +
              '<button class="chip" data-act="trend-range" data-range="30" style="margin-left:4px">30天</button>' +
            '</span>' +
          '</div>' +
          renderTrendChart(ctx) +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">热销 TOP5</div>' +
          renderTop5(ctx) +
        '</div>' +
      '</div>'
    );
  }

  /** 电脑端折线图（近 7 天销售额） */
  function renderTrendChart(ctx) {
    var days = 7;
    var today = todayStr();
    var pts = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - i);
      var ymd = d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
      var sales = (ctx.data.sales || []).filter(function (s) { return !s.voided && s.date === ymd && s.type !== D.REFUND; });
      var v = sales.reduce(function (t, s) { return t + (s.payable || 0); }, 0);
      pts.push({ label: util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate()), value: v });
    }
    var max = Math.max.apply(null, pts.map(function (p) { return p.value; }));
    if (!isFinite(max) || max <= 0) max = 1;
    var w = 640, h = 220;
    var padL = 56, padR = 16, padT = 14, padB = 30;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var step = innerW / Math.max(1, pts.length - 1);
    var s = '<svg class="trend-chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">';
    // 网格线
    for (var g = 0; g <= 4; g++) {
      var y = padT + (innerH * g) / 4;
      var val = max - (max * g) / 4;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '" stroke="#f1f5f9" stroke-width="1"/>';
      s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#9ca3af">' +
        (val >= 10000 ? '¥' + (val / 100 / 10000).toFixed(1) + '万' : '¥' + Math.round(val / 100)) + '</text>';
    }
    // 填充区域
    var pathD = '';
    var areaD = '';
    pts.forEach(function (p, i) {
      var x = padL + step * i;
      var y = padT + innerH - (p.value / max) * innerH;
      pathD += (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y + ' ';
      areaD += (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + (padT + innerH) + ' L ' + x + ' ' + y + ' ';
    });
    areaD += 'L ' + (padL + innerW) + ' ' + (padT + innerH) + ' Z';
    s += '<defs><linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#6CC4B0" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#6CC4B0" stop-opacity="0"/>' +
      '</linearGradient></defs>';
    s += '<path d="' + areaD + '" fill="url(#trend-grad)"/>';
    s += '<path d="' + pathD + '" fill="none" stroke="#3FB89B" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    // 数据点
    pts.forEach(function (p, i) {
      var x = padL + step * i;
      var y = padT + innerH - (p.value / max) * innerH;
      s += '<circle cx="' + x + '" cy="' + y + '" r="3.5" fill="#fff" stroke="#3FB89B" stroke-width="2"/>';
      s += '<text x="' + x + '" y="' + (h - 8) + '" text-anchor="middle" font-size="11" fill="#6b7280">' + esc(p.label) + '</text>';
      if (p.value > 0) {
        s += '<text x="' + x + '" y="' + (y - 8) + '" text-anchor="middle" font-size="10" fill="#1f7a68" font-weight="600">' +
          (p.value >= 1000000 ? '¥' + (p.value / 100 / 10000).toFixed(1) + '万' : '¥' + shortMoney(p.value)) + '</text>';
      }
    });
    s += '</svg>';
    return s;
  }

  /** 电脑端热销 TOP5（按毛利） */
  function renderTop5(ctx) {
    var top = profit.topProducts(ctx, { by: 'profit', n: 5 });
    if (!top.length) {
      return '<div class="empty-state"><div class="icon-disc">📦</div><div class="text">暂无销售数据</div></div>';
    }
    var h = '<ul class="rank-list" style="list-style:none;padding:0;margin:0">';
    var emojis = ['👟', '👕', '🧥', '👖', '🧢'];
    top.forEach(function (t, i) {
      h += '<li class="rank-row">' +
        '<div class="rank-num">' + (i + 1) + '</div>' +
        '<div class="rank-thumb">' + (emojis[i] || '📦') + '</div>' +
        '<div class="rank-name">' + esc(t.name || t.styleCode) + '</div>' +
        '<div class="rank-qty">' + t.qty + ' ' + (t.unit || '件') + '</div>' +
        '<div class="rank-money">' + C.money(t.grossProfit || t.revenue || 0) + '</div>' +
      '</li>';
    });
    h += '</ul>';
    return h;
  }

  var page = {
    name: 'home',
    title: '首页',
    icon: '📊',

    init: function () {
      return {};
    },

    actions: {
      'trend-range': function (ctx, state, el) {
        var btn = el.closest('.card-title');
        if (!btn) return;
        btn.querySelectorAll('[data-act="trend-range"]').forEach(function (b) {
          b.classList.toggle('on', b === el);
        });
        // 电脑端 render() 会重渲染，无需状态变更
      }
    },

    render: function (ctx, state) {
      var rem = backupReminder(ctx) + todoBar(ctx);
      // 手机端：banner 置顶，提醒条在其下；桌面端：与手机版一致的 banner + 概览 + 快捷入口 + 提醒条 + 分析看板
      return (
        '<div class="mobile-only">' + mobileHome(ctx) + rem + '</div>' +
        '<div class="desktop-only">' + desktopHome(ctx, rem) + '</div>'
      );
    }
  };

  return page;
});
