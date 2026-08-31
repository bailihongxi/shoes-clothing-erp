/**
 * core/inventory.js —— 库存增减、色码矩阵、预警、盘点差异
 * 约束（PRD 6）：库存只能由单据派生，本模块是唯一改库存的入口。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.inventory = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var inv = {};

  /** 单个色码增减库存并写变动流水（唯一入口） */
  inv.changeStock = function changeStock(ctx, skuId, delta, refType, refNo, date) {
    var sku = ctx.getSku(skuId);
    if (!sku) return { ok: false, error: '色码不存在：' + skuId };
    var before = sku.stock || 0;
    var after = before + delta;
    if (after < 0) {
      return { ok: false, error: '库存不足：' + skuId + ' 当前 ' + before + '，需要出库 ' + Math.abs(delta) };
    }
    sku.stock = after;
    ctx.touch('skus', sku);

    var log = {
      id: util.uuid('sl'),
      date: date || util.today(),
      skuId: skuId,
      styleCode: sku.styleCode,
      delta: delta,
      balance: after,
      refType: refType,
      refNo: refNo || ''
    };
    ctx.data.stockLogs = ctx.data.stockLogs || [];
    ctx.data.stockLogs.push(log);
    ctx.touch('stockLogs', log);
    return { ok: true, sku: sku, log: log, before: before, after: after };
  };

  /** 进货入库：每个明细 stock += qty */
  inv.applyPurchase = function applyPurchase(ctx, doc) {
    var results = [];
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      results.push(inv.changeStock(ctx, it.skuId, it.qty, schema.DOC.PURCHASE, doc.no, doc.date));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 销售/赠送出库、退货入库 */
  inv.applySale = function applySale(ctx, doc) {
    var results = [];
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      var delta = doc.type === schema.DOC.REFUND ? it.qty : -it.qty;
      var refType = doc.type === schema.DOC.REFUND
        ? schema.DOC.REFUND
        : it.type === schema.DOC.GIFT
          ? schema.DOC.GIFT
          : schema.DOC.SALE;
      results.push(inv.changeStock(ctx, it.skuId, delta, refType, doc.no, doc.date));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 单据作废：库存反向回滚，并写反向流水留痕 */
  inv.reverseDoc = function reverseDoc(ctx, doc, refType) {
    var results = [];
    for (var i = 0; i < (doc.items || []).length; i++) {
      var it = doc.items[i];
      var delta;
      if (refType === schema.DOC.PURCHASE) delta = -it.qty;
      else if (doc.type === schema.DOC.REFUND) delta = -it.qty;
      else delta = it.qty;
      results.push(inv.changeStock(ctx, it.skuId, delta, 'void', doc.no, util.today()));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 颜色 × 尺码矩阵：{colors:[], sizes:[], cells:{'白|38':{skuId,stock,price,threshold}}} */
  inv.buildMatrix = function buildMatrix(ctx, styleCode) {
    var skus = ctx.skusOf(styleCode).filter(function (s) {
      return s.status !== schema.STATUS.OFF;
    });
    var colors = [];
    var sizes = [];
    var cells = {};
    skus.forEach(function (s) {
      if (colors.indexOf(s.color) < 0) colors.push(s.color);
      if (sizes.indexOf(s.size) < 0) sizes.push(s.size);
      cells[s.color + '|' + s.size] = {
        skuId: s.id,
        stock: s.stock || 0,
        threshold: s.threshold === undefined ? (ctx.settings.defaultThreshold || 3) : s.threshold,
        price: s.price === null || s.price === undefined ? (ctx.getProduct(styleCode) || {}).salePrice : s.price
      };
    });
    colors.sort(function (a, b) {
      return colorSeqOf(ctx, styleCode, a) - colorSeqOf(ctx, styleCode, b);
    });
    sizes.sort(compareSize);
    return { styleCode: styleCode, colors: colors, sizes: sizes, cells: cells };
  };

  function colorSeqOf(ctx, styleCode, color) {
    var hit = ctx.skusOf(styleCode).find(function (s) {
      return s.color === color;
    });
    return hit && hit.colorSeq ? hit.colorSeq : 99;
  }

  /** 自然序：数字按大小，字母按字典，数字在前 */
  function compareSize(a, b) {
    var na = parseFloat(a);
    var nb = parseFloat(b);
    var aNum = !isNaN(na);
    var bNum = !isNaN(nb);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    return String(a).localeCompare(String(b));
  }
  inv.compareSize = compareSize;

  /**
   * 预警列表：库存低于阈值的在售色码
   * opts {includeOff:false, onlyEmpty:false}
   */
  inv.getAlerts = function getAlerts(ctx, opts) {
    opts = opts || {};
    var out = [];
    (ctx.data.skus || []).forEach(function (sku) {
      if (!opts.includeOff && sku.status === schema.STATUS.OFF) return;
      var product = ctx.getProduct(sku.styleCode);
      if (!opts.includeOff && product && product.status === schema.STATUS.OFF) return;
      var threshold = sku.threshold === undefined || sku.threshold === null
        ? (ctx.settings.defaultThreshold || 3)
        : sku.threshold;
      var stock = sku.stock || 0;
      if (opts.onlyEmpty ? stock <= 0 : stock < threshold) {
        out.push({
          skuId: sku.id,
          styleCode: sku.styleCode,
          name: product ? product.name : '',
          color: sku.color,
          size: sku.size,
          stock: stock,
          threshold: threshold,
          empty: stock <= 0
        });
      }
    });
    return util.sortBy(out, function (a) {
      return a.stock;
    });
  };

  /** 预警款数（首页用，按款去重） */
  inv.alertStyleCount = function alertStyleCount(ctx) {
    var set = {};
    inv.getAlerts(ctx).forEach(function (a) {
      set[a.styleCode] = true;
    });
    return Object.keys(set).length;
  };

  /**
   * 盘点：counts = { skuId: 实盘数 }
   * 生成盘点单（含差异明细），库存更新到实盘数并留痕
   */
  inv.applyStocktake = function applyStocktake(ctx, input, docNoStr) {
    var date = input.date || util.today();
    var counts = input.counts || {};
    var items = [];
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) {
      var skuId = keys[i];
      var sku = ctx.getSku(skuId);
      if (!sku) return { ok: false, error: '色码不存在：' + skuId };
      var real = parseInt(counts[skuId], 10);
      if (isNaN(real) || real < 0) return { ok: false, error: '实盘数不合法：' + (counts[skuId] || '空') };
      var book = sku.stock || 0;
      var diff = real - book;
      items.push({
        skuId: skuId,
        styleCode: sku.styleCode,
        color: sku.color,
        size: sku.size,
        bookQty: book,
        realQty: real,
        diff: diff,
        costSnapshot: priceOf(ctx, sku)
      });
    }

    var no = docNoStr;
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.STOCKTAKE,
      styleCode: input.styleCode || '',
      items: items,
      diffCount: items.filter(function (it) {
        return it.diff !== 0;
      }).length,
      diffQty: items.reduce(function (t, it) {
        return t + it.diff;
      }, 0),
      note: input.note || '',
      voided: false,
      createdAt: util.nowISO()
    };

    var results = [];
    items.forEach(function (it) {
      if (it.diff !== 0) {
        results.push(inv.changeStock(ctx, it.skuId, it.diff, schema.DOC.STOCKTAKE, no, date));
      }
    });
    var bad = results.filter(function (r) {
      return !r.ok;
    });

    ctx.data.stocktakes = ctx.data.stocktakes || [];
    ctx.data.stocktakes.push(doc);
    ctx.touch('stocktakes', doc);

    return {
      ok: bad.length === 0,
      doc: doc,
      errors: bad.map(function (r) {
        return r.error;
      })
    };
  };

  /** 取色码的当前进价（色码覆盖 > 款进价） */
  function priceOf(ctx, sku) {
    if (sku.costPrice !== null && sku.costPrice !== undefined) return sku.costPrice;
    var p = ctx.getProduct(sku.styleCode);
    return p ? p.costPrice || 0 : 0;
  }
  inv.costOf = priceOf;

  inv.salePriceOf = function salePriceOf(ctx, sku) {
    if (sku.price !== null && sku.price !== undefined) return sku.price;
    var p = ctx.getProduct(sku.styleCode);
    return p ? p.salePrice || 0 : 0;
  };

  /** 库存资金占用 = Σ(当前库存 × 最新进价) */
  inv.stockValue = function stockValue(ctx) {
    var total = 0;
    (ctx.data.skus || []).forEach(function (sku) {
      total += (sku.stock || 0) * priceOf(ctx, sku);
    });
    return total;
  };

  /** 某款总库存 */
  inv.stockOfStyle = function stockOfStyle(ctx, styleCode) {
    return ctx.skusOf(styleCode).reduce(function (t, s) {
      return t + (s.stock || 0);
    }, 0);
  };

  /** 某色码的出入明细（按时间倒序） */
  inv.logsOfSku = function logsOfSku(ctx, skuId) {
    return util.sortBy(
      (ctx.data.stockLogs || []).filter(function (l) {
        return l.skuId === skuId;
      }),
      function (l) {
        return l.date + (l.id || '');
      },
      true
    );
  };

  return inv;
});
