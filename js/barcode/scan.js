/**
 * barcode/scan.js —— 扫码三级降级（PRD 11.6，V3 扫描增强）
 *   ① BarcodeDetector 实时预览（连续扫，Android Chrome；超时/异常自动切抓帧或降级）
 *   ② 拍照识别（<input type=file capture> → 多通道解码，file:// 也能用）
 *   ③ 手输条码数字（等价于扫码结果）
 *
 * 增强（借鉴进销存模板方案，独立实现）：
 *   - 多通道解码 decodeWith：原生 BarcodeDetector → 自研 EAN-13 → ZXing（若存在）
 *   - 实时 detect 超时保护（2.5s 挂起 → 切抓帧），异常 3 次切抓帧，黑屏 2.5s 降级，
 *     空帧 60 / 异常 5 / 12s 兜底降级到拍照/手输
 *   - 拍照解码：EAN-13 原图 + ±4° 旋转重试 → ZXing 压缩图（长边 ≤1280）→ 中心放大重试
 *   - 弹窗统一 onClose 释放摄像头（取消/切换/遮罩关闭均不残留摄像头占用）
 *
 * 纯逻辑部分（resolve / card / chooseMode / needDowngrade / ...）可在 Node 中测试；
 * 浏览器交互部分（start / photoInput / manualCard / openCard）仅在浏览器生效。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = (root && root.ERP) || {};
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.inventory || (isNode ? require('../core/inventory.js') : null),
    E.ui || (isNode ? require('../ui/components.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.scan = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, inv, ui, ERP) {
  'use strict';

  var scan = {};

  /** 原生通道超时保护：国产浏览器/鸿蒙 detect(video) 可能挂起 5-10s，超时强制切抓帧 */
  scan.NATIVE_TIMEOUT_MS = 2500;
  /** ZXing 纯 JS 解码长边上限：超大原图逐行扫描极慢，压缩后 <1s 且识别率更高 */
  scan.ZXING_MAX_EDGE = 1280;

  /** 归一化条码：去空白、转大写 */
  function norm(code) {
    return String(code == null ? '' : code).trim().toUpperCase();
  }

  /**
   * 解析扫码结果 → 定位商品
   * @returns {found, type:'style'|'sku', product, sku, styleCode, code}
   */
  scan.resolve = function resolve(ctx, code) {
    var c = norm(code);
    if (!c) return { found: false, code: c };
    var products = ctx.data.products || [];
    var sku = null;
    // ① 条码精确匹配：先查款级条码（款号），再查色码条码（同款同色共用一份）
    var p = products.find(function (x) {
      return String(x.barcode || '').toUpperCase() === c;
    });
    if (!p) {
      sku = (ctx.data.skus || []).find(function (s) {
        return String(s.barcode || '').toUpperCase() === c;
      });
      if (sku) p = ctx.getProduct(sku.styleCode);
    }
    // ② 款号匹配
    if (!p) p = ctx.getProduct(c);
    // ③ 色码 id 匹配（再反查款）
    if (!p) {
      sku = ctx.getSku(c);
      if (sku) p = ctx.getProduct(sku.styleCode);
    }
    if (p) {
      return { found: true, type: sku ? 'sku' : 'style', product: p, sku: sku, styleCode: p.styleCode, code: c };
    }
    return { found: false, code: c };
  };

  /**
   * 商品卡数据：售价 + 颜色×尺码库存矩阵 + 汇总 + 0 库存标记
   * @returns {product, colors, sizes, cells, totalStock, allZero} 或 null
   */
  scan.card = function card(ctx, styleCode) {
    var product = ctx.getProduct(styleCode);
    if (!product) return null;
    var m = inv.buildMatrix(ctx, styleCode);
    var totalStock = 0;
    Object.keys(m.cells).forEach(function (k) {
      totalStock += (m.cells[k].stock || 0);
    });
    return {
      product: product,
      colors: m.colors,
      sizes: m.sizes,
      cells: m.cells,
      totalStock: totalStock,
      allZero: totalStock <= 0,
      colorCount: m.colors.length,
      sizeCount: m.sizes.length,
      summary: '共 ' + m.colors.length + ' 色 ' + m.sizes.length + ' 个号码在库'
    };
  };

  /* ---------------- 浏览器交互（仅浏览器） ---------------- */

  function hasWindow() {
    return typeof window !== 'undefined' && window && typeof document !== 'undefined';
  }

  /** 决定扫码方式：同时满足「有 BarcodeDetector」与「安全上下文」才实时扫，否则走手动兜底 */
  scan.chooseMode = function chooseMode(detector, secure) {
    return (detector && secure !== false) ? 'realtime' : 'manual';
  };

  /** 实时识别支持的码制（缺省列表，兼容各平台；EAN-13 自研通道兜底） */
  scan.buildFormats = function buildFormats() {
    return ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
  };

  /**
   * 拍照解码通道优先级：原生 BarcodeDetector → ZXing（增强解码）→ 自研 EAN-13。
   * 顺序说明：V1.3-3 曾将 ean13 放在 zxing 前，但自研解码器对 JPEG 条码照片
   * 存在误读风险（实测 5012345678900 被误读为 1072305678900 且通过校验位）。
   * ZXing 增强通道（缩放+白边静区）经真实照片实测稳定解出正确码，故提升到 ean13 前。
   */
  scan.pickDecoders = function pickDecoders(env) {
    env = env || {};
    var order = [];
    if (env.native) order.push('native');
    if (env.zxing) order.push('zxing');
    if (env.ean13) order.push('ean13');
    return order;
  };

  /** 实时识别是否需要降级到拍照/手输 */
  scan.needDowngrade = function needDowngrade(stat) {
    stat = stat || {};
    if (stat.errorFrames >= 5) return true;
    if (stat.emptyFrames >= 60) return true;
    if (stat.firstEmptyAt && (Date.now() - stat.firstEmptyAt) >= 12000) return true;
    return false;
  };

  /** 黑屏判定：摄像头已启动但 2.5s 无实际画面帧（videoWidth=0） */
  scan.isBlackOut = function isBlackOut(videoWidth, startedAt, now) {
    return !videoWidth && (now - startedAt) >= 2500;
  };

  /** detect 异常是否计入降级计数：仅画面正常时（黑屏期间交给 isBlackOut） */
  scan.shouldCountError = function shouldCountError(videoWidth) {
    return videoWidth > 0;
  };

  /** 是否切到「抓帧识别」：实时 detect 连续异常 3 次（兼容 BarcodeDetector 半实现的国产浏览器） */
  scan.shouldSwitchFrame = function shouldSwitchFrame(mode, errorFrames) {
    return mode === 'video' && errorFrames >= 3;
  };

  /** 抓帧节流：距上次抓帧 >= interval(默认500ms) 才抓新帧 */
  scan.frameDue = function frameDue(lastFrameAt, now, interval) {
    return (now - lastFrameAt) >= (interval == null ? 500 : interval);
  };

  function hasNative() {
    return typeof window !== 'undefined' && !!window.BarcodeDetector;
  }
  function hasEan13() {
    return !!(window.ERP && window.ERP.ean13 && typeof window.ERP.ean13.decode === 'function');
  }
  function hasZxing() {
    return !!(window.ZXing && typeof window.ZXing.decodeCanvas === 'function');
  }

  /**
   * UPC-A（12 位纯数字）→ EAN-13（补前导 0），统一 13 位便于建档/匹配（V1.3-5）。
   * ZXing 对 0 开头的 EAN-13 常返回 12 位 UPC-A 文本；自研 ean13 恒返回 13 位。
   */
  scan.normalizeCode = function normalizeCode(text) {
    var s = String(text || '').trim();
    if (/^\d{12}$/.test(s)) return '0' + s;
    return s;
  };

  /**
   * 按需加载 vendor/zxing.min.js（约 336KB，V1.3-5 懒加载优化）。
   * 已就绪 → 立即 cb(true)；加载中 → 轮询等待；未加载 → 动态注入 <script>（SW 预缓存命中极快）。
   * 任何失败 → cb(false)（扫码主流程仍走 native/ean13，不阻塞）。
   */
  scan.ensureZxing = function ensureZxing(cb, timeoutMs) {
    cb = cb || function () {};
    if (typeof window === 'undefined' || typeof document === 'undefined') { cb(false); return; }
    if (window.ZXing && typeof window.ZXing.decodeCanvas === 'function') { cb(true); return; }
    timeoutMs = timeoutMs || 4000;
    if (scan.__zxingLoading) {
      var waited = 0;
      var iv = setInterval(function () {
        waited += 50;
        if (window.ZXing && typeof window.ZXing.decodeCanvas === 'function') {
          clearInterval(iv); cb(true); return;
        }
        if (waited >= timeoutMs) { clearInterval(iv); cb(false); }
      }, 50);
      return;
    }
    scan.__zxingLoading = true;
    var s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.async = true;
    s.onload = function () { scan.__zxingLoading = false; cb(true); };
    s.onerror = function () { scan.__zxingLoading = false; cb(false); };
    document.head.appendChild(s);
  };

  /** 原图 → 原始尺寸 canvas（自研 EAN-13 用原图精度，不缩放） */
  function toCanvas(source) {
    try {
      if (source && source.tagName === 'CANVAS') return source;
      if (source && source.tagName === 'IMG') {
        var w = source.naturalWidth || 0;
        var h = source.naturalHeight || 0;
        if (!w || !h) return null;
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(source, 0, 0, w, h);
        return c;
      }
      return null;
    } catch (e) { return null; }
  }

  /** 统一转为「适合解码的小 canvas」（长边 ≤ ZXING_MAX_EDGE，只缩小不放大） */
  function toDecodeCanvas(source) {
    try {
      var w = 0, h = 0, el = null;
      if (source && source.tagName === 'IMG') {
        w = source.naturalWidth; h = source.naturalHeight; el = source;
      } else if (source && source.tagName === 'CANVAS') {
        w = source.width; h = source.height; el = source;
      } else { return null; }
      if (!w || !h) return null;
      var scale = Math.min(1, scan.ZXING_MAX_EDGE / Math.max(w, h));
      if (scale >= 1) return source;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(el, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; }
  }

  /** canvas 旋转（白底补齐边缘），±4° 兜底手持倾斜 */
  function rotateCanvas(canvas, deg) {
    try {
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      var diag = Math.ceil(Math.sqrt(w * w + h * h));
      var c = document.createElement('canvas');
      c.width = diag;
      c.height = diag;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, diag, diag);
      ctx.translate(diag / 2, diag / 2);
      ctx.rotate(deg * Math.PI / 180);
      ctx.drawImage(canvas, -w / 2, -h / 2);
      return c;
    } catch (e) { return null; }
  }

  /** 自研 EAN-13 通道：原图 canvas → 灰度 → 多行投票解码；0° 失败 ±4° 旋转重试 */
  function ean13Decode(source, cb) {
    try {
      var canvas = toCanvas(source);
      if (!canvas) { cb(false); return; }
      var gray = window.ERP.ean13.grayFromCanvas(canvas);
      var r = gray ? window.ERP.ean13.decode(gray, canvas.width, canvas.height) : null;
      if (r && r.text) { cb(true, r.text); return; }
      for (var i = 0; i < 2; i++) {
        var rc = rotateCanvas(canvas, i === 0 ? -4 : 4);
        if (!rc) continue;
        var rg = window.ERP.ean13.grayFromCanvas(rc);
        var rr = rg ? window.ERP.ean13.decode(rg, rc.width, rc.height) : null;
        if (rr && rr.text) { cb(true, rr.text); return; }
      }
      cb(false);
    } catch (e) { cb(false); }
  }

  /** 原生通道（吃压缩后小图，快且稳） */
  function nativeDetect(source, cb) {
    try {
      var d = new window.BarcodeDetector();
      var canvas = toDecodeCanvas(source);
      if (!canvas) { cb(false); return; }
      d.detect(canvas).then(function (list) {
        if (list && list.length) cb(true, list[0].rawValue);
        else cb(false);
      }).catch(function () { cb(false); });
    } catch (e) { cb(false); }
  }

  /** ZXing 纯 JS 通道：window.ZXing.decodeCanvas（zxing-bridge 挂载，Hybrid/Global 双二值化+反色重试） */
  function zxingDecode(source, cb) {
    try {
      var canvas = toDecodeCanvas(source);
      if (!canvas) { cb(false); return; }
      var r = window.ZXing.decodeCanvas(canvas);
      if (r) cb(true, r);
      else cb(false);
    } catch (e) { cb(false); }
  }

  /** 中心区域放大重试：条码占照片比例小时，放大画面中心后识别率提升 */
  function zoomCenterCanvas(img, factor) {
    try {
      var w = img.naturalWidth || 640;
      var h = img.naturalHeight || 480;
      if (!w || !h) return null;
      var cw = Math.max(1, Math.round(w / factor));
      var ch = Math.max(1, Math.round(h / factor));
      var sx = Math.round((w - cw) / 2);
      var sy = Math.round((h - ch) / 2);
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
      return c;
    } catch (e) { return null; }
  }

  /**
   * 多通道解码（可注入实现，便于测试）：native（带超时保护）→ ean13 → zxing
   * @param source Image/canvas；done(ok, text)
   */
  scan.zxingDecode = zxingDecode; // 暴露给测试：真实官方库 API 路径
  scan.decodeWith = function decodeWith(source, done, impl) {    var env = impl || {
      native: { available: hasNative(), detect: nativeDetect },
      ean13: { available: hasEan13(), decode: ean13Decode },
      zxing: { available: hasZxing(), decode: zxingDecode }
    };
    var order = scan.pickDecoders({
      native: env.native && env.native.available,
      ean13: env.ean13 && env.ean13.available,
      zxing: env.zxing && env.zxing.available
    });
    if (!order.length) { done(false); return; }
    // V1.3-5：出口统一规范化（UPC-A 12 位 → EAN-13 13 位）
    var finalize = function (ok, text) { done(ok, ok ? scan.normalizeCode(text) : text); };
    var i = 0;
    function next() {
      if (i >= order.length) { done(false); return; }
      var kind = order[i++];
      if (kind === 'native') {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          next(); // 超时：跳过 native，交给下一通道
        }, scan.NATIVE_TIMEOUT_MS);
        try {
          env.native.detect(source, function (ok, text) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          next();
        }
      } else if (kind === 'ean13') {
        try {
          env.ean13.decode(source, function (ok, text) {
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) { next(); }
      } else {
        try {
          env.zxing.decode(source, function (ok, text) {
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) { next(); }
      }
    }
    next();
  };

  /** 统一释放摄像头流（幂等：无流/已停止均安全） */
  scan.closeCamera = function closeCamera(stream) {
    if (stream && typeof stream.getTracks === 'function') {
      var tracks = stream.getTracks();
      for (var i = 0; i < tracks.length; i++) {
        try { tracks[i].stop(); } catch (e) { /* 忽略单轨停止失败 */ }
      }
      return true;
    }
    return false;
  };

  /**
   * 启动扫码（三级降级）
   * @param opts { onResult(code), onError(msg) }
   */
  scan.start = function start(opts) {
    opts = opts || {};
    if (!hasWindow()) { if (opts.onError) opts.onError('当前环境不支持扫码'); return; }
    // V1.3-5：ZXing 懒加载预热（vendor/zxing.min.js 按需注入，SW 预缓存命中极快；
    // 加载失败不阻塞——native/ean13 通道兜底）
    scan.ensureZxing(function () {
      if (scan.chooseMode(window.BarcodeDetector, window.isSecureContext) === 'realtime') {
        realtime(opts);
      } else {
        manualCard(opts);
      }
    });
  };

  /** ① 实时扫码（一维条码 + QR 二维码；超时/异常自动抓帧或降级） */
  function realtime(opts) {
    var detector = new window.BarcodeDetector({ formats: scan.buildFormats() });
    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;max-height:50vh;background:#000;border-radius:8px';
    var stop = false;
    var stream = null;
    var stat = {
      emptyFrames: 0, errorFrames: 0, firstEmptyAt: 0, startedAt: Date.now(),
      mode: 'video', lastFrameAt: 0
    };
    var mask = ui.modal({
      title: '扫码',
      body: '<div id="scan-video"></div>' +
        '<p class="muted small" id="scan-hint">将条码对准取景框，保持平稳、避免反光</p>',
      actions: [
        { text: '📷 拍照识别', cls: 'btn', act: 'scan-photo' },
        { text: '手输', cls: 'btn', act: 'scan-manual' },
        { text: '取消', cls: 'btn', act: 'scan-cancel' }
      ],
      maskClose: false,
      // 统一关闭钩子：取消/X/遮罩/外部 closeModal 都会释放摄像头（避免二次打开黑屏）
      onClose: function () {
        stop = true;
        scan.closeCamera(stream || video.srcObject);
      },
      onMount: function (body) {
        body.querySelector('#scan-video').appendChild(video);
        // 不加理想分辨率约束：部分鸿蒙/Android WebView 对带约束的流渲染黑屏
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (s) {
            if (stop) { scan.closeCamera(s); return; }
            stream = s;
            video.srcObject = s;
            var pp = video.play();
            if (pp && typeof pp.then === 'function') {
              pp.then(function () { if (!stop) tick(); })
                .catch(function () { if (!stop) downgrade('摄像头启动失败，已切换为拍照/手输'); });
            } else {
              tick();
            }
          })
          .catch(function () {
            stop = true;
            scan.closeCamera(stream);
            ui.closeModal();
            manualCard(opts);
          });
        /** 降级到拍照/手输（释放摄像头 + 关弹窗 + 提示） */
        function downgrade(msg) {
          stop = true;
          scan.closeCamera(stream);
          ui.closeModal();
          if (opts.onError) opts.onError(msg);
          manualCard(opts);
        }
        /** 识别成功 */
        function success(raw) {
          stop = true;
          scan.closeCamera(stream);
          ui.closeModal();
          if (opts.onResult) opts.onResult(raw);
        }
        function tick() {
          if (stop) return;
          // 黑屏检测（优先）：2.5 秒无实际画面帧 → 降级
          if (scan.isBlackOut(video.videoWidth, stat.startedAt, Date.now())) {
            downgrade('摄像头未输出画面，已切换为拍照/手输');
            return;
          }
          // 抓帧模式：detect(video) 不可用/挂起时的兜底，画面保留、静态帧多通道解码
          if (stat.mode === 'frame') { frameTick(); return; }
          var detectSettled = false;
          // 超时保护：detect(video) 挂起永不返回时切抓帧，走多通道解码
          var detectTimer = setTimeout(function () {
            if (detectSettled || stop) return;
            detectSettled = true;
            stat.mode = 'frame';
            stat.lastFrameAt = 0;
            stat.errorFrames = 0;
            requestAnimationFrame(tick);
          }, scan.NATIVE_TIMEOUT_MS);
          detector.detect(video).then(function (list) {
            if (detectSettled || stop) return;
            detectSettled = true;
            clearTimeout(detectTimer);
            if (list && list.length) { success(list[0].rawValue); return; }
            stat.emptyFrames++;
            stat.errorFrames = 0;
            if (!stat.firstEmptyAt) stat.firstEmptyAt = Date.now();
            if (scan.needDowngrade(stat)) {
              downgrade('实时识别超时（约12秒无结果），已切换为拍照/手输');
              return;
            }
            requestAnimationFrame(tick);
          }).catch(function () {
            if (detectSettled || stop) return;
            detectSettled = true;
            clearTimeout(detectTimer);
            // 仅画面正常时的异常计数；连续 3 次 → 切抓帧模式（不关闭画面）
            if (scan.shouldCountError(video.videoWidth)) {
              stat.errorFrames++;
              if (scan.shouldSwitchFrame(stat.mode, stat.errorFrames)) {
                stat.mode = 'frame';
                stat.lastFrameAt = 0;
                requestAnimationFrame(tick);
                return;
              }
            }
            requestAnimationFrame(tick);
          });
        }
        function frameTick() {
          if (stop) return;
          if (scan.isBlackOut(video.videoWidth, stat.startedAt, Date.now())) {
            downgrade('摄像头未输出画面，已切换为拍照/手输');
            return;
          }
          var now = Date.now();
          if (!scan.frameDue(stat.lastFrameAt, now, 500)) { requestAnimationFrame(frameTick); return; }
          stat.lastFrameAt = now;
          var canvas = captureFrame(video);
          if (!canvas) { requestAnimationFrame(frameTick); return; }
          scan.decodeWith(canvas, function (ok, text) {
            if (stop) return;
            if (ok) { success(text); return; }
            if (Date.now() - stat.startedAt >= 15000) {
              downgrade('实时识别超时（已尝试多种识别方式），请拍照或手输');
              return;
            }
            requestAnimationFrame(frameTick);
          });
        }
      }
    });
    if (!mask) return;
    // 「📷 拍照识别」：随时可切（onClose 自动释放摄像头）
    var photoBtn = mask.querySelector('[data-act="scan-photo"]');
    if (photoBtn) photoBtn.addEventListener('click', function () {
      ui.closeModal();
      photoInput(opts);
    });
    // 「手输」：释放后切手动卡片
    var manualBtn = mask.querySelector('[data-act="scan-manual"]');
    if (manualBtn) manualBtn.addEventListener('click', function () {
      ui.closeModal();
      manualCard(opts);
    });
    // 「取消」：直接关闭（onClose 释放摄像头）
    var cancelBtn = mask.querySelector('[data-act="scan-cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      ui.closeModal();
    });
  }

  /** 从 video 抓取当前帧到 canvas（videoWidth=0 时返回 null） */
  function captureFrame(video) {
    try {
      var w = video.videoWidth || 0;
      var h = video.videoHeight || 0;
      if (!w || !h) return null;
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      return c;
    } catch (e) { return null; }
  }

  /** ② 拍照识别：多通道解码（原生 → EAN-13 → ZXing） + 中心放大重试 */
  function photoInput(opts) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        decodeImage(reader.result, opts);
      };
      reader.readAsDataURL(f);
      document.body.removeChild(input);
    });
    input.click();
  }

  function decodeImage(dataUrl, opts) {
    var img = new Image();
    img.onload = function () {
      scan.decodeWith(img, function (ok, text) {
        if (ok) { if (opts.onResult) opts.onResult(text); return; }
        // 中心区域放大重试：条码占照片比例小时提升识别率
        var zoomed = zoomCenterCanvas(img, 2);
        if (zoomed) {
          scan.decodeWith(zoomed, function (ok2, text2) {
            if (ok2) { if (opts.onResult) opts.onResult(text2); return; }
            if (opts.onError) opts.onError('未识别到条码/二维码，请对准条码、避免反光、保持完整后重拍，或手输');
          });
        } else if (opts.onError) {
          opts.onError('未识别到条码/二维码，请对准条码、避免反光、保持完整后重拍，或手输');
        }
      });
    };
    img.onerror = function () {
      if (opts.onError) opts.onError('图片加载失败，请重试或手输');
    };
    img.src = dataUrl;
  }

  /**
   * ③ 手动兜底卡片：拍照识别 + 手输条码 / 款号 / 色码编号
   * 任何无法实时扫码的环境都会落到这里，保证「点击扫码必有反应」。
   */
  function manualCard(opts) {
    if (!hasWindow()) { if (opts.onError) opts.onError('当前环境不支持扫码'); return; }
    var body =
      '<p class="muted small mb8">本设备无法实时扫码，可任选其一：</p>' +
      '<button class="btn btn-block mb8" data-act="scan-photo">📷 拍照 / 从相册识别</button>' +
      '<div class="field"><label>手输条码 / 款号 / 色码编号</label>' +
      '<input class="input" id="scan-manual-input" placeholder="如 XA1234 或 X001" autocomplete="off"></div>';
    ui.modal({
      title: '扫码',
      body: body,
      actions: [
        { text: '确定', cls: 'btn btn-primary', act: 'scan-manual-ok' },
        { text: '取消', cls: 'btn', act: 'close-modal' }
      ],
      maskClose: true,
      onMount: function (b, mask) {
        var input = b.querySelector('#scan-manual-input');
        if (input && input.focus) setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
        var okBtn = mask.querySelector('[data-act="scan-manual-ok"]');
        if (okBtn) okBtn.addEventListener('click', function () {
          var v = input ? String(input.value || '').trim() : '';
          if (!v) { ui.toast('请输入条码 / 款号', 'err'); return; }
          if (ui.closeModal) ui.closeModal();
          if (opts.onResult) opts.onResult(v);
        });
        var photoBtn = mask.querySelector('[data-act="scan-photo"]');
        if (photoBtn) photoBtn.addEventListener('click', function () {
          if (ui.closeModal) ui.closeModal();
          photoInput(opts);
        });
      }
    });
  }

  /** 扫码结果 → 打开商品卡（浏览器）；未建档则提示去建档 */
  scan.openCard = function openCard(ctx, code, app) {
    if (!hasWindow()) return;
    var res = scan.resolve(ctx, code);
    if (!res.found) {
      ui.toast('未找到该条码对应商品，请先在「商品档案」建档', 'err');
      if (app && app.go) app.go('product');
      return;
    }
    var c = scan.card(ctx, res.styleCode);
    if (!c) return;
    var rows = c.colors.map(function (col) {
      return '<tr><th>' + util.escapeHtml(col) + '</th>' + c.sizes.map(function (sz) {
        var cell = c.cells[col + '|' + sz];
        if (!cell) return '<td class="cell zero">-</td>';
        var stock = cell.stock || 0;
        return '<td class="cell' + (stock <= 0 ? ' zero' : (cell.threshold && stock < cell.threshold ? ' low' : '')) + '">' + stock + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var body = '<div class="small muted mb8">' + util.escapeHtml(c.product.name) + ' · 售价 ' + ui.money(c.product.salePrice) +
      (c.allZero ? ' <b style="color:#dc2626">（整款 0 库存）</b>' : '') + '</div>' +
      '<div class="small" style="margin-bottom:6px"><b>' + util.escapeHtml(c.summary) + '</b></div>' +
      '<table class="matrix"><thead><tr><th>颜色\\尺码</th>' + c.sizes.map(function (s) { return '<th>' + util.escapeHtml(s) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>';
    ui.modal({
      title: '商品卡 · ' + util.escapeHtml(c.product.styleCode),
      body: body,
      actions: [
        { text: '去开单', cls: 'btn btn-primary', act: 'scan-go-sale' },
        { text: '关闭', cls: 'btn', act: 'close-modal' }
      ],
      onMount: function (b, mask) {
        mask.querySelector('[data-act="scan-go-sale"]').addEventListener('click', function () {
          ui.closeModal();
          ERP.pendingSaleStyle = res.styleCode;
          if (app && app.go) app.go('sale');
        });
      }
    });
  };

  return scan;
});
