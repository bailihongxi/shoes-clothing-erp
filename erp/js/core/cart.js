/**
 * core/cart.js —— 开单计算（购物车 / 结算）
 * 纯函数：根据明细、整单折扣、收款方式，计算应收 / 实收 / 欠款 / 赠送成本。
 * 金额一律「分」，外部传入前用 util.parseMoney 转换。
 *
 * item: { type:'sale'|'gift', price(分), qty, costSnapshot(分) }
 * opts: { discount(分), payments:[{method,amount(分)}] }
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.cart = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var cart = {};

  /**
   * 计算一笔开单的应收 / 实收 / 欠款 / 赠送成本
   * @returns { saleTotal, giftQty, giftCost, payable, received, debt, discount, items }
   */
  cart.compute = function compute(items, opts) {
    opts = opts || {};
    items = items || [];
    var discount = Math.max(0, Math.round(opts.discount || 0));
    var payments = opts.payments || [];

    var saleTotal = 0;
    var giftQty = 0;
    var giftCost = 0;
    var itemAmounts = items.map(function (it) {
      var qty = Math.max(0, parseInt(it.qty, 10) || 0);
      var price = Math.max(0, Math.round(it.price || 0));
      var cost = Math.max(0, Math.round(it.costSnapshot || 0));
      var line = price * qty;
      if (it.type === schema.DOC.GIFT) {
        giftQty += qty;
        giftCost += cost * qty;
      } else {
        saleTotal += line;
      }
      return {
        type: it.type === schema.DOC.GIFT ? schema.DOC.GIFT : schema.DOC.SALE,
        price: price,
        qty: qty,
        line: line,
        costSnapshot: cost
      };
    });

    // 应收 = 销售行合计 − 整单折扣（赠送不计入应收）
    var payable = Math.max(0, saleTotal - discount);

    // 实收 = 各收款方式（不含「欠款」）之和，且不超过应收
    var received = 0;
    payments.forEach(function (p) {
      if (p.method === 'debt') return;
      received += Math.max(0, Math.round(p.amount || 0));
    });
    if (received > payable) received = payable;

    var debt = Math.max(0, payable - received);

    return {
      saleTotal: saleTotal,
      giftQty: giftQty,
      giftCost: giftCost,
      discount: discount,
      payable: payable,
      received: received,
      debt: debt,
      items: itemAmounts
    };
  };

  /**
   * 单行小计
   */
  cart.lineAmount = function lineAmount(item) {
    return Math.max(0, Math.round(item.price || 0)) * Math.max(0, parseInt(item.qty, 10) || 0);
  };

  /**
   * 由表单明细生成结算所需的 items（补全 type / costSnapshot / price）
   * formItems: [{ skuId, qty, price(分), type, giftReason, costSnapshot(分) }]
   */
  cart.toItems = function toItems(formItems) {
    return (formItems || []).map(function (it) {
      return {
        skuId: it.skuId,
        styleCode: it.styleCode,
        color: it.color,
        size: it.size,
        qty: Math.max(1, parseInt(it.qty, 10) || 1),
        price: Math.max(0, Math.round(it.price || 0)),
        costSnapshot: Math.max(0, Math.round(it.costSnapshot || 0)),
        type: it.type === schema.DOC.GIFT ? schema.DOC.GIFT : schema.DOC.SALE,
        giftReason: it.type === schema.DOC.GIFT ? (it.giftReason || schema.GIFT_REASONS[0]) : null
      };
    });
  };

  return cart;
});
