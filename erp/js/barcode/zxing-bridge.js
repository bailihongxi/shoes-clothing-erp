/**
 * barcode/zxing-bridge.js —— 本项目自研 ZXing 解码桥（参考家电版思路，独立实现，未引入其他项目文件）
 * 目的：官方 @zxing/library（vendor/zxing.min.js）不提供 decodeCanvas 直调函数。
 * 本桥在官方库上挂载 window.ZXing.decodeCanvas(canvas) → string|null，单次同步调用。
 * 识别策略（借鉴「Hybrid/Global 双二值化 + 反色重试」思路，均为独立实现）：
 *   ① HybridBinarizer（默认，块状阈值，普通场景）
 *   ② GlobalHistogramBinarizer（条码稀疏 / 低对比照片更稳）
 *   ③ InvertedLuminanceSource 反色（白底黑条反转为黑底白条）
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
    var hints = {};
    if (FORMATS && Z.DecodeHintType) {
      hints[Z.DecodeHintType.POSSIBLE_FORMATS] = FORMATS;
      hints[Z.DecodeHintType.TRY_HARDER] = true;
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

  function tryBinarizer(Z, canvas, useGlobal) {
    try {
      var lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
      var bin = useGlobal ? new Z.GlobalHistogramBinarizer(lum) : new Z.HybridBinarizer(lum);
      return decodeBitmap(Z, new Z.BinaryBitmap(bin));
    } catch (e) {
      return null;
    }
  }

  /** 单次解码：Hybrid → GlobalHistogram → 反色重试，返回条码文本或 null */
  function decodeCanvas(canvas) {
    var Z = (typeof window !== 'undefined') ? window.ZXing : null;
    if (!Z || !canvas) return null;
    if (typeof Z.HTMLCanvasElementLuminanceSource !== 'function') return null;
    var r = tryBinarizer(Z, canvas, false);
    if (r) return r;
    r = tryBinarizer(Z, canvas, true);
    if (r) return r;
    try {
      var inv = new Z.InvertedLuminanceSource(new Z.HTMLCanvasElementLuminanceSource(canvas));
      var bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(inv));
      r = decodeBitmap(Z, bitmap);
      if (r) return r;
    } catch (e) { /* 反色失败不致命 */ }
    return null;
  }

  /** 挂载 decodeCanvas 到官方 ZXing 全局（幂等：已存在则不覆盖） */
  function install(Z) {
    if (Z && !Z.decodeCanvas) {
      Z.decodeCanvas = decodeCanvas;
    }
    return Z;
  }

  if (typeof window !== 'undefined' && window.ZXing) install(window.ZXing);

  return { decodeCanvas: decodeCanvas, install: install };
});
