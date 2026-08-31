/**
 * ui/page-supplier.js —— 供应商管理（问题7）
 *
 * 把「供应商」从「进货时的即时新建」升级为可独立管理：
 *   - 列表：名称 / 电话 / 备注 / 应付余额，支持搜索；
 *   - 新增 / 编辑：名称（必填、按名称+类型去重）、电话、备注；
 *   - 删除：有未结清往来余额或已有进货记录的供应商禁止删除，避免账目断裂；
 *   - 付款：跳转记账中心对该供应商付款（既有挂账能力复用）。
 * 入口放在「我的 → 常用入口」（见 page-mine.js）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var debt = isNode ? require('../core/debt.js') : (ERP.debt || null);
  var repo = isNode ? require('../store/repo.js') : (ERP.repo || null);
  var mod = factory(ERP, util, ui, debt, repo);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.supplier = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, debt, repo) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  function emptyForm() {
    return { id: '', name: '', phone: '', note: '' };
  }

  /** 应付余额文案：>0 我方应付；<0 我方多付；=0 已结清 */
  function balanceLabel(fen) {
    var v = fen || 0;
    if (v > 0) return { cls: 'warn', text: '我方应付 ' + C.money(v) };
    if (v < 0) return { cls: 'ok', text: '我方多付 ' + C.money(-v) };
    return { cls: '', text: '已结清' };
  }

  function hasPurchase(ctx, name) {
    return (ctx.data.purchases || []).some(function (d) {
      return d.partnerName === name && !d.voided;
    });
  }

  var page = {
    name: 'supplier',
    title: '供应商',
    icon: '🏭',

    init: function () {
      return { keyword: '', editing: null, form: emptyForm(), error: '' };
    },

    actions: {
      'open-new': function (ctx, state) {
        state.editing = 'new';
        state.form = emptyForm();
        state.error = '';
        return true;
      },

      'field': function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (!name) return;
        state.form[name] = el.value;
      },

      'edit-supplier': function (ctx, state, el) {
        var p = ctx.getPartner(el.getAttribute('data-id'));
        if (!p) return false;
        state.editing = p.id;
        state.form = { id: p.id, name: p.name || '', phone: p.phone || '', note: p.note || '' };
        state.error = '';
        return true;
      },

      'cancel-form': function (ctx, state) {
        state.editing = null;
        state.form = emptyForm();
        state.error = '';
        return true;
      },

      'save-supplier': function (ctx, state) {
        var name = util.cleanText(state.form.name);
        if (!name) {
          state.error = '请填写供应商名称';
          ui.toast('请填写供应商名称', 'err');
          return false;
        }
        var dup = (ctx.data.partners || []).find(function (p) {
          return p.type === 'supplier' &&
            util.cleanText(p.name).toUpperCase() === name.toUpperCase() &&
            p.id !== state.form.id;
        });
        if (state.form.id) {
          var p = ctx.getPartner(state.form.id);
          if (!p) return false;
          p.name = name;
          p.phone = util.cleanText(state.form.phone);
          p.note = util.cleanText(state.form.note || '');
          ctx.touch('partners', p);
          repo.log(ctx, '编辑供应商', name);
          state.editing = null;
          ui.toast('已保存供应商：' + name, 'ok');
          return true;
        }
        if (dup) {
          state.error = '已存在同名供应商：' + name;
          ui.toast('已存在同名供应商：' + name, 'err');
          return false;
        }
        var partner = {
          id: util.uuid('sup'),
          name: name,
          phone: util.cleanText(state.form.phone),
          type: 'supplier',
          balance: 0,
          lastDealAt: null,
          createdAt: util.nowISO(),
          note: util.cleanText(state.form.note || '')
        };
        ctx.data.partners = ctx.data.partners || [];
        ctx.data.partners.push(partner);
        ctx.touch('partners', partner);
        repo.log(ctx, '新增供应商', name);
        state.editing = null;
        ui.toast('已新增供应商：' + name, 'ok');
        return true;
      },

      'delete-supplier': function (ctx, state, el) {
        var p = ctx.getPartner(el.getAttribute('data-id'));
        if (!p) return false;
        if ((p.balance || 0) !== 0) {
          ui.toast('该供应商还有往来余额（' + C.money(p.balance) + '），请先结清再删除', 'err');
          return false;
        }
        if (hasPurchase(ctx, p.name)) {
          ui.toast('该供应商已有进货记录，无法删除', 'err');
          return false;
        }
        ctx.data.partners = (ctx.data.partners || []).filter(function (x) {
          return x.id !== p.id;
        });
        // 真正从本地库删除（浏览器有 db；Node 测试无 db，仅内存移除）
        var appRef = ERP.app;
        if (appRef && appRef.db && appRef.db.del) {
          try { appRef.db.del('partners', p.id); } catch (e) { /* 忽略 */ }
        }
        repo.log(ctx, '删除供应商', p.name);
        ui.toast('已删除供应商：' + p.name, 'ok');
        return true;
      },

      /** 付款：跳转记账中心对该供应商付款（复用既有挂账能力） */
      'pay': function () {
        var appRef = ERP.app;
        if (appRef && appRef.go) appRef.go('account');
        return false;
      }
    },

    render: function (ctx, state) {
      if (state.editing) return renderForm(state);
      return renderList(ctx, state);
    }
  };

  function renderList(ctx, state) {
    var list = debt.list(ctx, 'supplier');
    var kw = (state.keyword || '').trim().toUpperCase();
    if (kw) {
      list = list.filter(function (p) {
        return (p.name || '').toUpperCase().indexOf(kw) >= 0 ||
          (p.phone || '').toUpperCase().indexOf(kw) >= 0;
      });
    }

    var rows = list.length ? list.map(function (p) {
      var b = balanceLabel(p.balance);
      return '<div class="card mb8 supplier-row">' +
        '<div class="row" style="align-items:flex-start;gap:10px">' +
        '<div class="grow">' +
        '<div class="strong">' + esc(p.name) + '</div>' +
        (p.phone ? '<div class="small muted">📞 ' + esc(p.phone) + '</div>' : '') +
        (p.note ? '<div class="small weak">' + esc(p.note) + '</div>' : '') +
        '</div>' +
        '<div class="col" style="text-align:right;gap:2px">' +
        '<span class="tag ' + (b.cls || '') + '">' + b.text + '</span>' +
        '</div>' +
        '</div>' +
        '<div class="row mt8" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-act="pay">付款</button>' +
        '<button class="btn btn-sm" data-act="edit-supplier" data-id="' + esc(p.id) + '">编辑</button>' +
        '<button class="btn btn-sm btn-danger" data-act="delete-supplier" data-id="' + esc(p.id) + '">删除</button>' +
        '</div>' +
        '</div>';
    }).join('') : '<div class="card muted small">还没有供应商，点下方「＋ 新增供应商」添加。</div>';

    return (
      '<div class="page-head"><h2>供应商</h2>' +
      '<button class="btn btn-primary btn-sm" data-act="open-new">＋ 新增供应商</button></div>' +
      C.searchBar({ value: state.keyword, placeholder: '搜索供应商名称 / 电话', scan: false }) +
      '<div class="mt8">' + rows + '</div>'
    );
  }

  function renderForm(state) {
    var f = state.form;
    var err = state.error ? '<div class="notice notice-danger mt8">' + esc(state.error) + '</div>' : '';
    return (
      '<div class="page-head"><h2>' + (f.id ? '编辑供应商' : '新增供应商') + '</h2></div>' +
      '<div class="card mb8">' +
      '<div class="field"><label class="req">名称</label>' +
      '<input class="input" data-input="field" data-name="name" placeholder="如：温州鞋厂" value="' + esc(f.name) + '"></div>' +
      '<div class="field"><label>电话</label>' +
      '<input class="input" data-input="field" data-name="phone" placeholder="选填" value="' + esc(f.phone) + '"></div>' +
      '<div class="field"><label>备注</label>' +
      '<textarea class="input" data-input="field" data-name="note" placeholder="选填，如：主营运动鞋">' + esc(f.note) + '</textarea></div>' +
      err +
      '<div class="row mt8" style="gap:8px">' +
      '<button class="btn btn-primary" data-act="save-supplier">保存</button>' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '</div></div>'
    );
  }

  /** 导出测试/复用辅助 */
  page.emptyForm = emptyForm;
  page.balanceLabel = balanceLabel;
  page.hasPurchase = hasPurchase;

  return page;
});
