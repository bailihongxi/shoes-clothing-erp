/**
 * barcode/render.js —— 条码 → SVG / 1bpp 位图（PRD 11.4.2）
 *   按 DPI 计算模块宽，目标 ≥0.375mm（@203dpi ≈ ≥3px），下限 0.25mm；
 *   静区 ≥2.5mm（固定 10 模块）。
 *   纯函数部分（dimensions / svg / toGrid / toBitmap1bpp / barcodeBitmap）可在 Node 测；
 *   浏览器专属的 canvas PNG 导出另见 exportPNG（仅在浏览器生效）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = (root && root.ERP) || {};
  var barcode = E.barcode || (isNode ? require('../core/barcode.js') : null);
  var mod = factory(barcode, E);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.render = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (barcode, ERP) {
  'use strict';

  var MM_PER_INCH = 25.4;

  function mmToPx(mm, dpi) { return mm / MM_PER_INCH * dpi; }

  /**
   * 计算条码物理尺寸与像素
   * @returns {moduleMm, quietMm, modulePx, totalModules, quietModules, widthPx, heightPx, totalWidthMm, dpi, heightMm}
   */
  function dimensions(text, opts) {
    opts = opts || {};
    var dpi = opts.dpi || 203;
    // 默认 0.40mm：满足 PRD 10.7「4 字符款号模块宽 ≥0.40mm（实测 ≥3px @203dpi）」
    var moduleMm = opts.moduleMm || 0.40;
    var quietMm = (opts.quietMm != null) ? opts.quietMm : 2.5;
    var heightMm = opts.heightMm || 10;
    var enc = barcode.code128Encode(text);
    var quietModules = enc.quietModules;
    var totalModules = enc.totalModules + quietModules * 2;
    var modulePx = mmToPx(moduleMm, dpi);
    return {
      moduleMm: moduleMm,
      quietMm: quietMm,
      quietModules: quietModules,
      modulePx: modulePx,
      totalModules: totalModules,
      heightMm: heightMm,
      dpi: dpi,
      widthPx: Math.round(totalModules * modulePx),
      heightPx: Math.round(mmToPx(heightMm, dpi)),
      totalWidthMm: totalModules * moduleMm
    };
  }

  /**
   * 生成 SVG 字符串（不依赖 DOM，Node 可生成字符串用于校验）
   * @returns {string} <svg ...>...</svg>
   */
  function svg(text, opts) {
    opts = opts || {};
    var dims = dimensions(text, opts);
    var modulePx = dims.modulePx;
    var H = dims.heightPx;
    var W = dims.widthPx;
    var enc = barcode.code128Encode(text);
    var rects = [];
    var x = 0;
    for (var i = 0; i < enc.modules.length; i++) {
      var w = enc.modules[i] * modulePx;
      if (i % 2 === 0) { // 条（黑）
        rects.push('<rect x="' + round(x) + '" y="0" width="' + round(w) + '" height="' + H + '"/>');
      }
      x += w;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + round(W) + '" height="' + H +
      '" viewBox="0 0 ' + round(W) + ' ' + H + '" shape-rendering="crispEdges">' +
      '<rect width="' + round(W) + '" height="' + H + '" fill="#fff"/>' +
      '<g fill="#000">' + rects.join('') + '</g></svg>';
  }

  function round(n) { return Math.round(n * 100) / 100; }

  /**
   * 将条码展开为 0/1 网格（模块分辨率，含静区），rows 行（默认 1，即单行条码）
   * @returns {Array<Array<0|1>>} grid[row][col]，1=黑
   */
  function toGrid(text, opts) {
    opts = opts || {};
    var enc = barcode.code128Encode(text);
    var cols = enc.totalModules + enc.quietModules * 2;
    var rows = opts.rows || 1;
    var bars = []; // 每列是否为条
    for (var c = 0; c < cols; c++) {
      var inSymbol = c >= enc.quietModules && c < enc.quietModules + enc.totalModules;
      var isBar = inSymbol && ((c - enc.quietModules) % 2 === 0);
      bars.push(isBar ? 1 : 0);
    }
    var grid = [];
    for (var r = 0; r < rows; r++) {
      grid.push(bars.slice());
    }
    return grid;
  }

  /**
   * 把 0/1 网格打包成 1-bit 位图（每行 MSB 在前）
   * @returns {bytes:number[], widthBytes:number, widthPx:number, heightPx:number}
   */
  function toBitmap1bpp(grid) {
    if (!grid || !grid.length) return { bytes: [], widthBytes: 0, widthPx: 0, heightPx: 0 };
    var heightPx = grid.length;
    var widthPx = grid[0].length;
    var widthBytes = Math.ceil(widthPx / 8);
    var bytes = [];
    for (var r = 0; r < heightPx; r++) {
      var row = grid[r];
      for (var b = 0; b < widthBytes; b++) {
        var byte = 0;
        for (var bit = 0; bit < 8; bit++) {
          var col = b * 8 + bit;
          if (col >= widthPx) break;
          if (row[col]) byte |= (0x80 >> bit);
        }
        bytes.push(byte);
      }
    }
    return { bytes: bytes, widthBytes: widthBytes, widthPx: widthPx, heightPx: heightPx };
  }

  /** 便捷：条码 → 1bpp 位图（含静区，rows 行高） */
  function barcodeBitmap(text, opts) {
    opts = opts || {};
    var rows = opts.rows || 1;
    var grid = toGrid(text, { rows: rows });
    return toBitmap1bpp(grid);
  }

  /** 浏览器：导出 PNG（依赖 canvas，仅浏览器） */
  function exportPNG(text, opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || !document.createElement) return null;
    var dims = dimensions(text, opts);
    var canvas = document.createElement('canvas');
    canvas.width = dims.widthPx;
    canvas.height = dims.heightPx;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    var enc = barcode.code128Encode(text);
    var x = 0;
    for (var i = 0; i < enc.modules.length; i++) {
      var w = enc.modules[i] * dims.modulePx;
      if (i % 2 === 0) ctx.fillRect(Math.round(x), 0, Math.ceil(w), dims.heightPx);
      x += w;
    }
    return canvas.toDataURL('image/png');
  }

  return {
    MM_PER_INCH: MM_PER_INCH,
    dimensions: dimensions,
    svg: svg,
    toGrid: toGrid,
    toBitmap1bpp: toBitmap1bpp,
    barcodeBitmap: barcodeBitmap,
    exportPNG: exportPNG
  };
});
