/**
 * core/docNo.js —— 单据号生成
 * 规则：前缀 + yyyymmdd + '-' + 3 位流水，按日重置
 *   进货 P20260831-001   销售 S20260831-001   盘点 T20260831-001
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var mod = factory(util);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.docNo = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var PREFIX = { purchase: 'P', sale: 'S', stocktake: 'T', refund: 'S' };

  var docNo = { PREFIX: PREFIX };

  /** 某前缀 + 某天已用到的最大流水 */
  docNo.maxSeq = function maxSeq(prefix, date, docs) {
    var head = prefix + util.compactDate(date) + '-';
    var max = 0;
    (docs || []).forEach(function (d) {
      var no = String(d.no || '');
      if (no.indexOf(head) !== 0) return;
      var tail = no.slice(head.length);
      if (!/^\d+$/.test(tail)) return;
      var n = parseInt(tail, 10);
      if (n > max) max = n;
    });
    return max;
  };

  /** 下一个单号（按日重置，冲突顺延） */
  docNo.next = function next(prefix, date, docs) {
    var seq = docNo.maxSeq(prefix, date, docs) + 1;
    var no = prefix + util.compactDate(date) + '-' + util.pad(seq, 3);
    var taken = {};
    (docs || []).forEach(function (d) {
      taken[String(d.no)] = true;
    });
    while (taken[no]) {
      seq += 1;
      no = prefix + util.compactDate(date) + '-' + util.pad(seq, 3);
    }
    return no;
  };

  docNo.purchase = function (date, docs) {
    return docNo.next('P', date, docs);
  };
  docNo.sale = function (date, docs) {
    return docNo.next('S', date, docs);
  };
  docNo.stocktake = function (date, docs) {
    return docNo.next('T', date, docs);
  };

  return docNo;
});
