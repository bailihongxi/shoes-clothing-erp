/**
 * core/debt.js —— 往来单位应收 / 应付
 * partner.balance（分）：
 *   供应商 supplier：正数 = 我们欠他（应付）
 *   客户   customer：正数 = 他欠我们（应收）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.debt = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var debt = {};

  /** 查找或新建往来单位（按 名称+类型 去重） */
  debt.ensurePartner = function ensurePartner(ctx, input) {
    var name = util.cleanText(input.name);
    var type = input.type === 'customer' ? 'customer' : 'supplier';
    var found = (ctx.data.partners || []).find(function (p) {
      return util.cleanText(p.name).toUpperCase() === name.toUpperCase() && p.type === type;
    });
    if (found) {
      if (input.phone && !found.phone) {
        found.phone = util.cleanText(input.phone);
        ctx.touch('partners', found);
      }
      return found;
    }
    var partner = {
      id: util.uuid(type === 'supplier' ? 'sup' : 'cus'),
      name: name,
      phone: util.cleanText(input.phone || ''),
      type: type,
      balance: 0,
      lastDealAt: null,
      createdAt: util.nowISO()
    };
    ctx.data.partners = ctx.data.partners || [];
    ctx.data.partners.push(partner);
    ctx.touch('partners', partner);
    return partner;
  };

  /** 进货挂账：供应商应付 +N */
  debt.applyPurchase = function applyPurchase(ctx, doc) {
    if (!doc.partnerId || !doc.debt) return null;
    var p = ctx.getPartner(doc.partnerId);
    if (!p) return null;
    p.balance = (p.balance || 0) + doc.debt;
    p.lastDealAt = doc.date;
    ctx.touch('partners', p);
    return p;
  };

  /** 销售挂账：客户应收 +N */
  debt.applySale = function applySale(ctx, doc) {
    if (!doc.partnerId || !doc.debt) return null;
    var p = ctx.getPartner(doc.partnerId);
    if (!p) return null;
    p.balance = (p.balance || 0) + doc.debt;
    p.lastDealAt = doc.date;
    ctx.touch('partners', p);
    return p;
  };

  /** 退货：客户应收 −N（我们欠他 / 冲减他的欠款） */
  debt.applyRefund = function applyRefund(ctx, doc) {
    if (!doc.partnerId || !doc.debt) return null;
    var p = ctx.getPartner(doc.partnerId);
    if (!p) return null;
    p.balance = (p.balance || 0) - doc.debt;
    ctx.touch('partners', p);
    return p;
  };

  /**
   * 收付款登记
   * @param input {partnerId, amount, date, method, note, isSupplier}
   */
  debt.settle = function settle(ctx, input) {
    var p = ctx.getPartner(input.partnerId);
    if (!p) return { ok: false, error: '往来单位不存在' };
    var amount = util.parseMoney(input.amount);
    if (!amount || amount <= 0) return { ok: false, error: '金额必须大于 0' };
    var before = p.balance || 0;
    var after = before - amount;
    if (input.isSupplier) {
      // 供应商：应付减少，允许付到 0（不允许把应付冲成负数太多）
      if (after < 0) after = 0;
    }
    p.balance = after;
    ctx.touch('partners', p);
    return {
      ok: true,
      partner: p,
      before: before,
      after: after,
      paid: before - after,
      overpay: input.isSupplier ? Math.max(0, before - amount < 0 ? amount - before : 0) : 0
    };
  };

  /** 撤销单据造成的欠款（作废时回滚） */
  debt.reverseDoc = function reverseDoc(ctx, doc, kind) {
    if (!doc.partnerId || !doc.debt) return null;
    var p = ctx.getPartner(doc.partnerId);
    if (!p) return null;
    if (kind === schema.DOC.REFUND) p.balance = (p.balance || 0) + doc.debt;
    else p.balance = (p.balance || 0) - doc.debt;
    ctx.touch('partners', p);
    return p;
  };

  debt.list = function list(ctx, type) {
    return util.sortBy(
      (ctx.data.partners || []).filter(function (p) {
        return !type || p.type === type;
      }),
      function (p) {
        return -(p.balance || 0);
      }
    );
  };

  /** 有余额的应付清单 */
  debt.payables = function payables(ctx) {
    return debt.list(ctx, 'supplier').filter(function (p) {
      return (p.balance || 0) > 0;
    });
  };

  debt.receivables = function receivables(ctx) {
    return debt.list(ctx, 'customer').filter(function (p) {
      return (p.balance || 0) > 0;
    });
  };

  debt.totals = function totals(ctx) {
    var payable = 0;
    var receivable = 0;
    (ctx.data.partners || []).forEach(function (p) {
      if (p.type === 'supplier') payable += Math.max(0, p.balance || 0);
      else receivable += Math.max(0, p.balance || 0);
    });
    return { payable: payable, receivable: receivable };
  };

  /**
   * 超期欠款：客户应收中，最后一笔交易至今超过 days 天
   * （按往来单位聚合，取该单位最早未结单据日期）
   */
  debt.overdue = function overdue(ctx, days) {
    var limit = days === undefined ? (ctx.settings.debtOverdueDays || 15) : days;
    var today = util.today();
    var out = [];
    debt.receivables(ctx).forEach(function (p) {
      var oldest = null;
      (ctx.data.sales || []).forEach(function (s) {
        if (s.voided || s.type === schema.DOC.REFUND) return;
        if (s.partnerId !== p.id) return;
        if (!s.debt) return;
        if (!oldest || s.date < oldest) oldest = s.date;
      });
      var base = oldest || p.lastDealAt || p.createdAt.slice(0, 10);
      var d = util.diffDays(String(base).slice(0, 10), today);
      if (d > limit) {
        out.push({ partner: p, balance: p.balance, from: String(base).slice(0, 10), days: d });
      }
    });
    return util.sortBy(out, function (o) {
      return -o.days;
    });
  };

  return debt;
});
