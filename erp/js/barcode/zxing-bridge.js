/**
 * barcode/zxing-bridge.js —— 本项目自研 ZXing 解码桥（参考家电版思路，独立实现，未引入其他项目文件）
 * 目的：官方 @zxing/library（vendor/zxing.min.js）不提供 decodeCanvas 直调函数。
 * 本桥在官方库上挂载 window.ZXing.decodeCanvas(canvas) → string|null，单次同步调用。
 * 识别策略（均为独立实现）：
 *   ① HybridBinarizer（默认，块状阈值，普通场景）
 *   ② GlobalHistogramBinarizer（条码稀疏 / 低对比照片更稳）
 *   ③ InvertedLuminanceSource 反色（白底黑条反转为黑底白条）
 *   ④ 自动增强重试（真实照片关键路径）：
 *       行带定位（黑占比最长连续带）→ 裁剪 → 最近邻缩放至长边 ≈800 →
 *       四周补 ~9% 白边静区 → 再次 Hybrid/Global/反色。
 *      背景：用户实测条码照片（1175×664，条码贴顶、右侧静区不足）原尺寸 ZXing 全拒，
 *      仅「裁剪条码带 + 缩放 + 白边」可稳定解出（已浏览器实测 5012345678900）。
 * 每次尝试：POSSIBLE_FORMATS 收窄一维条码+QR + TRY_HARDER（模糊/倾斜提升）。
 * 依赖：vendor/zxing.min.js（官方 @zxing/library 0.21.x UMD，全局 ZXing）。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.zxingBridge = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FORMATS = null;

  function buildHints(Z) {
    if (!FORMATS && Z.DecodeHintType && Z.BarcodeFormat) {
      FORMATS = [
        Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A,
        Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_E,
        Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39,
        Z.BarcodeFormat.CODE_93, Z.BarcodeFormat.ITF,
        Z.BarcodeFormat.QR_CODE
      ];
    }
    // 0.21.x 的 decode(bitmap, hints) 内部按 Map 访问（hints.get），传普通对象会抛错被吞
    var hints = new Map();
    if (FORMATS && Z.DecodeHintType) {
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, FORMATS);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
    }
    return hints;
  }

  function decodeBitmap(Z, bitmap) {
    var reader = new Z.MultiFormatReader();
    var res = reader.decode(bitmap, buildHints(Z));
    if (res) {
      var t = res.getText ? res.getText() : (res.text || null);
      return t || null;
    }
    return null;
  }

  function createGrayClass(Z) {
    var Base = Z.LuminanceSource;
    var Cls = (function () {
      var C = function GraySource(w, h, gray) {
        Base.call(this, w, h);
        this._gray = gray;
      };
      // 官方基类为 ES6 class，Base.call 不可用 → 用 class 继承
      try {
        var Modern = class GraySource extends Base {
          constructor(w, h, gray) { super(w, h); this._gray = gray; }
          getRow(y, row) {
            var g = this._gray;
            var w = this.getWidth();
            if (!row || row.length < w) row = new Uint8ClampedArray(w);
            for (var i = 0; i < w; i++) row[i] = g[y * w + i];
            return row;
          }
          getMatrix() { return this._gray; }
          isCropSupported() { return false; }
        };
        Modern.prototype.constructor = Modern;
        return Modern;
      } catch (e) {
        return C;
      }
    })();
    Z.__graySourceClass = Cls;
    return Cls;
  }

  function grayClassOf(Z) {
    if (typeof Z.LuminanceSource !== 'function') return null;
    return (typeof Z.__graySourceClass === 'function') ? Z.__graySourceClass : createGrayClass(Z);
  }

  /** canvas → 灰度数组（RGBA 标准加权；getImageData 失败/污染返回 null） */
  function canvasGray(canvas) {
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    var w = canvas.width, h = canvas.height;
    if (!w || !h) return null;
    var imgData = ctx.getImageData(0, 0, w, h);
    var d = imgData.data;
    var gray = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
    }
    return { gray: gray, w: w, h: h };
  }

  /** 直接用灰度数组解码（Hybrid/Global/反色），返回文本或 null */
  function decodeGrayArray(Z, gray, w, h, useGlobal, inverted) {
    try {
      var GraySource = grayClassOf(Z);
      if (!GraySource) return null;
      var lum = new GraySource(w, h, gray);
      var src = lum;
      if (inverted) src = new Z.InvertedLuminanceSource(lum);
      var bin = useGlobal ? new Z.GlobalHistogramBinarizer(src) : new Z.HybridBinarizer(src);
      return decodeBitmap(Z, new Z.BinaryBitmap(bin));
    } catch (e) {
      return null;
    }
  }

  /** 行带定位：黑占比 > 0.08 的最长连续行带（条码区）；无则 null */
  function locateBand(gray, w, h) {
    var rowBlack = new Float32Array(h);
    for (var y = 0; y < h; y++) {
      var cnt = 0;
      for (var x = 0; x < w; x++) if (gray[y * w + x] < 128) cnt++;
      rowBlack[y] = cnt / w;
    }
    var y0 = -1, y1 = -1, best = 0, sy = -1;
    for (var y = 0; y < h; y++) {
      if (rowBlack[y] > 0.08) { if (sy < 0) sy = y; }
      else if (sy >= 0) {
        var len = y - sy;
        if (len > best) { best = len; y0 = sy; y1 = y; }
        sy = -1;
      }
    }
    if (sy >= 0) { var len = h - sy; if (len > best) { best = len; y0 = sy; y1 = h; } }
    if (y0 < 0 || (y1 - y0) < Math.max(10, h * 0.04)) return null;
    return { y0: y0, y1: y1 };
  }

  /**
   * 增强预处理：裁剪条码行带 + 最近邻缩放（长边≈target）+ 四周白边静区。
   * 返回 {gray, w, h}；任何一步异常返回 null。
   */
  function enhanceGray(gray, w, h, target) {
    var band = locateBand(gray, w, h);
    if (!band) return null;
    var rh = band.y1 - band.y0;
    if (rh < 8 || w < 60) return null;
    target = target || 800;
    var sc = target / Math.max(w, rh);
    var nw = Math.max(60, Math.round(w * sc));
    var nh = Math.max(20, Math.round(rh * sc));
    var pad = Math.max(12, Math.round(Math.max(nw, nh) * 0.09));
    var cw = nw + pad * 2, chh = nh + pad * 2;
    var out = new Uint8ClampedArray(cw * chh);
    out.fill(255);
    for (var yy = 0; yy < nh; yy++) {
      var sy = band.y0 + Math.min(rh - 1, (yy * rh / nh) | 0);
      var ro = (yy + pad) * cw + pad;
      var so = sy * w;
      for (var xx = 0; xx < nw; xx++) {
        var sx = Math.min(w - 1, (xx * w / nw) | 0);
        out[ro + xx] = gray[so + sx];
      }
    }
    return { gray: out, w: cw, h: chh };
  }

  /** 完整解码流水线：原尺寸 → 自动增强 → 反色变体 */
  function decodeCanvas(canvas) {
    var Z = (typeof window !== 'undefined') ? window.ZXing : null;
    if (!Z || !canvas) return null;
    if (typeof Z.LuminanceSource !== 'function') return null;
    // ① 原尺寸（Hybrid → Global）
    var r = decodeCanvasAt(Z, canvas, false, false);
    if (r) return r;
    r = decodeCanvasAt(Z, canvas, true, false);
    if (r) return r;
    // ② 原尺寸反色
    r = decodeCanvasAt(Z, canvas, false, true);
    if (r) return r;
    // ③ 自动增强：行带定位 + 缩放 + 白边
    var g = canvasGray(canvas);
    if (!g) return null;
    var en = enhanceGray(g.gray, g.w, g.h, 800);
    if (en) {
      r = decodeGrayArray(Z, en.gray, en.w, en.h, false, false);
      if (r) return r;
      r = decodeGrayArray(Z, en.gray, en.w, en.h, true, false);
      if (r) return r;
      r = decodeGrayArray(Z, en.gray, en.w, en.h, false, true);
      if (r) return r;
      // ④ 增强图再反色（白底黑条照片的兜底）
      r = decodeGrayArray(Z, en.gray, en.w, en.h, true, true);
      if (r) return r;
    }
    return null;
  }

  function decodeCanvasAt(Z, canvas, useGlobal, inverted) {
    try {
      var GraySource = grayClassOf(Z);
      if (!GraySource) return null;
      var ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx || typeof ctx.getImageData !== 'function') return null;
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      var imgData = ctx.getImageData(0, 0, w, h);
      var d = imgData.data;
      var gray = new Uint8ClampedArray(w * h);
      for (var i = 0, j = 0; i < d.length; i += 4, j++) {
        gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
      }
      var lum = new GraySource(w, h, gray);
      var src = lum;
      if (inverted) src = new Z.InvertedLuminanceSource(lum);
      var bin = useGlobal ? new Z.GlobalHistogramBinarizer(src) : new Z.HybridBinarizer(src);
      return decodeBitmap(Z, new Z.BinaryBitmap(bin));
    } catch (e) {
      return null;
    }
  }

  /** 挂载 decodeCanvas 到官方 ZXing 全局（幂等：已存在则不覆盖） */
  function install(Z) {
    if (Z && !Z.decodeCanvas) {
      Z.decodeCanvas = decodeCanvas;
    }
    return Z;
  }

  if (typeof window !== 'undefined' && window.ZXing) install(window.ZXing);

  return {
    decodeCanvas: decodeCanvas,
    install: install,
    // 测试/诊断用内部件
    locateBand: locateBand,
    enhanceGray: enhanceGray,
    canvasGray: canvasGray
  };
});
