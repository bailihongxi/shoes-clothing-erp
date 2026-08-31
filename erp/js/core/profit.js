/**
 * core/profit.js —— 三层利润口径（PRD 5.7 / 10.2）
 * 设计原则：利润全部由「单据」派生，成本用销售单上的 costSnapshot（进价快照），
 * 因此**改动商品档案当前进价不会影响历史报表数字**（PRD 10.2）。
 *
 * 口径：
 *   销售收入   = Σ(销售单 payable) − Σ(退货单 payable)
 *   销售成本   = Σ(售出数量 × 进价快照) − Σ(退货数量 × 进价快照)   （仅销售行，不含赠送）
 *   毛利       = 销售收入 − 销售成本
 *   毛利率     = 毛利 ÷ 销售收入
 *   赠送成本   = Σ(赠品数量 × 进价快照)
 *   净利参考   = 毛利 − 赠送成本 − 费用支出（房租/水电/人工/物流/其他）
 *   库存资金占用 = Σ(当前库存 × 最新进价)
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var ledger = isNode ? require('./ledger.js') : root.ERP && root.ERP.ledger;
  var mod = factory(util, schema, ledger);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.profit = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema, ledger) {
  'use strict';

  var D = schema.DOC;
  var profit = {};

  /** 区间过滤（按单据日期） */
  function inRange(date, from, to) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  /**
   * 利润汇总
   * @param ctx 工作上下文
   * @param opts {from, to} 可选日期区间
   */
  profit.summary = function summary(ctx, opts) {
    opts = opts || {};
    var sales = (ctx.data.sales || []).filter(function (d) {
      return !d.voided && inRange(d.date, opts.from, opts.to);
    });

    var revenue = 0;      // 销售收入
    var saleCost = 0;     // 销售成本（仅销售行）
    var giftCost = 0;     // 赠送成本
    var qtySold = 0;      // 销量（含赠送？此处按销售行计，赠送单列）

    sales.forEach(function (d) {
      var isRefund = d.type === D.REFUND;
      if (isRefund) revenue -= (d.payable || 0);
      else revenue += (d.payable || 0);

      (d.items || []).forEach(function (it) {
        var amt = (it.costSnapshot || 0) * (it.qty || 0);
        var isGift = it.type === D.GIFT;
        if (isRefund) {
          saleCost -= amt;            // 退货：成本回冲
          qtySold -= (it.qty || 0);
        } else if (isGift) {
          giftCost += amt;            // 赠送：单列成本
          // 赠送不计入销售成本、不计入销量
        } else {
          saleCost += amt;
          qtySold += (it.qty || 0);
        }
      });
    });

    var expense = ledger.expenseTotal(ctx, opts.from, opts.to);
    var gross = revenue - saleCost;
    var net = gross - giftCost - expense;

    return {
      revenue: revenue,
      saleCost: saleCost,
      giftCost: giftCost,
      grossProfit: gross,
      grossMargin: revenue ? gross / revenue : 0,
      expense: expense,
      netProfit: net,
      qtySold: qtySold
    };
  };

  /**
   * 月度趋势：按自然月聚合 {month, revenue, grossProfit, qty}
   * 用于报表页自绘 SVG 柱状图
   */
  profit.monthly = function monthly(ctx, opts) {
    opts = opts || {};
    var map = {};
    (ctx.data.sales || []).forEach(function (d) {
      if (d.voided) return;
      if (!inRange(d.date, opts.from, opts.to)) return;
      var m = util.monthOf(d.date);
      if (!map[m]) map[m] = { month: m, revenue: 0, saleCost: 0, giftCost: 0, qty: 0 };
      var b = map[m];
      var isRefund = d.type === D.REFUND;
      b.revenue += isRefund ? -(d.payable || 0) : (d.payable || 0);
      (d.items || []).forEach(function (it) {
        var amt = (it.costSnapshot || 0) * (it.qty || 0);
        if (isRefund) {
          b.saleCost -= amt;
          b.qty -= (it.qty || 0);
        } else if (it.type === D.GIFT) {
          b.giftCost += amt;
        } else {
          b.saleCost += amt;
          b.qty += (it.qty || 0);
        }
      });
    });
    var arr = Object.keys(map).sort().map(function (m) {
      var b = map[m];
      return {
        month: m,
        revenue: b.revenue,
        grossProfit: b.revenue - b.saleCost,
        qty: b.qty
      };
    });
    return arr;
  };

  /**
   * 畅销 / 滞销 TOP N（按毛利或销量）
   * @param opts {by:'profit'|'qty', n:5, order:'desc'|'asc'}
   * 返回 [{styleCode, name, qty, revenue, cost, grossProfit}]
   */
  profit.topProducts = function topProducts(ctx, opts) {
    opts = opts || {};
    var by = opts.by === 'qty' ? 'qty' : 'profit';
    var n = opts.n || 5;
    var order = opts.order === 'asc' ? 'asc' : 'desc';
    var map = {};
    (ctx.data.sales || []).forEach(function (d) {
      if (d.voided) return;
      var isRefund = d.type === D.REFUND;
      (d.items || []).forEach(function (it) {
        if (it.type === D.GIFT) return; // 赠送不计入排行
        var sc = it.styleCode;
        if (!map[sc]) map[sc] = { styleCode: sc, name: '', qty: 0, revenue: 0, cost: 0 };
        var m = map[sc];
        var amt = (it.costSnapshot || 0) * (it.qty || 0);
        if (isRefund) {
          m.qty -= (it.qty || 0);
          m.revenue -= (it.price || 0) * (it.qty || 0);
          m.cost -= amt;
        } else {
          m.qty += (it.qty || 0);
          m.revenue += (it.price || 0) * (it.qty || 0);
          m.cost += amt;
        }
      });
    });
    var list = Object.keys(map).map(function (sc) {
      var m = map[sc];
      var p = ctx.getProduct(sc);
      if (p) m.name = p.name;
      m.grossProfit = m.revenue - m.cost;
      return m;
    });
    list.sort(function (a, b) {
      var va = by === 'qty' ? a.qty : a.grossProfit;
      var vb = by === 'qty' ? b.qty : b.grossProfit;
      return order === 'asc' ? va - vb : vb - va;
    });
    return list.slice(0, n);
  };

  /** 库存资金占用 = Σ(当前库存 × 最新进价) */
  profit.stockValue = function stockValue(ctx) {
    var total = 0;
    (ctx.data.skus || []).forEach(function (sku) {
      var stock = sku.stock || 0;
      if (stock <= 0) return;
      var cost = sku.costPrice;
      if (cost === undefined || cost === null) {
        var p = ctx.getProduct(sku.styleCode);
        cost = p ? p.costPrice || 0 : 0;
      }
      total += stock * (cost || 0);
    });
    return total;
  };

  /** 组装 CSV 文本（带 BOM，Excel 中文不乱码） */
  profit.buildCSV = function buildCSV(ctx, opts) {
    var rows = profit.monthly(ctx, opts).map(function (m) {
      return [m.month, util.fenToYuan(m.revenue), util.fenToYuan(m.grossProfit), m.qty];
    });
    return util.toCSV(['月份', '销售收入(元)', '毛利(元)', '销量'], rows);
  };

  return profit;
});
