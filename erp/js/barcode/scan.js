/**
 * barcode/scan.js —— 扫码三级降级（PRD 11.6）
 *   ① BarcodeDetector 实时预览（连续扫，Android Chrome）
 *   ② 拍照识别（<input type=file capture> → 解码，file:// 也能用）
 *   ③ 手输条码数字（等价于扫码结果）
 *
 * 纯逻辑部分（resolve / card）可在 Node 中测试；
 * 浏览器交互部分（start / fromPhoto / fromInput / openCard）仅在浏览器生效，
 * 调用前会判断运行环境，缺失能力时自动降级到「手输」。
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
    // ① 条码精确匹配
    var p = products.find(function (x) {
      return String(x.barcode || '').toUpperCase() === c;
    });
    // ② 款号匹配
    if (!p) p = ctx.getProduct(c);
    // ③ 色码 id 匹配（再反查款）
    var sku = null;
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
      allZero: totalStock <= 0
    };
  };

  /* ---------------- 浏览器交互（仅浏览器） ---------------- */

  function hasWindow() {
    return typeof window !== 'undefined' && window && typeof document !== 'undefined';
  }

  /**
   * 启动扫码（三级降级）
   * @param opts { onResult(code), onError(msg) }
   */
  scan.start = function start(opts) {
    opts = opts || {};
    if (!hasWindow()) { if (opts.onError) opts.onError('当前环境不支持扫码'); return; }
    if (window.BarcodeDetector) {
      realtime(opts);
    } else if (window.isSecureContext !== false) {
      // 退到拍照：触发一个隐藏的 file input
      photoInput(opts);
    } else {
      manualPrompt(opts);
    }
  };

  /** ① 实时扫码 */
  function realtime(opts) {
    var formats = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf'];
    var detector = new window.BarcodeDetector({ formats: formats });
    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;max-height:50vh;background:#000;border-radius:8px';
    var stop = false;
    var mask = ui.modal({
      title: '扫码',
      body: '<div id="scan-video"></div><p class="muted small">将条码对准取景框，连续识别</p>',
      actions: [{ text: '手输', cls: 'btn', act: 'scan-manual' }, { text: '取消', cls: 'btn', act: 'close-modal' }],
      maskClose: false,
      onMount: function (body) {
        body.querySelector('#scan-video').appendChild(video);
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (stream) {
            video.srcObject = stream;
            video.play();
            tick();
          })
          .catch(function () { manualPrompt(opts); closeMask(); });
        function tick() {
          if (stop) return;
          detector.detect(video).then(function (list) {
            if (list && list.length) {
              stop = true;
              streamStop(stream);
              closeMask();
              if (opts.onResult) opts.onResult(list[0].rawValue);
            } else {
              requestAnimationFrame(tick);
            }
          }).catch(function () { /* 继续 */ requestAnimationFrame(tick); });
        }
      }
    });
    // 手输按钮
    if (mask) {
      mask.querySelector('[data-act="scan-manual"]').addEventListener('click', function () {
        stop = true;
        streamStop(video.srcObject);
        closeMask();
        manualPrompt(opts);
      });
    }
    function streamStop(s) { if (s && s.getTracks) s.getTracks().forEach(function (t) { t.stop(); }); }
    function closeMask() { if (ui && ui.closeModal) ui.closeModal(); }
  }

  /** ② 拍照识别：懒加载 vendor/zxing 解码 */
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
    // 优先用已加载的 ZXing 全局
    if (window.ZXing && window.ZXing.BrowserCodeReader) {
      try {
        var reader = new window.ZXing.BrowserCodeReader();
        reader.decodeFromImageUrl(dataUrl).then(function (r) {
          if (r && r.text && opts.onResult) opts.onResult(r.text);
          else if (opts.onError) opts.onError('未识别到条码，请重试或手输');
        }).catch(function () {
          if (opts.onError) opts.onError('识别失败，请重试或手输');
        });
        return;
      } catch (e) { /* 落到手输 */ }
    }
    if (opts.onError) opts.onError('当前环境无法拍照识别，请手输条码');
  }

  /** ③ 手输 */
  function manualPrompt(opts) {
    if (!hasWindow()) return;
    var code = window.prompt('请输入条码 / 款号 / 色码编号：');
    if (code && code.trim()) {
      if (opts.onResult) opts.onResult(code.trim());
    }
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
