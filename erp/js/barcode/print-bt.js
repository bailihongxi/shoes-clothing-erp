/**
 * barcode/print-bt.js —— 蓝牙打印指令构建（PRD 11.4.3）
 *   两套指令：TSPL（BITMAP）/ ESC-POS（GS v 0），选择结果本地保存。
 *   buildTSPL / buildEscPos / supportsBluetooth / testPage 为纯函数或能力探测，可在 Node 测；
 *   connect / send 为浏览器 Web Bluetooth 专属。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = (root && root.ERP) || {};
  var label = E.label || (isNode ? require('./label.js') : null);
  var mod = factory(label, E);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.printBt = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (label, ERP) {
  'use strict';

  /** 是否支持 Web Bluetooth（iPhone Safari 返回 false → 界面隐藏蓝牙按钮） */
  function supportsBluetooth() {
    return typeof navigator !== 'undefined' && !!(navigator && navigator.bluetooth);
  }

  /** 测试页标签数据：固定条码 TEST001 */
  function testPage(opts) {
    opts = opts || {};
    return label.buildLabelData(
      { name: '测试标签', styleCode: 'TEST001', color: '红', size: '均码', salePrice: 0, barcode: 'TEST001' },
      { shop: opts.shop || 'TEST', widthMm: opts.widthMm || 40, heightMm: opts.heightMm || 30 }
    );
  }

  function toHex(bytes) {
    return (bytes || []).map(function (b) {
      var s = (b & 0xff).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }

  /**
   * 构建 TSPL 指令串（TSC/汉印/佳博/芯烨/精臣 等）
   * @param {object} bitmap { bytes, widthBytes, widthPx, heightPx }（来自 render.barcodeBitmap）
   * @param {object} opts { label, widthMm, heightMm, xDpi }
   * @returns {string}
   */
  function buildTSPL(bitmap, opts) {
    opts = opts || {};
    var W = opts.widthMm || 40;
    var H = opts.heightMm || 30;
    var dpi = opts.xDpi || 203;
    var lb = opts.label || null;
    var out = [];
    out.push('SIZE ' + W + ' mm,' + H + ' mm');
    out.push('GAP 2 mm,0');
    out.push('DENSITY 8');
    out.push('DIRECTION 0');
    out.push('CLS');
    // 文字（点位：1mm ≈ dpi/25.4 dot）
    if (lb) {
      var mm = dpi / 25.4;
      if (lb.shop) out.push('TEXT ' + Math.round(2 * mm) + ',' + Math.round(2 * mm) + ',"0",0,1,1,"' + lb.shop + '"');
      if (lb.name) out.push('TEXT ' + Math.round(2 * mm) + ',' + Math.round(7 * mm) + ',"0",0,1,1,"' + lb.name + '"');
      if (lb.color || lb.size) out.push('TEXT ' + Math.round(2 * mm) + ',' + Math.round(12 * mm) + ',"0",0,1,1,"' + lb.color + ' / ' + lb.size + '"');
      if (lb.priceText) out.push('TEXT ' + Math.round(2 * mm) + ',' + Math.round(17 * mm) + ',"0",0,1,1,"' + lb.priceText + '"');
    }
    // 条码位图（放在标签中下部）
    if (bitmap && bitmap.bytes && bitmap.bytes.length) {
      var bx = Math.round(2 * mm);
      var by = Math.round(20 * mm);
      out.push('BITMAP ' + bx + ',' + by + ',' + bitmap.widthBytes + ',' + bitmap.heightPx + ',0,' + toHex(bitmap.bytes));
    }
    out.push('PRINT 1');
    return out.join('\n') + '\n';
  }

  /**
   * 构建 ESC/POS 指令串（GS v 0 位图）
   * @returns {string}（含不可见控制字符）
   */
  function buildEscPos(bitmap, opts) {
    opts = opts || {};
    var lb = opts.label || null;
    var parts = [];
    // 初始化
    parts.push('\x1b\x40');
    if (lb) {
      if (lb.shop) parts.push(lb.shop + '\n');
      if (lb.name) parts.push(lb.name + '\n');
      if (lb.color || lb.size) parts.push(lb.color + ' / ' + lb.size + '\n');
      if (lb.priceText) parts.push(lb.priceText + '\n');
    }
    if (bitmap && bitmap.bytes && bitmap.bytes.length) {
      // GS v 0  m x y d1 d2 ...  m=0 正常，d1=widthBytes, d2=heightPx
      var head = '\x1d\x76\x30\x00' +
        String.fromCharCode(bitmap.widthBytes & 0xff, (bitmap.widthBytes >> 8) & 0xff,
          bitmap.heightPx & 0xff, (bitmap.heightPx >> 8) & 0xff);
      var data = '';
      for (var i = 0; i < bitmap.bytes.length; i++) data += String.fromCharCode(bitmap.bytes[i] & 0xff);
      parts.push(head + data);
    }
    // 切纸
    parts.push('\x1d\x56\x00');
    return parts.join('');
  }

  /* ---------------- 浏览器专属（Web Bluetooth） ---------------- */

  function hasBT() { return supportsBluetooth(); }

  /** 连接打印机（需用户手势触发 requestDevice） */
  function connect(opts) {
    opts = opts || {};
    if (!hasBT()) { if (opts.onError) opts.onError('当前浏览器不支持蓝牙打印'); return; }
    navigator.bluetooth.requestDevice({
      // 常见标签机服务；按需放宽 filters
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
    }).then(function (device) {
      return device.gatt.connect();
    }).then(function (server) {
      if (opts.onConnect) opts.onConnect(server);
    }).catch(function (e) {
      if (opts.onError) opts.onError(e && e.message ? e.message : '蓝牙连接失败');
    });
  }

  /** 发送指令（已连接的 GATT 写特征） */
  function send(server, cmd, opts) {
    opts = opts || {};
    if (!server || !opts.char) { if (opts.onError) opts.onError('未连接打印机'); return; }
    var buf = (typeof TextEncoder !== 'undefined')
      ? new TextEncoder().encode(cmd)
      : Uint8Array.from(cmd.split('').map(function (c) { return c.charCodeAt(0) & 0xff; }));
    opts.char.writeValue(buf).then(function () {
      if (opts.onSent) opts.onSent();
    }).catch(function (e) {
      if (opts.onError) opts.onError(e && e.message ? e.message : '发送失败');
    });
  }

  return {
    supportsBluetooth: supportsBluetooth,
    testPage: testPage,
    buildTSPL: buildTSPL,
    buildEscPos: buildEscPos,
    connect: connect,
    send: send
  };
});
