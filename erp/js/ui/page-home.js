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

  /** v2 手机端 stat-card（icon+label+value，营收/单数/毛利/预警） */
  function mobileStats(ctx) {
    var s = stats(ctx);
    return (
      '<div class="mobile-only stat-grid">' +
        statCardHtml('今日营收', '¥' + fmtNumber(s.revenue / 100), 'mint', '🛍️') +
        statCardHtml('今日单数', fmtNumber(s.count), 'gray', '🔔') +
        statCardHtml('今日毛利', '¥' + fmtNumber(s.grossProfit / 100), 'peach', '👕') +
        statCardHtml('预警款数', fmtNumber(s.alertCount), 'pink', '🛒') +
      '</div>'
    );
  }

  function statCardHtml(label, value, iconColor, icon) {
    return '<div class="stat-card">' +
      '<div class="icon ' + (iconColor || 'mint') + '">' + (icon || '📊') + '</div>' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + value + '</div>' +
    '</div>';
  }

  /** v2 手机端 6 格圆形彩色快捷入口（进货/商品/库存/退换/记账/报表） */
  function mobileQuick() {
    var items = [
      { page: 'purchase',  icon: '🛍️', text: '进货', color: 'c-green' },
      { page: 'product',   icon: '👕', text: '商品', color: 'c-blue' },
      { page: 'inventory', icon: '🗄️', text: '库存', color: 'c-teal' },
      { page: 'exchange',  icon: '🔁', text: '退换', color: 'c-peach' },
      { page: 'account',   icon: '📒', text: '记账', color: 'c-purple' },
      { page: 'report',    icon: '📈', text: '报表', color: 'c-pink' }
    ];
    var h = '<div class="mobile-only card"><h3 class="card-title">快捷入口</h3><div class="quick-circles">';
    items.forEach(function (it) {
      h += '<button class="quick-circle ' + it.color + '" data-act="go" data-page="' + esc(it.page) + '">' +
        '<span class="disc">' + it.icon + '</span>' +
        '<span class="text">' + esc(it.text) + '</span>' +
      '</button>';
    });
    h += '</div></div>';
    return h;
  }

  /** 手机端首页：banner + 经营概览 + 开单按钮 + stat + 快捷入口
   * 兼容问题9-③：保留 .home-top 容器同时容纳「开单按钮」+「stat-grid」以适配既有断言 */
  function mobileHome(ctx) {
    var today = todayStr();
    var dateObj = new Date(today + 'T00:00:00');
    var cnDate = dateObj.getFullYear() + '年' + (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日';

    return (
      '<div class="page-banner">' +
        '<div class="banner-title">我的鞋服店</div>' +
        '<div class="banner-sub">已备份 · 今天 09:12</div>' +
        '<button class="banner-action" data-act="go" data-page="setting" aria-label="通知">' +
          '🔔<span class="dot"></span>' +
        '</button>' +
      '</div>' +
      '<div class="home-top">' +
        '<div class="overview-head">' +
          '<div><div class="title">经营概览</div><div class="date">' + cnDate + '</div></div>' +
          '<button class="home-sale-btn" data-act="go" data-page="sale" aria-label="开单">' +
            '<span class="ico">📷</span>' +
            '<span class="t">开单</span>' +
            '<span class="s">扫码/选货</span>' +
          '</button>' +
        '</div>' +
        mobileStats(ctx) +
      '</div>' +
      mobileQuick()
    );
  }

  /** 电脑端首页：经营概览 + 4 stat（含环比）+ 折线图 + TOP5 */
  function desktopHome(ctx) {
    var s = stats(ctx);
    var y = yesterdayStats(ctx);

    var revPct = pct(s.revenue, y.revenue);
    var cntPct = pct(s.count, y.count);
    var profitPct = pct(s.grossProfit, y.grossProfit);
    var alertDelta = s.alertCount - (y.alertCount || 0);

    var deltaHtml = function (pctVal, suffix, flip) {
      var up = pctVal > 0;
      var down = pctVal < 0;
      var cls = up ? 'up' : (down ? 'down' : 'flat');
      var arr = up ? '↑' : (down ? '↓' : '→');
      if (flip) { up = !up; down = !down; }
      var abs = Math.abs(pctVal);
      var display = pctVal === 0 && suffix === 'low' ? '—' : arr + ' ' + abs + '%';
      return '<div class="delta ' + cls + '">' + display + '</div>';
    };

    return (
      '<div class="desktop-only">' +
        '<div class="overview-head">' +
          '<div>' +
            '<div class="title">你好，店主 🌸</div>' +
            '<div class="date">今天是 ' + (function () {
              var d = new Date(todayStr() + 'T00:00:00');
              return (d.getMonth() + 1) + '月' + d.getDate() + '日';
            })() + '</div>' +
          '</div>' +
          '<button class="btn btn-primary btn-lg" style="width:auto;padding:0 22px;min-height:44px" data-act="go" data-page="sale">＋ 开单</button>' +
        '</div>' +

        '<div class="stat-grid">' +
          '<div class="stat-card">' +
            '<div class="icon mint">💴</div>' +
            '<div class="label">今日营收</div>' +
            '<div class="value">¥' + fmtNumber(s.revenue / 100) + '</div>' +
            deltaHtml(revPct) +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="icon blue">📝</div>' +
            '<div class="label">今日单数</div>' +
            '<div class="value">' + fmtNumber(s.count) + '</div>' +
            deltaHtml(cntPct) +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="icon peach">📈</div>' +
            '<div class="label">今日毛利</div>' +
            '<div class="value">¥' + fmtNumber(s.grossProfit / 100) + '</div>' +
            deltaHtml(profitPct) +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="icon pink">⚠️</div>' +
            '<div class="label">预警款数</div>' +
            '<div class="value">' + fmtNumber(s.alertCount) + '</div>' +
            deltaHtml(alertDelta, 'low', true) +
          '</div>' +
        '</div>' +

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
      return (
        backupReminder(ctx) +
        todoBar(ctx) +
        mobileHome(ctx) +
        desktopHome(ctx)
      );
    }
  };

  return page;
});
