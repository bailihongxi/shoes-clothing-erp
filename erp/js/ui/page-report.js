/**
 * ui/page-report.js —— 报表与利润（PRD 5.7）
 * 三层利润卡 + 自绘 SVG 趋势图 + 畅销/滞销 TOP5 + CSV 导出
 * 所有数字来自 core/profit（单据派生，改进价不影响历史）。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.profit || (isNode ? require('../core/profit.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.report = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, profit, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  function emptyState() {
    return {
      from: '',
      to: '',
      range: 'all', // all | month | custom
      topBy: 'profit',
      page: 1
    };
  }

  var page = {
    name: 'report',
    title: '报表与利润',
    icon: '📈',

    init: function () {
      return emptyState();
    },

    render: function (ctx, state) {
      var range = resolveRange(state);
      var s = profit.summary(ctx, range);
      var months = profit.monthly(ctx, range);

      var h = '<div class="page-head"><h2>报表与利润</h2>' +
        '<div class="row wrap gap8">' +
        ui.stat('销售收入', ui.money(s.revenue), 'info') +
        ui.stat('销售成本', ui.money(s.saleCost), 'warn') +
        '</div></div>';

      h += renderRangeBar(state);

      /* 三层利润卡 */
      h += '<div class="card"><div class="row wrap gap8">' +
        ui.stat('毛利', ui.money(s.grossProfit), 'ok') +
        ui.stat('毛利率', (s.grossMargin * 100).toFixed(1) + '%', 'ok') +
        ui.stat('赠送成本', ui.money(s.giftCost), 'warn') +
        ui.stat('费用支出', ui.money(s.expense), 'warn') +
        ui.stat('净利参考', ui.money(s.netProfit), s.netProfit >= 0 ? 'ok' : 'danger') +
        '</div>' +
        '<div class="row between mt8"><span class="muted small">销量 ' + s.qtySold + ' 件 · 库存资金占用 ' + ui.money(profit.stockValue(ctx)) + '</span>' +
        '<button class="btn btn-sm" data-act="export-csv">导出 CSV</button>' +
        '</div></div>';

      /* 趋势图（自绘 SVG） */
      h += '<div class="card"><div class="card-title">销售趋势（按月）</div>';
      var points = months.map(function (m) {
        return { label: m.month.slice(2), labelValue: util.fenToYuan(m.revenue), value: m.revenue };
      });
      h += ui.barChart(points, { color: '#2563eb' });
      h += '</div>';

      /* 畅销 / 滞销 TOP5 */
      h += renderTop(ctx, state);

      return h;
    },

    actions: {
      'range': function (ctx, state, el) {
        state.range = el.getAttribute('data-range');
        state.from = '';
        state.to = '';
      },
      'filter': function (ctx, state, el) {
        state[el.getAttribute('data-name')] = el.value;
      },
      'top-by': function (ctx, state, el) {
        state.topBy = el.getAttribute('data-by');
      },
      'export-csv': function (ctx, state) {
        if (!ERP.app || !ERP.app.download) return false;
        var csv = profit.buildCSV(ctx, resolveRange(state));
        ERP.app.download('报表_' + (state.range === 'month' ? util.monthOf(util.today()) : '全部') + '.csv', csv, 'text/csv');
        ui.toast('已导出 CSV', 'ok');
        return true;
      }
    }
  };

  function resolveRange(state) {
    if (state.range === 'month') {
      var r = util.monthRange(util.monthOf(util.today()));
      return { from: r.start, to: r.end };
    }
    if (state.range === 'custom') {
      return { from: state.from || undefined, to: state.to || undefined };
    }
    return {};
  }

  function renderRangeBar(state) {
    var ranges = [
      { k: 'all', t: '全部' },
      { k: 'month', t: '本月' },
      { k: 'custom', t: '自定义' }
    ];
    var h = '<div class="card"><div class="tabs">';
    ranges.forEach(function (r) {
      h += '<button class="tab' + (state.range === r.k ? ' on' : '') + '" data-act="range" data-range="' + r.k + '">' + r.t + '</button>';
    });
    h += '</div>';
    if (state.range === 'custom') {
      h += '<div class="row wrap mt8">' +
        '<input class="input" type="date" data-change="filter" data-name="from" value="' + esc(state.from) + '">' +
        '<input class="input" type="date" data-change="filter" data-name="to" value="' + esc(state.to) + '">' +
        '</div>';
    }
    h += '</div>';
    return h;
  }

  function renderTop(ctx, state) {
    var best = profit.topProducts(ctx, { by: state.topBy, order: 'desc', n: 5 });
    var worst = profit.topProducts(ctx, { by: state.topBy, order: 'asc', n: 5 });
    var h = '<div class="card"><div class="card-title">畅销 / 滞销 TOP5' +
      '<span class="more">排序：' +
      '<button class="btn btn-sm' + (state.topBy === 'profit' ? ' on' : '') + '" data-act="top-by" data-by="profit">按毛利</button> ' +
      '<button class="btn btn-sm' + (state.topBy === 'qty' ? ' on' : '') + '" data-act="top-by" data-by="qty">按销量</button>' +
      '</span></div>';
    h += '<div class="grid grid-2">';
    h += topList('🔥 畅销', best, 'ok');
    h += topList('🐢 滞销', worst, 'warn');
    h += '</div></div>';
    return h;
  }

  function topList(title, list, cls) {
    var h = '<div><div class="small strong mb8">' + title + '</div>';
    if (!list.length) {
      h += ui.empty('暂无数据');
    } else {
      h += '<ol class="top-list">';
      list.forEach(function (it) {
        h += '<li><span class="name">' + esc(it.name || it.styleCode) + ' <span class="weak mono small">' + esc(it.styleCode) + '</span></span>' +
          '<span class="val">' + ui.money(it.grossProfit) + ' <span class="weak small">/ ' + it.qty + ' 件</span></span></li>';
      });
      h += '</ol>';
    }
    h += '</div>';
    return h;
  }

  return page;
});
