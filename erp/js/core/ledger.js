/**
 * core/ledger.js —— 收支流水（单据自动生成 + 手工记账）
 * 约定：amount 恒为正数，方向由 type 决定（见 DIRECTION）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.ledger = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var L = schema.LEDGER;

  var DIRECTION = {};
  DIRECTION[L.SALE_INCOME] = 'in';
  DIRECTION[L.RECEIVE_DEBT] = 'in';
  DIRECTION[L.INCOME] = 'in';
  DIRECTION[L.PURCHASE_EXPENSE] = 'out';
  DIRECTION[L.PAY_SUPPLIER] = 'out';
  DIRECTION[L.GIFT_COST] = 'out';
  DIRECTION[L.REFUND_OUT] = 'out';
  DIRECTION[L.EXPENSE] = 'out';

  var ledger = { DIRECTION: DIRECTION };

  ledger.directionOf = function (type) {
    return DIRECTION[type] || 'out';
  };

  /**
   * 记一笔流水
   * 注意：amount 一律是「分」（与全局金额约定一致），
   * 用户输入的「元」请在外层用 util.parseMoney 转换后再传入（见 ledger.manual）
   */
  ledger.add = function add(ctx, input) {
    var rec = {
      id: util.uuid('ld'),
      date: input.date || util.today(),
      type: input.type,
      category: input.category || '',
      amount: Math.abs(Math.round(Number(input.amount) || 0)),
      direction: ledger.directionOf(input.type),
      refType: input.refType || '',
      refNo: input.refNo || '',
      partnerId: input.partnerId || null,
      note: input.note || '',
      auto: input.auto === undefined ? true : !!input.auto,
      voided: false,
      createdAt: util.nowISO()
    };
    ctx.data.ledgers = ctx.data.ledgers || [];
    ctx.data.ledgers.push(rec);
    ctx.touch('ledgers', rec);
    return rec;
  };

  /** 进货：按已付金额生成进货支出流水 */
  ledger.fromPurchase = function fromPurchase(ctx, doc) {
    if (!doc.paid) return null;
    return ledger.add(ctx, {
      date: doc.date,
      type: L.PURCHASE_EXPENSE,
      amount: doc.paid,
      refType: schema.DOC.PURCHASE,
      refNo: doc.no,
      partnerId: doc.partnerId,
      note: '进货付款 ' + (doc.partnerName || ''),
      auto: true
    });
  };

  /** 销售：已收金额生成收入流水；赠送生成赠送成本流水（不计收入） */
  ledger.fromSale = function fromSale(ctx, doc) {
    var out = [];
    if (doc.received && doc.type !== schema.DOC.REFUND) {
      out.push(ledger.add(ctx, {
        date: doc.date,
        type: L.SALE_INCOME,
        amount: doc.received,
        refType: schema.DOC.SALE,
        refNo: doc.no,
        partnerId: doc.partnerId || null,
        note: '销售收入 ' + (doc.partnerName || ''),
        auto: true
      }));
    }
    var giftCost = 0;
    doc.items.forEach(function (it) {
      if (it.type === schema.DOC.GIFT) giftCost += (it.costSnapshot || 0) * it.qty;
    });
    if (giftCost > 0) {
      out.push(ledger.add(ctx, {
        date: doc.date,
        type: L.GIFT_COST,
        amount: giftCost,
        refType: schema.DOC.SALE,
        refNo: doc.no,
        note: '赠送成本（' + doc.items.filter(function (i) {
          return i.type === schema.DOC.GIFT;
        }).map(function (i) {
          return i.giftReason || '赠送';
        }).join('/') + '）',
        auto: true
      }));
    }
    if (doc.type === schema.DOC.REFUND) {
      out.push(ledger.add(ctx, {
        date: doc.date,
        type: L.REFUND_OUT,
        amount: doc.payable || 0,
        refType: schema.DOC.REFUND,
        refNo: doc.no,
        partnerId: doc.partnerId || null,
        note: '退货冲减 ' + (doc.refNo || ''),
        auto: true
      }));
    }
    return out;
  };

  /** 客户回款 / 供应商付款 */
  ledger.fromSettle = function fromSettle(ctx, input) {
    return ledger.add(ctx, {
      date: input.date,
      type: input.isSupplier ? L.PAY_SUPPLIER : L.RECEIVE_DEBT,
      amount: input.amount,
      refType: input.isSupplier ? 'pay' : 'receive',
      refNo: input.refNo || '',
      partnerId: input.partnerId,
      note: (input.isSupplier ? '付供应商款 ' : '收客户欠款 ') + (input.partnerName || ''),
      auto: false
    });
  };

  /** 手工记一笔（费用 / 其他收入） */
  ledger.manual = function manual(ctx, input) {
    var amount = util.parseMoney(input.amount);
    if (!amount) return { ok: false, error: '金额必须大于 0' };
    var type = input.direction === 'in' ? L.INCOME : L.EXPENSE;
    if (!input.direction && input.category && schema.EXPENSE_CATEGORIES.indexOf(input.category) >= 0) {
      type = L.EXPENSE;
    }
    var rec = ledger.add(ctx, {
      date: input.date,
      type: type,
      category: input.category || '其他',
      amount: amount, // manual 已用 parseMoney 转为「分」

      refType: 'manual',
      note: input.note || '',
      auto: false
    });
    return { ok: true, rec: rec };
  };

  /** 单据作废：把关联流水标记作废（报表排除，保留痕迹） */
  ledger.voidByRef = function voidByRef(ctx, refNo) {
    var n = 0;
    (ctx.data.ledgers || []).forEach(function (r) {
      if (r.refNo === refNo && !r.voided) {
        r.voided = true;
        ctx.touch('ledgers', r);
        n += 1;
      }
    });
    return n;
  };

  /** 查询：{from,to,type,direction} */
  ledger.list = function list(ctx, filters) {
    filters = filters || {};
    var out = (ctx.data.ledgers || []).filter(function (r) {
      if (filters.includeVoided !== true && r.voided) return false;
      if (filters.from && r.date < filters.from) return false;
      if (filters.to && r.date > filters.to) return false;
      if (filters.type && r.type !== filters.type) return false;
      if (filters.direction && r.direction !== filters.direction) return false;
      return true;
    });
    return util.sortBy(out, function (r) {
      return r.date + (r.id || '');
    }, true);
  };

  /** 区间内合计：net = 收 − 支 */
  ledger.sum = function sum(ctx, filters) {
    var list = ledger.list(ctx, filters);
    var income = 0;
    var expense = 0;
    list.forEach(function (r) {
      if (r.direction === 'in') income += r.amount;
      else expense += r.amount;
    });
    return { income: income, expense: expense, net: income - expense, count: list.length };
  };

  /** 费用支出合计（房租/水电/人工/物流/其他）—— 净利参考用 */
  ledger.expenseTotal = function expenseTotal(ctx, from, to) {
    return (ctx.data.ledgers || []).filter(function (r) {
      return !r.voided && r.type === L.EXPENSE &&
        (!from || r.date >= from) && (!to || r.date <= to);
    }).reduce(function (t, r) {
      return t + r.amount;
    }, 0);
  };

  return ledger;
});
