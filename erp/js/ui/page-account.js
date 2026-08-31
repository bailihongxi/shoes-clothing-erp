/**
 * ui/page-account.js —— 记账中心
 * ① 流水查询（日期 / 类型 / 关键字）
 * ② 应付清单 + 付款（供应商）
 * ③ 应收清单 + 收款（客户）+ 欠款超期提醒（>15 天）
 * ④ 手工费用记账（房租/水电/人工/物流/其他）
 * 往来单位余额由单据/收付款「单据是唯一事实来源」驱动；本页只做查询与收付款登记。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.ledger || (isNode ? require('../core/ledger.js') : null),
    E.debt || (isNode ? require('../core/debt.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.account = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, ledger, debt, engine, ERP) {
  'use strict';

  var esc = util.escapeHtml;
  var L = schema.LEDGER;

  function emptyState() {
    return {
      tab: 'flow', // flow | payable | receivable
      from: '',
      to: '',
      type: '',
      keyword: '',
      page: 1,
      viewNo: null,
      settle: null, // {partnerId, isSupplier, name, amount, note, error}
      manualOpen: false,
      manual: { date: util.today(), category: schema.EXPENSE_CATEGORIES[0], direction: 'out', amount: '', note: '' }
    };
  }

  var page = {
    name: 'account',
    title: '记账中心',
    icon: '🧾',

    init: function () {
      return emptyState();
    },

    render: function (ctx, state) {
      var h = pageHead(ctx, state);
      if (state.tab === 'payable') h += renderPayable(ctx, state);
      else if (state.tab === 'receivable') h += renderReceivable(ctx, state);
      else h += renderFlow(ctx, state);
      if (state.viewNo) h += viewModal(ctx, state);
      if (state.settle) h += settleModal(ctx, state);
      return h;
    },

    mount: function (ctx, root, state) {
      // 浏览器内：支持从进货页 deep-link 预选付款 / 收款（?pay=供应商ID / ?collect=客户ID）
      if (typeof location === 'undefined' || !ERP.router || !ERP.router.parse) return;
      var q = ERP.router.parse(location.hash).query || {};
      var payId = q.pay, collId = q.collect;
      if (!payId && !collId) return;
      if (!state.settle) {
        openSettle(ctx, state, payId || collId, !!payId);
        if (ERP.app && ERP.app.render) ERP.app.render();
      }
      if (typeof history !== 'undefined' && history.replaceState) {
        try { history.replaceState(null, '', '#/account'); } catch (e) { /* 忽略 */ }
      }
    },

    actions: {
      'tab': function (ctx, state, el) {
        state.tab = el.getAttribute('data-tab');
        state.page = 1;
        state.viewNo = null;
      },

      'filter': function (ctx, state, el) {
        state[el.getAttribute('data-name')] = el.value;
        state.page = 1;
      },

      'keyword': function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },

      'page': function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'view-doc': function (ctx, state, el) {
        state.viewNo = el.getAttribute('data-no');
      },

      'close-view': function (ctx, state) {
        state.viewNo = null;
      },

      /* 收付款弹窗 */
      'open-settle': function (ctx, state, el) {
        openSettle(ctx, state, el.getAttribute('data-partner'), el.getAttribute('data-supplier') === '1');
      },

      'settle-field': function (ctx, state, el) {
        if (!state.settle) return;
        state.settle[el.getAttribute('data-name')] = el.value;
      },

      'do-settle': function (ctx, state) {
        if (!state.settle) return false;
        var s = state.settle;
        var p = ctx.getPartner(s.partnerId);
        if (!p) { s.error = '往来单位不存在'; return false; }
        var before = p.balance || 0;
        var res = engine.settleAccount(ctx, {
          partnerId: s.partnerId,
          amount: s.amount,
          isSupplier: s.isSupplier,
          note: s.note
        });
        if (!res.ok) { s.error = res.error; return false; }
        ui.toast(
          (s.isSupplier ? '已付 ' : '已收 ') + ui.money(res.settle.paid) +
          (res.settle.overpay ? '（多付 ' + ui.money(res.settle.overpay) + '）' : ''),
          'ok'
        );
        state.settle = null;
        return true;
      },

      'close-settle': function (ctx, state) {
        state.settle = null;
      },

      /* 手工记一笔 */
      'open-manual': function (ctx, state) {
        state.manualOpen = true;
      },

      'close-manual': function (ctx, state) {
        state.manualOpen = false;
      },

      'manual-field': function (ctx, state, el) {
        state.manual[el.getAttribute('data-name')] = el.value;
      },

      'save-manual': function (ctx, state) {
        var m = state.manual;
        var r = ledger.manual(ctx, {
          date: m.date,
          category: m.category,
          direction: m.direction,
          amount: m.amount,
          note: m.note
        });
        if (!r.ok) {
          ui.toast(r.error, 'err');
          return false;
        }
        ui.toast('已记 ' + (m.direction === 'in' ? '收入' : '费用') + ' ' + ui.money(r.rec.amount), 'ok');
        state.manual = { date: util.today(), category: schema.EXPENSE_CATEGORIES[0], direction: 'out', amount: '', note: '' };
        state.manualOpen = false;
        return true;
      }
    }
  };

  /* ---------------- 头部 / 选项卡 ---------------- */

  function pageHead(ctx, state) {
    var totals = debt.totals(ctx);
    return '<div class="page-head"><h2>记账中心</h2>' +
      '<div class="row wrap gap8">' +
      ui.stat('应付合计', ui.money(totals.payable), 'warn') +
      ui.stat('应收合计', ui.money(totals.receivable), 'info') +
      '</div>' +
      '<div class="tabs">' +
      tabBtn('flow', '流水', state) +
      tabBtn('payable', '应付', state) +
      tabBtn('receivable', '应收', state) +
      '</div></div>';
  }

  function tabBtn(tab, text, state) {
    return '<button class="tab' + (state.tab === tab ? ' on' : '') + '" data-act="tab" data-tab="' + tab + '">' + text + '</button>';
  }

  /* ---------------- 流水 ---------------- */

  function renderFlow(ctx, state) {
    var filters = { from: state.from, to: state.to, type: state.type || undefined, keyword: state.keyword };
    var sum = ledger.sum(ctx, { from: state.from, to: state.to });
    var list = ledger.list(ctx, filters);

    var h = '<div class="card">' +
      '<div class="row wrap gap8">' +
      ui.stat('本期收入', ui.money(sum.income), 'info') +
      ui.stat('本期支出', ui.money(sum.expense), 'warn') +
      ui.stat('本期净额', ui.money(sum.net), sum.net >= 0 ? 'ok' : 'danger') +
      '</div></div>';

    h += '<div class="card">' + ui.searchBar({ value: state.keyword, placeholder: '搜索备注 / 往来 / 单号 / 类型' });
    h += '<div class="row wrap">' +
      '<input class="input" type="date" data-change="filter" data-name="from" value="' + esc(state.from) + '">' +
      '<input class="input" type="date" data-change="filter" data-name="to" value="' + esc(state.to) + '">' +
      typeSelect(state.type) +
      '<button class="btn" data-act="open-manual">＋ 记一笔</button>' +
      '</div></div>';

    if (!list.length) {
      h += '<div class="card">' + ui.empty('暂无流水记录') + '</div>';
    } else {
      h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>日期</th><th>类型</th><th class="num">金额</th><th>往来单位</th><th>备注</th><th>单据</th><th></th>' +
        '</tr></thead><tbody>';
      list.forEach(function (r) {
        var inOut = r.direction === 'in';
        h += '<tr>' +
          '<td>' + esc(r.date) + '</td>' +
          '<td>' + ui.badge(labelOf(r.type), inOut ? 'on' : 'off') + '</td>' +
          '<td class="num"><b style="color:' + (inOut ? '#16a34a' : '#dc2626') + '">' +
          (inOut ? '+' : '−') + ui.money(r.amount) + '</b></td>' +
          '<td>' + esc(partnerName(ctx, r.partnerId)) + '</td>' +
          '<td class="weak">' + esc(r.note || '') + '</td>' +
          '<td class="mono small">' + esc(r.refNo || '') + '</td>' +
          '<td class="act">' + (r.refNo ? '<button data-act="view-doc" data-no="' + esc(r.refNo) + '">查看</button>' : '') + '</td>' +
          '</tr>';
      });
      h += '</tbody></table></div></div>';
    }

    if (state.manualOpen) h += renderManual(ctx, state);
    return h;
  }

  function typeSelect(value) {
    var opts = [{ value: '', text: '全部类型' }].concat(
      Object.keys(schema.LEDGER_LABEL).map(function (t) {
        return { value: t, text: schema.LEDGER_LABEL[t] };
      })
    );
    return ui.select({ name: 'type', value: value, on: 'filter', options: opts });
  }

  function renderManual(ctx, state) {
    var m = state.manual;
    var dirOpts = [
      { value: 'out', text: '费用支出' },
      { value: 'in', text: '其他收入' }
    ];
    var catOpts = schema.EXPENSE_CATEGORIES.map(function (c) {
      return { value: c, text: c };
    });
    return '<div class="card"><div class="card-title">记一笔' +
      '<span class="more">房租/水电/人工/物流/其他 + 其他收入</span></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label class="req">日期</label>' +
      '<input class="input" type="date" data-change="manual-field" data-name="date" value="' + esc(m.date) + '"></div>' +
      '<div class="field"><label class="req">方向</label>' +
      ui.select({ name: 'direction', value: m.direction, on: 'manual-field', options: dirOpts }) + '</div>' +
      '</div>' +
      '<div class="field"><label class="req">类别</label>' +
      ui.select({ name: 'category', value: m.category, on: 'manual-field', options: catOpts }) + '</div>' +
      '<div class="field"><label class="req">金额（元）</label>' +
      '<input class="input" data-input="manual-field" data-name="amount" inputmode="decimal" placeholder="0" value="' + esc(m.amount) + '"></div>' +
      '<div class="field"><label>备注</label>' +
      '<input class="input" data-input="manual-field" data-name="note" placeholder="选填" value="' + esc(m.note) + '"></div>' +
      '<div class="row">' +
      '<button class="btn" data-act="close-manual">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="save-manual">保存记账</button>' +
      '</div></div>';
  }

  /* ---------------- 应付（供应商） ---------------- */

  function renderPayable(ctx, state) {
    var list = debt.payables(ctx);
    var h = '<div class="card">' +
      '<div class="row between"><span class="muted">共 ' + list.length + ' 家供应商有未结清货款</span>' +
      '<b style="color:#dc2626">应付合计 ' + ui.money(list.reduce(function (t, p) { return t + (p.balance || 0); }, 0)) + '</b></div></div>';

    if (!list.length) {
      h += '<div class="card">' + ui.empty('供应商货款均已结清 👍') + '</div>';
      return h;
    }
    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>供应商</th><th class="num">应付余额</th><th>最近交易</th><th></th>' +
      '</tr></thead><tbody>';
    list.forEach(function (p) {
      h += '<tr>' +
        '<td>' + esc(p.name) + (p.phone ? '<div class="weak small">' + esc(p.phone) + '</div>' : '') + '</td>' +
        '<td class="num"><b style="color:#dc2626">' + ui.money(p.balance) + '</b></td>' +
        '<td class="small weak">' + esc((p.lastDealAt || '').slice(0, 10)) + '</td>' +
        '<td class="act"><button class="btn btn-sm btn-primary" data-act="open-settle" data-partner="' + esc(p.id) + '" data-supplier="1">付款</button></td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 应收（客户）+ 超期提醒 ---------------- */

  function renderReceivable(ctx, state) {
    var list = debt.receivables(ctx);
    var over = debt.overdue(ctx, ctx.settings.debtOverdueDays || 15);

    var h = '';
    if (over.length) {
      var items = over.map(function (o) {
        return '<button class="btn btn-sm" data-act="open-settle" data-partner="' + esc(o.partner.id) + '">' +
          esc(o.partner.name) + ' 已超 ' + o.days + ' 天 / ' + ui.money(o.balance) + '</button>';
      }).join(' ');
      h += ui.notice('欠款超期提醒（> ' + (ctx.settings.debtOverdueDays || 15) + ' 天）：' + items, 'danger');
    }

    h += '<div class="card">' +
      '<div class="row between"><span class="muted">共 ' + list.length + ' 位客户有挂账</span>' +
      '<b style="color:#dc2626">应收合计 ' + ui.money(list.reduce(function (t, p) { return t + (p.balance || 0); }, 0)) + '</b></div></div>';

    if (!list.length) {
      h += '<div class="card">' + ui.empty('客户挂账均已结清 👍') + '</div>';
      return h;
    }
    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>客户</th><th class="num">应收余额</th><th>最近交易</th><th></th>' +
      '</tr></thead><tbody>';
    list.forEach(function (p) {
      h += '<tr>' +
        '<td>' + esc(p.name) + (p.phone ? '<div class="weak small">' + esc(p.phone) + '</div>' : '') + '</td>' +
        '<td class="num"><b style="color:#dc2626">' + ui.money(p.balance) + '</b></td>' +
        '<td class="small weak">' + esc((p.lastDealAt || '').slice(0, 10)) + '</td>' +
        '<td class="act"><button class="btn btn-sm btn-primary" data-act="open-settle" data-partner="' + esc(p.id) + '">收款</button></td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 弹窗 ---------------- */

  function openSettle(ctx, state, partnerId, isSupplier) {
    var p = ctx.getPartner(partnerId);
    if (!p) return;
    state.settle = {
      partnerId: p.id,
      isSupplier: isSupplier,
      name: p.name,
      amount: util.fenToYuan(p.balance),
      note: '',
      error: ''
    };
  }

  function settleModal(ctx, state) {
    var s = state.settle;
    var p = ctx.getPartner(s.partnerId);
    var bal = p ? p.balance : 0;
    var isSup = s.isSupplier;
    return '<div class="modal-mask" id="settle-mask"><div class="modal"><h3>' +
      (isSup ? '付供应商款' : '收客户款') + ' · ' + esc(s.name) + '</h3>' +
      '<div class="modal-body">' +
      '<div class="field"><label>当前' + (isSup ? '应付' : '应收') + '</label>' +
      '<div class="strong" style="color:#dc2626">' + ui.money(bal) + '</div></div>' +
      '<div class="field"><label class="req">金额（元）</label>' +
      '<input class="input" data-input="settle-field" data-name="amount" inputmode="decimal" placeholder="0" value="' + esc(s.amount) + '"></div>' +
      '<div class="field"><label>备注</label>' +
      '<input class="input" data-input="settle-field" data-name="note" placeholder="选填" value="' + esc(s.note) + '"></div>' +
      (s.error ? '<div class="small" style="color:#dc2626">' + esc(s.error) + '</div>' : '') +
      '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn" data-act="close-settle">取消</button>' +
      '<button class="btn btn-primary" data-act="do-settle">' + (isSup ? '确认付款' : '确认收款') + '</button>' +
      '</div></div></div>';
  }

  function viewModal(ctx, state) {
    // 依据 refNo 关联的流水记录展示详情（单据型）
    var rec = (ctx.data.ledgers || []).find(function (r) {
      return r.refNo === state.viewNo;
    });
    if (!rec) {
      // 也可能是直接查看某单据编号
      var doc = ctx.getDoc('sales', state.viewNo) || ctx.getDoc('purchases', state.viewNo);
      if (!doc) return '<div class="modal-mask" data-act="close-view"><div class="modal"><h3>未找到</h3><div class="modal-actions"><button class="btn" data-act="close-view">关闭</button></div></div></div>';
    }
    var rows = (ctx.data.ledgers || []).filter(function (r) {
      return r.refNo === state.viewNo && !r.voided;
    });
    var body = '<div class="table-wrap"><table class="tbl"><thead><tr><th>日期</th><th>类型</th><th class="num">金额</th><th>备注</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var inOut = r.direction === 'in';
      body += '<tr><td>' + esc(r.date) + '</td><td>' + ui.badge(labelOf(r.type), inOut ? 'on' : 'off') +
        '</td><td class="num"><b style="color:' + (inOut ? '#16a34a' : '#dc2626') + '">' + (inOut ? '+' : '−') + ui.money(r.amount) +
        '</b></td><td class="weak">' + esc(r.note || '') + '</td></tr>';
    });
    body += '</tbody></table></div>';
    return '<div class="modal-mask" data-act="close-view"><div class="modal"><h3>流水明细 · ' + esc(state.viewNo) + '</h3>' +
      '<div class="modal-body">' + (rows.length ? body : ui.empty('该单据暂无关联流水')) + '</div>' +
      '<div class="modal-actions"><button class="btn" data-act="close-view">关闭</button></div></div></div>';
  }

  /* ---------------- 工具 ---------------- */

  function labelOf(type) {
    return schema.LEDGER_LABEL[type] || type || '其他';
  }

  function partnerName(ctx, id) {
    if (!id) return '';
    var p = ctx.getPartner(id);
    return p ? p.name : '';
  }

  return page;
});
