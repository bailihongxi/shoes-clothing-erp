/**
 * barcode/label.js —— 40×30mm 标签版式（PRD 11.4.2）
 *   内容（自上而下）：店名 → 产品名 → 颜色+号码 → 价格 → 条码 → 条码下方数字（款号）。
 *   buildLabelData / labelPages / html 为纯函数；renderLabel（canvas）为浏览器专属。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = (root && root.ERP) || {};
  var mod = factory(E);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.label = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP) {
  'use strict';

  /** 金额分 → ¥xx.xx */
  function moneyText(fen) {
    fen = Number(fen) || 0;
    return '¥' + (fen / 100).toFixed(2);
  }

  /**
   * 由单个色码 SKU（含其所属款的 name / 售价）构建标签数据
   * @param {object} input { name, styleCode, color, size, salePrice(分), barcode? , shop? }
   */
  function buildLabelData(input, opts) {
    opts = opts || {};
    input = input || {};
    var shop = opts.shop || '我的鞋服店';
    return {
      shop: String(shop),
      name: String(input.name || ''),
      styleCode: String(input.styleCode || input.barcode || ''),
      color: String(input.color || ''),
      size: String(input.size || ''),
      priceText: moneyText(input.salePrice),
      barcode: String(input.barcode || input.styleCode || ''),
      widthMm: opts.widthMm || 40,
      heightMm: opts.heightMm || 30
    };
  }

  /** 由一组 SKU 生成标签数组（每个色码一张） */
  function labelPages(skus, opts) {
    skus = skus || [];
    return skus.map(function (s) { return buildLabelData(s, opts); });
  }

  /** 单张标签 HTML（用于打印页与预览） */
  function labelHTML(d, opts) {
    opts = opts || {};
    var cls = opts.cls || 'label';
    return '<div class="' + cls + '" style="width:' + d.widthMm + 'mm;height:' + d.heightMm + 'mm">' +
      '<div class="lb-shop">' + esc(d.shop) + '</div>' +
      '<div class="lb-name">' + esc(d.name) + '</div>' +
      '<div class="lb-cs">' + esc(d.color) + ' / ' + esc(d.size) + '</div>' +
      '<div class="lb-price">' + esc(d.priceText) + '</div>' +
      '<div class="lb-barcode" data-barcode="' + esc(d.barcode) + '"></div>' +
      '<div class="lb-code">' + esc(d.styleCode) + '</div>' +
      '</div>';
  }

  /** 整页打印 HTML：N 张标签 */
  function printPage(labels, opts) {
    opts = opts || {};
    var body = (labels || []).map(function (d) { return labelHTML(d, opts); }).join('\n');
    return '<!doctype html><html><head><meta charset="utf-8"><title>标签打印</title>' +
      '<link rel="stylesheet" href="css/print.css"></head><body class="print-body">' +
      body + '</body></html>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    buildLabelData: buildLabelData,
    labelPages: labelPages,
    labelHTML: labelHTML,
    printPage: printPage,
    moneyText: moneyText
  };
});
