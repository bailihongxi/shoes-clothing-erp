/**
 * ui/page-sale.js —— 销售开单（搜索选品 → 色码矩阵 → 数量）、单行改价、
 * 整单折扣、组合收款（微信/现金/支付宝/欠款）、赠送、退货红冲、销售记录。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.inventory || (isNode ? require('../core/inventory.js') : null),
    E.cart || (isNode ? require('../core/cart.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E.debt || (isNode ? require('../core/debt.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.sale = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, inv, cart, engine, debt, repo, ERP) {
  'use strict';

  var esc = util.escapeHtml;
  var PAY = schema.PAY_METHODS;

  function emptyForm() {
    return {
      keyword: '',
      styleCode: '',
      items: [],
      discount: '',
      pay: { wechat: '', cash: '', alipay: '' },
      useDebt: false,
      customerId: '',
      newCustomer: '',
      note: ''
    };
  }

  var page = {
    name: 'sale',
    title: '销售开单',
    icon: '🛒',

    init: function () {
      var form = emptyForm();
      // 来自「商品卡 / 扫码」的跨页预选款号
      if (ERP && ERP.pendingSaleStyle) {
        form.styleCode = ERP.pendingSaleStyle;
        ERP.pendingSaleStyle = null;
      }
      return {
        tab: 'new',
        form: form,
        from: '',
        to: '',
        typeFilter: 'all',
        keyword: '',
        page: 1,
        viewNo: null,
        refundNo: null
      };
    },

    render: function (ctx, state) {
      if (state.tab === 'list') return renderList(ctx, state);
      return renderNew(ctx, state);
    },

    /* ---------------- 动作 ---------------- */

    actions: {
      'open-new': function (ctx, state) {
        state.tab = 'new';
        state.form = emptyForm();
      },
      'open-list': function (ctx, state) {
        state.tab = 'list';
      },
      'cancel-form': function (ctx, state) {
        state.tab = 'list';
        state.form = emptyForm();
      },

      /* 搜索选品 */
      field: function (ctx, state, el) {
        var n = el.getAttribute('data-name');
        if (n === 'pay.wechat' || n === 'pay.cash' || n === 'pay.alipay') {
          state.form.pay[n.split('.')[1]] = el.value;
        } else {
          state.form[n] = el.value;
        }
      },
      keyword: function (ctx, state, el) {
        state.form.keyword = el.value;
      },
      'pick-style': function (ctx, state, el) {
        state.form.styleCode = el.getAttribute('data-code');
      },
      'clear-pick': function (ctx, state) {
        state.form.styleCode = '';
      },

      /* 点矩阵格子 → 加入销售单 */
      'add-sale': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        addItem(ctx, state, skuId);
      },

      'cart-qty': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var it = findItem(state, skuId);
        if (!it) return;
        var v = parseInt(el.value, 10);
        it.qty = isNaN(v) || v < 1 ? 1 : v;
      },
      'cart-price': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var it = findItem(state, skuId);
        if (!it) return;
        it.price = util.parseMoney(el.value);
      },
      'toggle-gift': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var it = findItem(state, skuId);
        if (!it) return;
        it.type = it.type === schema.DOC.GIFT ? schema.DOC.SALE : schema.DOC.GIFT;
        if (it.type === schema.DOC.GIFT) {
          it.price = 0;
          it.giftReason = schema.GIFT_REASONS[0];
        } else {
          var sku = ctx.getSku(skuId);
          it.price = sku ? inv.salePriceOf(ctx, sku) : 0;
        }
      },
      'gift-reason': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var it = findItem(state, skuId);
        if (it) it.giftReason = el.value;
      },
      'del-item': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        state.form.items = state.form.items.filter(function (x) {
          return x.skuId !== skuId;
        });
      },
      'clear-items': function (ctx, state) {
        state.form.items = [];
      },

      'toggle-debt': function (ctx, state) {
        state.form.useDebt = !state.form.useDebt;
      },
      'save-sale': function (ctx, state) {
        return save(ctx, state);
      },

      /* 列表 / 查看 / 作废 / 退货 */
      filter: function (ctx, state, el) {
        var n = el.getAttribute('data-name');
        state[n] = el.value;
        state.page = 1;
      },
      listKeyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },
      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },
      'view-doc': function (ctx, state, el) {
        state.viewNo = el.getAttribute('data-no');
      },
      'close-view': function (ctx, state) {
        state.viewNo = null;
      },
      'void-sale': function (ctx, state, el) {
        var no = el.getAttribute('data-no');
        var go = function () {
          var r = engine.voidSale(ctx, no);
          if (!r.ok) ui.toast(r.error, 'err');
          else ui.toast('已作废 ' + no + '，库存与欠款已回滚', 'ok');
          if (ERP.app) ERP.app.render();
        };
        if (!ui.confirm) return go();
        return ui.confirm('作废销售单', '作废后库存与欠款将自动回滚，且不可恢复。<br>单号：' + esc(no)).then(function (yes) {
          if (yes) go();
        });
      },
      'open-refund': function (ctx, state, el) {
        state.refundNo = el.getAttribute('data-no');
        state.refundQty = {};
      },
      'refund-qty': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        state.refundQty = state.refundQty || {};
        var v = parseInt(el.value, 10);
        state.refundQty[skuId] = isNaN(v) || v < 0 ? 0 : v;
      },
      'do-refund': function (ctx, state) {
        var no = state.refundNo;
        var items = Object.keys(state.refundQty || {})
          .filter(function (k) {
            return state.refundQty[k] > 0;
          })
          .map(function (k) {
            return { skuId: k, qty: state.refundQty[k] };
          });
        var r = engine.refundSale(ctx, { originalNo: no, items: items });
        if (!r.ok) {
          ui.toast(r.error, 'err');
          return false;
        }
        ui.toast('退货成功 ' + r.doc.no + '，入库 ' +
          r.doc.items.reduce(function (t, it) {
            return t + it.qty;
          }, 0) + ' 件', 'ok');
        state.refundNo = null;
        state.refundQty = {};
        state.tab = 'list';
        return true;
      },
      'close-refund': function (ctx, state) {
        state.refundNo = null;
        state.refundQty = {};
      },

      /* 扫码 / 扫码枪输入条码 → 定位该款并展开矩阵 */
      'scan-input': function (ctx, state, payload) {
        var code = String((payload && payload.value) || '').trim().toUpperCase();
        if (!code) return;
        var p = ctx.data.products.find(function (x) {
          return (x.barcode || '').toUpperCase() === code || x.styleCode.toUpperCase() === code;
        });
        if (!p) {
          // 退一步：按 SKU id 反查款
          var sku = ctx.data.skus.find(function (s) {
            return s.id.toUpperCase() === code;
          });
          if (sku) p = ctx.getProduct(sku.styleCode);
        }
        if (p) {
          state.form.keyword = '';
          state.form.styleCode = p.styleCode;
          ui.toast('已定位：' + p.name, 'ok');
        } else {
          ui.toast('未找到此条码：' + code, 'err');
        }
      },

      /** 扫码：三级降级（实时 / 拍照 / 手输），识别后弹出商品卡 */
      'scan': function (ctx, state) {
        if (!ERP.scan || !ERP.scan.start) {
          ui.toast('当前环境不支持扫码，可手动输入条码', 'err');
          return;
        }
        ERP.scan.start({
          onResult: function (code) {
            if (ERP.scan && ERP.scan.openCard) ERP.scan.openCard(ctx, code, ERP.app);
            if (ERP.app) ERP.app.render();
          },
          onError: function (msg) {
            ui.toast(msg || '扫码不可用', 'err');
          }
        });
      }
    }
  };

  /* ---------------- 工具 ---------------- */

  function findItem(state, skuId) {
    return state.form.items.find(function (x) {
      return x.skuId === skuId;
    });
  }

  function addItem(ctx, state, skuId) {
    var sku = ctx.getSku(skuId);
    if (!sku) return;
    var it = findItem(state, skuId);
    if (it) {
      it.qty += 1;
      return;
    }
    var product = ctx.getProduct(sku.styleCode);
    state.form.items.push({
      skuId: sku.id,
      styleCode: sku.styleCode,
      color: sku.color,
      size: sku.size,
      qty: 1,
      price: inv.salePriceOf(ctx, sku),
      costSnapshot: sku.costPrice !== undefined && sku.costPrice !== null ? sku.costPrice
        : (product ? product.costPrice || 0 : 0),
      type: schema.DOC.SALE,
      giftReason: null
    });
  }

  function totals(ctx, state) {
    var calc = cart.compute(state.form.items, {
      discount: util.parseMoney(state.form.discount),
      payments: paymentsFromForm(state)
    });
    return calc;
  }

  function paymentsFromForm(state) {
    var out = [];
    PAY.forEach(function (m) {
      var amt = util.parseMoney(state.form.pay[m]);
      if (amt > 0) out.push({ method: m, amount: amt });
    });
    return out;
  }

  /* ---------------- 开单页 ---------------- */

  function renderNew(ctx, state) {
    var form = state.form;
    var calc = totals(ctx, state);

    var h = '<div class="page-head"><h2>销售开单</h2>' +
      '<span class="desc">搜索选品 → 点色码加单 → 收款保存</span></div>';

    h += '<div class="sale-three-col">';

    /* ---------- 左列：选货区（搜索 + 款 chips + 色码矩阵） ---------- */
    h += '<div class="sale-col-pick">';
    h += '<div class="card"><div class="card-title">选货区</div>' +
      ui.searchBar({ value: form.keyword, placeholder: '搜索名称 / 款号 / 条码', scan: true });
    var kw = String(form.keyword || '').toUpperCase();
    var styles = ctx.data.products.filter(function (p) {
      // V3 经营范围：非本账号分类商品不出现在选货区
      if (!schema.inScope(ctx.settings, p.category)) return false;
      if (!kw) return p.status !== schema.STATUS.OFF;
      return (
        String(p.styleCode).toUpperCase().indexOf(kw) >= 0 ||
        String(p.name).toUpperCase().indexOf(kw) >= 0 ||
        String(p.barcode || '').toUpperCase().indexOf(kw) >= 0
      );
    }).slice(0, 20);
    if (styles.length) {
      h += '<div class="chips mb8">';
      styles.forEach(function (p) {
        h += '<button class="chip' + (p.styleCode === form.styleCode ? ' on' : '') + '" data-act="pick-style" data-code="' + esc(p.styleCode) + '">' +
          esc(p.name) + ' <span class="weak small mono">' + esc(p.styleCode) + '</span></button>';
      });
      h += '</div>';
    }

    if (form.styleCode) {
      var product = ctx.getProduct(form.styleCode);
      var m = inv.buildMatrix(ctx, form.styleCode);
      if (product && m.colors.length) {
        h += '<div class="small muted mb4">点击色码格子加入销售单（数字为当前库存）</div>';
        h += '<div class="table-wrap">' + ui.matrixTable(m, { act: 'add-sale' }) + '</div>';
        h += '<div class="row mt8"><button class="btn btn-sm" data-act="clear-pick">收起</button></div>';
      }
    }
    h += '</div>';
    h += '</div>';

    /* ---------- 中列：当前订单（明细 + 折扣 + 合计 + 出单） ---------- */
    h += '<div class="sale-col-order">';
    var t = calc;
    h += '<div class="card"><div class="card-title">当前订单（' + form.items.length + ' 行）' +
      (form.items.length ? '<button class="btn btn-sm" data-act="clear-items">清空</button>' : '') + '</div>';
    if (!form.items.length) {
      h += ui.empty('还没有商品，先搜索并点色码加入');
    } else {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th><th class="num">数量</th>' +
        '<th class="num">单价</th><th>类型</th><th class="num">小计</th><th></th></tr></thead><tbody>';
      form.items.forEach(function (it) {
        var product = ctx.getProduct(it.styleCode);
        var line = (it.type === schema.DOC.GIFT ? 0 : it.price) * it.qty;
        h += '<tr>' +
          '<td>' + esc(product ? product.name : it.styleCode) + '<br><span class="weak small">' +
          esc(it.color) + ' / ' + esc(it.size) + '</span></td>' +
          '<td class="num"><input class="input" style="width:54px;text-align:right" data-change="cart-qty" data-sku="' + esc(it.skuId) + '" inputmode="numeric" value="' + it.qty + '"></td>' +
          '<td class="num"><input class="input" style="width:72px;text-align:right" data-change="cart-price" data-sku="' + esc(it.skuId) + '" inputmode="decimal" value="' + esc(util.fenToYuan(it.price)) + '"' + (it.type === schema.DOC.GIFT ? ' disabled' : '') + '></td>' +
          '<td>' +
          '<button class="btn btn-sm ' + (it.type === schema.DOC.GIFT ? 'btn-warn' : '') + '" data-act="toggle-gift" data-sku="' + esc(it.skuId) + '">' +
          (it.type === schema.DOC.GIFT ? '赠送' : '销售') + '</button>' +
          (it.type === schema.DOC.GIFT
            ? ui.select({ name: 'gr', value: it.giftReason, on: 'gift-reason', options: schema.GIFT_REASONS.map(function (r) {
              return { value: r, text: r };
            }), attrs: 'data-sku="' + esc(it.skuId) + '"' })
            : '') +
          '</td>' +
          '<td class="num">' + ui.money(line) + '</td>' +
          '<td class="act"><button data-act="del-item" data-sku="' + esc(it.skuId) + '">删除</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    h += '<div class="card">';
    h += '<div class="row between"><span class="muted">应收合计</span><span class="strong big">' + ui.money(t.payable) + '</span></div>';
    if (t.giftQty) {
      h += '<div class="row between small"><span class="muted">含赠送 ' + t.giftQty + ' 件（成本 ' + ui.money(t.giftCost) + '）</span></div>';
    }
    h += '<div class="field mt8"><label>整单折扣 / 抹零（元）</label>' +
      '<input class="input" data-input="field" data-name="discount" inputmode="decimal" placeholder="0" value="' + esc(form.discount) + '"></div>';
    h += '</div>';
    h += '</div>';

    /* ---------- 右列：收款（支付方式 + 实收 + 欠款处理） ---------- */
    h += '<div class="sale-col-pay">';
    h += '<div class="card"><div class="card-title">收款</div>';
    h += '<div class="field"><label>收款（元）</label>' +
      '<div class="grid grid-3">' +
      payInput('微信', 'pay.wechat', form.pay.wechat) +
      payInput('现金', 'pay.cash', form.pay.cash) +
      payInput('支付宝', 'pay.alipay', form.pay.alipay) +
      '</div></div>';

    h += '<div class="row between"><span class="muted">实收</span><span class="strong">' + ui.money(t.received) + '</span></div>';
    h += '<div class="row between mt4"><span class="muted">余款处理</span>' +
      '<button class="btn btn-sm ' + (form.useDebt ? 'btn-primary' : '') + '" data-act="toggle-debt">' +
      (form.useDebt ? '记欠款（挂账）' : '不欠款') + '</button></div>';
    h += '<div class="row between mt4"><span class="muted">欠款</span>' +
      '<span class="strong" style="color:' + (t.debt > 0 ? '#dc2626' : '#16a34a') + '">' + ui.money(t.debt) + '</span></div>';

    if (t.debt > 0 || form.useDebt) {
      var customers = debt.list(ctx, 'customer');
      h += '<div class="field mt8"><label class="req">客户（挂账对象）</label>' +
        ui.select({
          name: 'customerId', value: form.customerId, on: 'field',
          options: [{ value: '', text: '选择客户' }].concat(customers.map(function (c) {
            return { value: c.id, text: c.name + (c.balance ? '（欠 ' + ui.money(c.balance) + '）' : '') };
          }))
        }) +
        '<input class="input mt4" data-input="field" data-name="newCustomer" placeholder="或即时新建客户名称" value="' + esc(form.newCustomer) + '"></div>';
    }

    h += '<div class="field mt8"><label>备注</label>' +
      '<input class="input" data-input="field" data-name="note" placeholder="选填" value="' + esc(form.note) + '"></div>';

    /* 收款栏底部：取消 + 保存并出单（手机端位于收款之后，顺序正确） */
    h += '<div class="row mt8">' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary btn-lg" data-act="save-sale">保存并出单</button>' +
      '</div>';
    h += '</div>';
    h += '</div>';

    h += '</div>'; // sale-three-col
    return h;
  }

  function payInput(label, name, val) {
    return '<div><div class="small muted mb2">' + label + '</div>' +
      '<input class="input" data-input="field" data-name="' + name + '" inputmode="decimal" placeholder="0" value="' + esc(val) + '"></div>';
  }

  function save(ctx, state) {
    var form = state.form;
    if (!form.items.length) {
      ui.toast('请先添加商品', 'err');
      return false;
    }
    var calc = totals(ctx, state);
    if (form.useDebt && calc.debt > 0 && !form.customerId && !form.newCustomer.trim()) {
      ui.toast('欠款单需选择或新建客户', 'err');
      return false;
    }
    if (!form.useDebt && calc.debt > 0) {
      ui.toast('还有 ' + util.fenToYuan(calc.debt) + ' 元未收，请选择「记欠款」或收齐', 'err');
      return false;
    }

    var res = engine.saveSale(ctx, {
      date: util.today(),
      partnerId: form.customerId,
      partnerName: form.newCustomer,
      items: form.items.map(function (it) {
        return Object.assign({}, it, { price: util.fenToYuan(it.price) });
      }),
      discount: form.discount,
      payments: paymentsFromForm(state),
      note: form.note
    });
    if (!res.ok) {
      ui.toast(res.error, 'err');
      return false;
    }
    ui.toast('已出单 ' + res.doc.no + (res.doc.debt ? '，欠款 ' + ui.money(res.doc.debt) : ''), 'ok');
    state.tab = 'list';
    state.form = emptyForm();
    return true;
  }

  /* ---------------- 销售记录列表 ---------------- */

  function renderList(ctx, state) {
    var list = ctx.data.sales.filter(function (d) {
      if (state.typeFilter !== 'all' && d.type !== state.typeFilter) return false;
      if (state.from && d.date < state.from) return false;
      if (state.to && d.date > state.to) return false;
      if (state.keyword) {
        var kw = String(state.keyword).toUpperCase();
        if (String(d.no).toUpperCase().indexOf(kw) < 0 &&
          String(d.partnerName || '').toUpperCase().indexOf(kw) < 0 &&
          !(d.items || []).some(function (it) {
            return String(it.styleCode).toUpperCase().indexOf(kw) >= 0;
          })) return false;
      }
      return true;
    });
    list = util.sortBy(list, function (d) {
      return d.no;
    }, true);

    var pg = util.paginate(list, state.page, 300);
    state.page = pg.page;

    var h = '<div class="page-head"><h2>销售记录</h2>' +
      '<span class="desc">' + list.length + ' 张单</span>' +
      '<div class="actions"><button class="btn btn-primary" data-act="open-new">＋ 开单</button></div></div>';

    h += '<div class="card">' + ui.searchBar({ value: state.keyword, placeholder: '搜索单号 / 客户 / 款号', scan: false });
    h += '<div class="row wrap">' +
      '<input class="input" type="date" data-change="filter" data-name="from" value="' + esc(state.from) + '">' +
      '<input class="input" type="date" data-change="filter" data-name="to" value="' + esc(state.to) + '">' +
      ui.select({
        name: 'typeFilter', value: state.typeFilter, on: 'filter',
        options: [
          { value: 'all', text: '全部类型' },
          { value: 'sale', text: '销售' },
          { value: 'refund', text: '退货' }
        ]
      }) + '</div></div>';

    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('还没有销售单，去开一单吧') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>单号</th><th>日期</th><th>客户</th><th class="num">数量</th><th class="num">应收</th>' +
      '<th class="num">实收</th><th class="num">欠款</th><th>状态</th><th>操作</th></tr></thead><tbody>';
    pg.items.forEach(function (d) {
      var qty = util.sum(d.items, function (it) {
        return it.qty;
      });
      var isRefund = d.type === schema.DOC.REFUND;
      h += '<tr' + (d.voided ? ' style="opacity:.5"' : '') + '>' +
        '<td class="mono">' + esc(d.no) + (isRefund ? ' <span class="weak small">退</span>' : '') + '</td>' +
        '<td>' + esc(d.date) + '</td>' +
        '<td>' + esc(d.partnerName || '-') + '</td>' +
        '<td class="num">' + qty + '</td>' +
        '<td class="num">' + ui.money(d.payable) + '</td>' +
        '<td class="num">' + ui.money(d.received) + '</td>' +
        '<td class="num">' + (d.debt ? '<b style="color:#dc2626">' + ui.money(d.debt) + '</b>' : '—') + '</td>' +
        '<td>' + (d.voided ? ui.badge('已作废', 'off') : (d.debt ? ui.badge('欠款', 'warn') : ui.badge('已结清', 'on'))) + '</td>' +
        '<td class="act">' +
        '<button data-act="view-doc" data-no="' + esc(d.no) + '">查看</button>' +
        (d.voided ? '' :
          (isRefund ? '' : '<button data-act="open-refund" data-no="' + esc(d.no) + '">退货</button>') +
          '<button data-act="void-sale" data-no="' + esc(d.no) + '">作废</button>') +
        '</td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';

    if (state.viewNo) {
      var doc = ctx.getDoc('sales', state.viewNo);
      if (doc) h += docModal(ctx, doc);
    }
    if (state.refundNo) {
      var rd = ctx.getDoc('sales', state.refundNo);
      if (rd) h += refundModal(ctx, state, rd);
    }
    return h;
  }

  function docModal(ctx, doc) {
    var isRefund = doc.type === schema.DOC.REFUND;
    var qty = util.sum(doc.items, function (it) {
      return it.qty;
    });
    var h = '<div class="card"><div class="card-title">' + (isRefund ? '退货单 ' : '销售单 ') + esc(doc.no) +
      (doc.voided ? '（已作废）' : '') +
      '<span class="more">' + esc(doc.date) + ' · ' + esc(doc.partnerName || '散客') + '</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>款号</th><th>颜色/号码</th>' +
      '<th>类型</th><th class="num">数量</th><th class="num">单价</th><th class="num">小计</th></tr></thead><tbody>';
    doc.items.forEach(function (it) {
      var line = (it.type === schema.DOC.GIFT ? 0 : it.price) * it.qty;
      h += '<tr><td class="mono">' + esc(it.styleCode) + '</td><td>' + esc(it.color) + ' / ' + esc(it.size) + '</td>' +
        '<td>' + (it.type === schema.DOC.GIFT ? ui.badge('赠送', 'warn') + (it.giftReason ? ' ' + esc(it.giftReason) : '') : '销售') + '</td>' +
        '<td class="num">' + it.qty + '</td><td class="num">' + ui.money(it.price) + '</td>' +
        '<td class="num">' + ui.money(line) + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="row between mt8"><span class="muted">应收 ' + ui.money(doc.payable) +
      (doc.discount ? '（折扣 ' + ui.money(doc.discount) + '）' : '') +
      '　实收 ' + ui.money(doc.received) + '　欠款 ' + ui.money(doc.debt) +
      (isRefund ? '　红冲 ' + esc(doc.refNo) : '') + '</span>' +
      '<button class="btn btn-sm" data-act="close-view">关闭</button></div></div>';
    return h;
  }

  function refundModal(ctx, state, doc) {
    // 已退数量（同原单的退货单）
    var returnedOf = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== schema.DOC.REFUND || s.voided) return;
      if (s.refNo !== doc.no) return;
      s.items.forEach(function (ri) {
        returnedOf[ri.skuId] = (returnedOf[ri.skuId] || 0) + ri.qty;
      });
    });
    state.refundQty = state.refundQty || {};
    var h = '<div class="card"><div class="card-title">退货 · 红冲 ' + esc(doc.no) +
      '<span class="more">选择要退的色码与数量</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th><th class="num">可退</th><th class="num">退几件</th></tr></thead><tbody>';
    doc.items.forEach(function (it) {
      var maxQty = it.qty - (returnedOf[it.skuId] || 0);
      if (maxQty <= 0) return;
      var product = ctx.getProduct(it.styleCode);
      var def = state.refundQty[it.skuId] !== undefined ? state.refundQty[it.skuId] : maxQty;
      h += '<tr><td>' + esc(product ? product.name : it.styleCode) + ' <span class="weak small">' + esc(it.color) + '/' + esc(it.size) + '</span></td>' +
        '<td class="num">' + maxQty + '</td>' +
        '<td class="num"><input class="input" style="width:60px;text-align:right" data-change="refund-qty" data-sku="' + esc(it.skuId) + '" inputmode="numeric" value="' + def + '"></td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="row"><button class="btn" data-act="close-refund">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="do-refund">确认退货</button></div></div>';
    return h;
  }

  return page;
});
