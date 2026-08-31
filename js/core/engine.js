/**
 * core/engine.js —— 单据事务编排层
 * 「单据是唯一事实来源」：一张单据保存 = 库存 + 流水 + 欠款 三本账同时更新。
 * 本层只操作 ctx（纯数据），落库由 store/repo 负责，因此可在 Node 中完整测试。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('./util.js') : null),
    E.schema || (isNode ? require('./schema.js') : null),
    E.docNo || (isNode ? require('./docNo.js') : null),
    E.inventory || (isNode ? require('./inventory.js') : null),
    E.ledger || (isNode ? require('./ledger.js') : null),
    E.debt || (isNode ? require('./debt.js') : null),
    E.cart || (isNode ? require('./cart.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.engine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema, docNo, inv, ledger, debt, cart, repo, ERP) {
  'use strict';

  var engine = {};

  /**
   * 拿到操作日志写入器（兜底顺序问题）：
   *   浏览器下 engine.js 可能在 store/repo.js 之前加载，导致 factory 拿到的 repo 为 null；
   *   一旦用户点击保存，函数真正执行时 ERP.repo 早已就绪，所以延迟读取。
   */
  function repoRef() {
    var r = (ERP && ERP.repo) || repo;
    return (r && typeof r.log === 'function') ? r : null;
  }
  /** 写入操作日志（兜底：repo 暂未注入时不抛错，仅落 console.warn） */
  function writeLog(ctx, action, detail) {
    var r = repoRef();
    if (r && typeof r.log === 'function') { r.log(ctx, action, detail); return; }
    if (typeof console !== 'undefined') {
      console.warn('[操作日志未写入] ' + action + ' ' + (detail || ''));
    }
  }
  function err(msg) {
    return { ok: false, error: msg };
  }

  /* =========================================================
   *  进货单
   * ========================================================= */

  /**
   * @param input {date, partnerId|partnerName, phone, items:[{skuId, qty, costPrice}], paid, note}
   */
  engine.savePurchase = function savePurchase(ctx, input) {
    input = input || {};
    var date = input.date || util.today();
    var items = (input.items || []).filter(function (it) {
      return it && it.skuId && parseInt(it.qty, 10) > 0;
    });
    if (!items.length) return err('请至少录入一行进货明细，数量须大于 0');

    var partner = null;
    if (input.partnerId) partner = ctx.getPartner(input.partnerId);
    if (!partner && (input.partnerName || '').trim()) {
      partner = debt.ensurePartner(ctx, { name: input.partnerName, type: 'supplier', phone: input.phone });
    }
    if (!partner) return err('请选择或新建供应商');

    // 先校验，避免改了一半库存
    var checked = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var sku = ctx.getSku(it.skuId);
      if (!sku) return err('色码不存在：' + it.skuId);
      var cost = util.parseMoney(it.costPrice);
      if (cost < 0) return err('进货单价不能为负');
      checked.push({
        skuId: sku.id,
        styleCode: sku.styleCode,
        color: sku.color,
        size: sku.size,
        qty: parseInt(it.qty, 10),
        costPrice: cost,
        amount: cost * parseInt(it.qty, 10)
      });
    }

    var total = util.sum(checked, function (c) {
      return c.amount;
    });
    var paid = util.parseMoney(input.paid);
    if (paid < 0) paid = 0;
    if (paid > total) paid = total;
    var debtAmount = total - paid;

    var no = input.no || docNo.purchase(date, ctx.data.purchases);
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.PURCHASE,
      partnerId: partner.id,
      partnerName: partner.name,
      items: checked,
      total: total,
      paid: paid,
      debt: debtAmount,
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applyPurchase(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '库存更新失败');

    ctx.data.purchases = ctx.data.purchases || [];
    ctx.data.purchases.push(doc);
    ctx.touch('purchases', doc);

    // 最新进价回写档案（库存资金占用按最新进价算）
    checked.forEach(function (c) {
      var p = ctx.getProduct(c.styleCode);
      if (p) {
        p.costPrice = c.costPrice;
        ctx.touch('products', p);
      }
      var sku = ctx.getSku(c.skuId);
      if (sku) {
        sku.costPrice = c.costPrice;
        ctx.touch('skus', sku);
      }
    });

    ledger.fromPurchase(ctx, doc);
    debt.applyPurchase(ctx, doc);
    writeLog(ctx, '保存进货单', doc.no + ' 共 ' + util.fmtYuan(doc.total) + '，欠款 ' + util.fmtYuan(doc.debt));

    return { ok: true, doc: doc };
  };

  /** 进货单作废：库存回滚、流水作废、欠款冲回，全部留痕 */
  engine.voidPurchase = function voidPurchase(ctx, no) {
    var doc = ctx.getDoc('purchases', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('该单已作废');

    var rev = inv.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    if (!rev.ok) return err((rev.errors || []).join('；') || '库存回滚失败（库存可能已不足）');

    ledger.voidByRef(ctx, no);
    debt.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    doc.voided = true;
    doc.voidedAt = util.nowISO();
    ctx.touch('purchases', doc);
    writeLog(ctx, '作废进货单', doc.no + '，库存与欠款已回滚');
    return { ok: true, doc: doc };
  };

  function revertPurchaseEffects(ctx, doc) {
    inv.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    ledger.voidByRef(ctx, doc.no);
    debt.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
  }

  /* =========================================================
   *  销售开单（销售 / 赠送 同一张单）
   * ========================================================= */

  /**
   * @param input {
   *   date, partnerId|partnerName, phone,
   *   items:[{skuId, qty, price(元或分), type:'sale'|'gift', giftReason, costSnapshot?(分)}],
   *   discount(元或分), payments:[{method, amount(元或分)}], note
   * }
   * 注意：price/discount/payments 支持「元」字符串或「分」数字，统一由 util.parseMoney 转分。
   */
  engine.saveSale = function saveSale(ctx, input) {
    input = input || {};
    var date = input.date || util.today();

    var rawItems = (input.items || []).filter(function (it) {
      return it && it.skuId && parseInt(it.qty, 10) > 0;
    });
    if (!rawItems.length) return err('请至少添加一行商品（数量须大于 0）');

    var partner = null;
    if (input.partnerId) partner = ctx.getPartner(input.partnerId);
    if (!partner && (input.partnerName || '').trim()) {
      partner = debt.ensurePartner(ctx, { name: input.partnerName, type: 'customer', phone: input.phone });
    }

    // 先校验并补全明细，避免改了一半库存
    var checked = [];
    for (var i = 0; i < rawItems.length; i++) {
      var it = rawItems[i];
      var sku = ctx.getSku(it.skuId);
      if (!sku) return err('色码不存在：' + it.skuId);
      var product = ctx.getProduct(sku.styleCode);
      var isGift = it.type === schema.DOC.GIFT;
      var price = isGift ? 0 : util.parseMoney(it.price);
      if (!isGift && price < 0) return err('售价不能为负');
      var cost = it.costSnapshot !== undefined && it.costSnapshot !== null && it.costSnapshot !== ''
        ? Math.round(it.costSnapshot)
        : (sku.costPrice !== undefined && sku.costPrice !== null ? sku.costPrice
          : (product ? product.costPrice || 0 : 0));
      checked.push({
        skuId: sku.id,
        styleCode: sku.styleCode,
        color: sku.color,
        size: sku.size,
        qty: parseInt(it.qty, 10),
        price: price,
        costSnapshot: cost,
        type: isGift ? schema.DOC.GIFT : schema.DOC.SALE,
        giftReason: isGift ? (it.giftReason || schema.GIFT_REASONS[0]) : null
      });
    }

    var discount = util.parseMoney(input.discount);
    var payments = (input.payments || []).map(function (p) {
      return { method: p.method, amount: util.parseMoney(p.amount) };
    });
    var calc = cart.compute(checked, { discount: discount, payments: payments });

    var no = input.no || docNo.sale(date, ctx.data.sales);
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.SALE,
      partnerId: partner ? partner.id : null,
      partnerName: partner ? partner.name : '',
      items: checked,
      discount: calc.discount,
      payable: calc.payable,
      received: calc.received,
      debt: calc.debt,
      payments: payments.filter(function (p) {
        return p.method !== 'debt' && p.amount > 0;
      }).map(function (p) {
        return { method: p.method, amount: p.amount };
      }),
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applySale(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '库存不足，无法出库');

    ctx.data.sales = ctx.data.sales || [];
    ctx.data.sales.push(doc);
    ctx.touch('sales', doc);

    ledger.fromSale(ctx, doc);
    if (partner && doc.debt) debt.applySale(ctx, doc);
    writeLog(ctx, '保存销售单', doc.no + ' 应收 ' + util.fmtYuan(doc.payable) +
      (doc.debt ? '，欠款 ' + util.fmtYuan(doc.debt) : '') +
      (doc.items.some(function (x) {
        return x.type === schema.DOC.GIFT;
      }) ? '（含赠送）' : ''));

    return { ok: true, doc: doc };
  };

  /** 销售单作废：库存回滚、流水作废、欠款冲回，全部留痕 */
  engine.voidSale = function voidSale(ctx, no) {
    var doc = ctx.getDoc('sales', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('该单已作废');

    var rev = inv.reverseDoc(ctx, doc, doc.type);
    if (!rev.ok) return err((rev.errors || []).join('；') || '库存回滚失败');

    ledger.voidByRef(ctx, no);
    if (doc.partnerId && doc.debt) debt.reverseDoc(ctx, doc, doc.type);
    doc.voided = true;
    doc.voidedAt = util.nowISO();
    ctx.touch('sales', doc);
    writeLog(ctx, '作废销售单', doc.no + '，库存与欠款已回滚');
    return { ok: true, doc: doc };
  };

  /**
   * 销售退货（红冲）：原单红冲生成退货单
   * @param input { originalNo, items:[{skuId, qty}], note }
   *   不传 items 或 items 为空 = 整单退；传 items 指定每色码退货数量（部分退）
   */
  engine.refundSale = function refundSale(ctx, input) {
    input = input || {};
    var original = ctx.getDoc('sales', input.originalNo);
    if (!original) return err('原销售单不存在：' + input.originalNo);
    if (original.voided) return err('原单已作废，不能退货');
    if (original.type === schema.DOC.REFUND) return err('退货单不能再退货');

    // 计算每行的可退数量（原单未退部分）
    var returnedOf = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== schema.DOC.REFUND || s.voided) return;
      if (s.refNo !== original.no) return;
      s.items.forEach(function (ri) {
        returnedOf[ri.skuId] = (returnedOf[ri.skuId] || 0) + ri.qty;
      });
    });

    var pick = {};
    (input.items || []).forEach(function (ri) {
      var q = parseInt(ri.qty, 10);
      if (q > 0) pick[ri.skuId] = q;
    });
    // 指定了 items = 部分退（只退列出的色码）；未指定 = 整单退
    var hasPick = (input.items || []).length > 0;

    var items = [];
    var any = false;
    for (var i = 0; i < original.items.length; i++) {
      var oi = original.items[i];
      var maxQty = oi.qty - (returnedOf[oi.skuId] || 0);
      if (maxQty <= 0) continue;
      if (hasPick) {
        if (pick[oi.skuId] === undefined) continue; // 部分退：未选中的行不退
        var qty = Math.min(pick[oi.skuId], maxQty);
        if (qty <= 0) continue;
      } else {
        var qty2 = maxQty;
      }
      any = true;
      items.push({
        skuId: oi.skuId,
        styleCode: oi.styleCode,
        color: oi.color,
        size: oi.size,
        qty: hasPick ? qty : qty2,
        price: oi.price || 0,
        costSnapshot: oi.costSnapshot || 0,
        type: schema.DOC.SALE,
        giftReason: null
      });
    }
    if (!any) return err('没有可退的商品');

    var refundValue = items.reduce(function (t, it) {
      return t + (it.price || 0) * it.qty;
    }, 0);

    var no = docNo.sale(util.today(), ctx.data.sales);
    var doc = {
      no: no,
      date: input.date || util.today(),
      type: schema.DOC.REFUND,
      refNo: original.no,
      partnerId: original.partnerId || null,
      partnerName: original.partnerName || '',
      items: items,
      discount: 0,
      payable: refundValue,
      received: 0,
      debt: 0,
      payments: [],
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applySale(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '退货入库失败');

    ctx.data.sales.push(doc);
    ctx.touch('sales', doc);

    // 财务冲减：原单已收现金部分 → 退货退款（红冲收入）；原单赊账部分 → 冲减客户应收
    var cashRefund = 0;
    var debtRefund = 0;
    if (original.received > 0) {
      cashRefund = Math.min(refundValue, original.received);
      if (cashRefund > 0) {
        ledger.add(ctx, {
          date: doc.date,
          type: schema.LEDGER.REFUND_OUT,
          amount: cashRefund,
          refType: schema.DOC.REFUND,
          refNo: doc.no,
          partnerId: doc.partnerId || null,
          note: '退货退款（红冲 ' + original.no + '）',
          auto: true
        });
      }
    }
    if (original.debt > 0) {
      debtRefund = Math.min(refundValue - cashRefund, original.debt);
      if (debtRefund > 0) {
        doc.debt = debtRefund;
        debt.applyRefund(ctx, doc);
      }
    }
    doc.cashRefund = cashRefund;
    doc.debtRefund = debtRefund;
    ctx.touch('sales', doc);

    writeLog(ctx, '销售退货', doc.no + '（红冲 ' + original.no + '）退 ' +
      util.fmtYuan(refundValue) + '，入库 ' + items.reduce(function (t, it) {
        return t + it.qty;
      }, 0) + ' 件');

    return { ok: true, doc: doc };
  };

  /**
   * 销售退换（退旧 + 换新）：直接与原销售单链接
   * - 退货部分：复用 refundSale 红冲原单并入库，doc.refNo = 原单号；
   * - 换货部分（可选）：把新商品作为一张销售单 saveSale，doc.exchangeOf = 原单号，
   *   并与退货单互为 exchangeLinked，实现「退换货 ↔ 原销售单」双向追溯。
   * 账面差额：退货红冲 −Vr，新销售 +Vp，净额 = Vp − Vr，与顾客实际收付差价一致。
   *
   * @param input {
   *   originalNo,
   *   returns: [{skuId, qty}],        // 从原单退/换出的商品（必填，至少一行 >0）
   *   replacements: [{skuId, qty, price(元/分)}], // 换新商品（换货时填）
   *   date, note, payments:[{method, amount}] // 换新销售单收款，缺省按全款现金
   * }
   */
  engine.exchange = function exchange(ctx, input) {
    input = input || {};
    var original = ctx.getDoc('sales', input.originalNo);
    if (!original) return err('原销售单不存在：' + input.originalNo);
    if (original.voided) return err('原单已作废，不能退换');
    if (original.type === schema.DOC.REFUND) return err('退货单不能再退换');

    // 计算原单每行的「还可退」数量（已退部分要扣掉）
    var returnedOf = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== schema.DOC.REFUND || s.voided) return;
      if (s.refNo !== original.no) return;
      s.items.forEach(function (ri) {
        returnedOf[ri.skuId] = (returnedOf[ri.skuId] || 0) + ri.qty;
      });
    });

    var pick = {};
    (input.returns || []).forEach(function (ri) {
      var q = parseInt(ri.qty, 10);
      if (q > 0) pick[ri.skuId] = q;
    });

    var returnItems = [];
    var anyReturn = false;
    var pickedFullyReturned = false; // 用户选了该色码，但原单该行已全部退完
    for (var i = 0; i < original.items.length; i++) {
      var oi = original.items[i];
      if (pick[oi.skuId] === undefined) continue; // 部分退：未选中的行不退
      var maxQty = oi.qty - (returnedOf[oi.skuId] || 0);
      if (maxQty <= 0) { pickedFullyReturned = true; continue; }
      var rq = Math.min(pick[oi.skuId], maxQty);
      if (rq <= 0) { pickedFullyReturned = true; continue; }
      anyReturn = true;
      returnItems.push({
        skuId: oi.skuId,
        styleCode: oi.styleCode,
        color: oi.color,
        size: oi.size,
        qty: rq,
        price: oi.price || 0,
        costSnapshot: oi.costSnapshot || 0,
        type: schema.DOC.SALE,
        giftReason: null
      });
    }
    if (!anyReturn) {
      if (pickedFullyReturned) return err('所选商品已无可退数量');
      return err('请先选择要退/换的商品');
    }

    // 解析换新商品（价格支持「元」字符串或「分」数字）。
    // 注意：priceFen 仅用于本函数内的校验与差额计算；传给 saveSale 的必须是「元」表示，
    // 由 saveSale 内部统一 parseMoney，避免重复转换把「分」当「元」放大 100 倍。
    var replItems = (input.replacements || []).filter(function (it) {
      return it && it.skuId && parseInt(it.qty, 10) > 0;
    }).map(function (it) {
      var sku = ctx.getSku(it.skuId);
      if (!sku) return { error: '色码不存在：' + it.skuId };
      var product = ctx.getProduct(sku.styleCode);
      var priceFen = util.parseMoney(it.price);
      if (priceFen < 0) return { error: '售价不能为负' };
      return {
        skuId: sku.id,
        styleCode: sku.styleCode,
        color: sku.color,
        size: sku.size,
        qty: parseInt(it.qty, 10),
        priceFen: priceFen,
        costSnapshot: sku.costPrice !== undefined && sku.costPrice !== null ? sku.costPrice
          : (product ? product.costPrice || 0 : 0),
        type: schema.DOC.SALE,
        giftReason: null
      };
    });
    var badRepl = replItems.filter(function (x) { return x.error; });
    if (badRepl.length) return err(badRepl.map(function (x) { return x.error; }).join('；'));

    // ① 先生成退货单（红冲原单、入库、冲减原单已收/欠款）
    var refundRes = engine.refundSale(ctx, {
      originalNo: original.no,
      items: returnItems.map(function (it) {
        return { skuId: it.skuId, qty: it.qty };
      }),
      note: input.note
    });
    if (!refundRes.ok) return refundRes; // 退货失败直接透传原因，不产生半成品
    var refundDoc = refundRes.doc;

    // ② 若有换新商品，生成销售单（与原单/退货单双向链接）
    var saleDoc = null;
    if (replItems.length) {
      var Vp = replItems.reduce(function (t, it) { return t + it.priceFen * it.qty; }, 0);
      var payments = (input.payments && input.payments.length)
        ? input.payments.map(function (p) {
          return { method: p.method, amount: util.parseMoney(p.amount) };
        })
        : [{ method: 'cash', amount: util.fenToYuan(Vp) }]; // 默认按全款现金记账，差额由退货红冲冲抵

      // 转回「元」交给 saveSale（内部再 parseMoney），避免重复转换
      var saleItems = replItems.map(function (it) {
        return {
          skuId: it.skuId,
          styleCode: it.styleCode,
          color: it.color,
          size: it.size,
          qty: it.qty,
          price: util.fenToYuan(it.priceFen),
          costSnapshot: it.costSnapshot,
          type: schema.DOC.SALE,
          giftReason: null
        };
      });

      var saleRes = engine.saveSale(ctx, {
        date: input.date || util.today(),
        partnerId: original.partnerId || null,
        partnerName: original.partnerName || '',
        items: saleItems,
        discount: 0,
        payments: payments,
        note: (input.note ? input.note + '；' : '') + '换货（红冲 ' + original.no + '）'
      });
      if (!saleRes.ok) {
        // 极少发生（退货已成功、库存已回补），稳妥回滚刚生成的退货单，避免半成品
        engine.voidSale(ctx, refundDoc.no);
        return saleRes;
      }
      saleDoc = saleRes.doc;
      saleDoc.exchangeOf = original.no;
      saleDoc.exchangeLinked = refundDoc.no;
      ctx.touch('sales', saleDoc);
    }

    // 双向链接：退货单也标注 exchangeOf / 关联销售单
    refundDoc.exchangeOf = original.no;
    refundDoc.exchangeLinked = saleDoc ? saleDoc.no : null;
    ctx.touch('sales', refundDoc);

    var Vr = returnItems.reduce(function (t, it) { return t + (it.price || 0) * it.qty; }, 0);
    var VpTotal = replItems.reduce(function (t, it) { return t + (it.priceFen || 0) * it.qty; }, 0);
    writeLog(ctx, '销售退换',
      '原单 ' + original.no + '：退 ' + util.fmtYuan(Vr) + ' / ' +
      (saleDoc ? ('换 ' + util.fmtYuan(VpTotal) + '，实收差价 ' + util.fmtYuan(VpTotal - Vr)) : '仅退货'));

    return { ok: true, refund: refundDoc, sale: saleDoc, net: VpTotal - Vr };
  };

  /** 修改进货单：仅未结清（有欠款）的单可改 */
  engine.updatePurchase = function updatePurchase(ctx, no, input) {
    var doc = ctx.getDoc('purchases', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('已作废的单据不能修改');
    if (!doc.debt) return err('该单已结清，不能修改（可先作废后重录）');

    revertPurchaseEffects(ctx, doc);
    var idx = ctx.data.purchases.indexOf(doc);
    if (idx >= 0) ctx.data.purchases.splice(idx, 1);

    var res = engine.savePurchase(ctx, Object.assign({}, input, { no: no, date: doc.date }));
    if (!res.ok) return res;
    writeLog(ctx, '修改进货单', no);
    return res;
  };

  /* =========================================================
   *  收付款登记（供应商付款 / 客户回款）
   * ========================================================= */

  /**
   * 登记一笔收付款：更新往来单位余额 + 写收支流水，二者原子联动。
   * @param input { partnerId, amount(元或分), date, isSupplier, note }
   */
  engine.settleAccount = function settleAccount(ctx, input) {
    input = input || {};
    var isSupplier = !!input.isSupplier;
    var st = debt.settle(ctx, {
      partnerId: input.partnerId,
      amount: input.amount,
      isSupplier: isSupplier,
      date: input.date
    });
    if (!st.ok) return st;
    ledger.fromSettle(ctx, {
      partnerId: input.partnerId,
      partnerName: st.partner ? st.partner.name : '',
      amount: util.parseMoney(input.amount),
      date: input.date,
      isSupplier: isSupplier,
      note: input.note
    });
    writeLog(ctx, isSupplier ? '供应商付款' : '客户回款',
      (st.partner ? st.partner.name : '') + ' ' + util.fmtYuan(st.paid) +
      (st.overpay ? '（多付 ' + util.fmtYuan(st.overpay) + '）' : ''));
    return { ok: true, settle: st };
  };

  /* =========================================================
   *  盘点
   * ========================================================= */

  /**
   * @param input {date, styleCode, counts:{skuId: 实盘数}, note}
   */
  engine.saveStocktake = function saveStocktake(ctx, input) {
    input = input || {};
    var date = input.date || util.today();
    var counts = input.counts || {};
    if (!Object.keys(counts).length) return err('请录入实盘数量');

    var no = docNo.stocktake(date, ctx.data.stocktakes);
    var res = inv.applyStocktake(ctx, { date: date, styleCode: input.styleCode, counts: counts, note: input.note }, no);
    if (!res.ok) return err(res.error);
    writeLog(ctx, '保存盘点单', no + ' 差异 ' + res.doc.diffQty + ' 件');
    return { ok: true, doc: res.doc };
  };

  return engine;
});
