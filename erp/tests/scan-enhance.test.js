/**
 * barcode/scan.js 增强测试：多通道解码、降级判定、抓帧切换、超时保护等纯逻辑
 */
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../js/barcode/scan.js');

test('chooseMode：有 BarcodeDetector 且安全上下文才实时，否则手动', () => {
  assert.strictEqual(scan.chooseMode(null, true), 'manual');
  assert.strictEqual(scan.chooseMode({}, false), 'manual');
  assert.strictEqual(scan.chooseMode({}, true), 'realtime');
  assert.strictEqual(scan.chooseMode({}, undefined), 'realtime');
});

test('pickDecoders：按 native → zxing → ean13 只列可用通道（V1.3-4 顺序调整）', () => {
  assert.deepStrictEqual(scan.pickDecoders({ native: true, ean13: true, zxing: true }), ['native', 'zxing', 'ean13']);
  assert.deepStrictEqual(scan.pickDecoders({ native: false, ean13: true, zxing: false }), ['ean13']);
  assert.deepStrictEqual(scan.pickDecoders({ native: true, ean13: false, zxing: false }), ['native']);
  assert.deepStrictEqual(scan.pickDecoders({}), []);
});

test('needDowngrade：异常5次 / 空帧60 / 空转12秒 触发降级', () => {
  assert.strictEqual(scan.needDowngrade({ errorFrames: 5 }), true);
  assert.strictEqual(scan.needDowngrade({ errorFrames: 4 }), false);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 60 }), true);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 59 }), false);
  const past = Date.now() - 12001;
  assert.strictEqual(scan.needDowngrade({ firstEmptyAt: past }), true);
  const recent = Date.now() - 5000;
  assert.strictEqual(scan.needDowngrade({ firstEmptyAt: recent }), false);
});

test('isBlackOut：启动 2.5s 仍无画面帧判定黑屏', () => {
  assert.strictEqual(scan.isBlackOut(0, 1000, 3501), true);
  assert.strictEqual(scan.isBlackOut(0, 1000, 3499), false);
  assert.strictEqual(scan.isBlackOut(640, 1000, 10000), false, '有画面不算黑屏');
});

test('shouldSwitchFrame：实时模式 detect 异常 3 次切抓帧；抓帧模式不重复切', () => {
  assert.strictEqual(scan.shouldSwitchFrame('video', 3), true);
  assert.strictEqual(scan.shouldSwitchFrame('video', 2), false);
  assert.strictEqual(scan.shouldSwitchFrame('frame', 5), false);
});

test('shouldCountError：仅画面正常时的异常计数', () => {
  assert.strictEqual(scan.shouldCountError(640), true);
  assert.strictEqual(scan.shouldCountError(0), false);
});

test('frameDue：距上次抓帧 ≥500ms 才抓新帧', () => {
  assert.strictEqual(scan.frameDue(1000, 1499, 500), false);
  assert.strictEqual(scan.frameDue(1000, 1500, 500), true);
  assert.strictEqual(scan.frameDue(0, 499, 500), false);
  assert.strictEqual(scan.frameDue(0, 500, 500), true);
});

test('decodeWith：按通道顺序依次尝试，首个成功即返回（native → zxing → ean13）', () => {
  return new Promise((resolve, reject) => {
    const calls = [];
    const impl = {
      native: { available: true, detect(src, cb) { calls.push('native'); setTimeout(() => cb(false), 5); } },
      ean13: { available: true, decode(src, cb) { calls.push('ean13'); setTimeout(() => cb(true, '6901234567892'), 5); } },
      zxing: { available: true, decode(src, cb) { calls.push('zxing'); cb(true, 'X'); } }
    };
    scan.decodeWith({ tagName: 'IMG' }, (ok, text) => {
      try {
        assert.strictEqual(ok, true);
        assert.strictEqual(text, 'X');
        assert.deepStrictEqual(calls, ['native', 'zxing'], 'native 失败后走 zxing，成功即停');
        resolve();
      } catch (e) { reject(e); }
    }, impl);
  });
});

test('decodeWith：native 挂起超过 2500ms 被超时跳过', () => {
  return new Promise((resolve, reject) => {
    const calls = [];
    const impl = {
      native: { available: true, detect() { /* 永不回调（挂起） */ } },
      ean13: { available: true, decode(src, cb) { calls.push('ean13'); setTimeout(() => cb(true, '4006381333931'), 5); } }
    };
    const t0 = Date.now();
    scan.decodeWith({ tagName: 'IMG' }, (ok, text) => {
      try {
        assert.strictEqual(ok, true);
        assert.strictEqual(text, '4006381333931');
        assert.ok(Date.now() - t0 >= scan.NATIVE_TIMEOUT_MS - 50, '应等待 native 超时');
        assert.deepStrictEqual(calls, ['ean13']);
        resolve();
      } catch (e) { reject(e); }
    }, impl);
  });
});

test('decodeWith：native 回调迟到不产生二次结果（settled 保护）', () => {
  return new Promise((resolve, reject) => {
    let results = 0;
    const impl = {
      native: { available: true, detect(src, cb) { setTimeout(() => cb(false), 10); } },
      ean13: { available: true, decode(src, cb) { setTimeout(() => cb(true, '6901234567892'), 1); } }
    };
    scan.decodeWith({ tagName: 'IMG' }, (ok) => {
      results++;
      try {
        assert.ok(ok);
        setTimeout(() => {
          assert.strictEqual(results, 1, '只能回调一次');
          resolve();
        }, 60);
      } catch (e) { reject(e); }
    }, impl);
  });
});

test('closeCamera：幂等释放流，无流安全', () => {
  let stopped = 0;
  const fakeStream = { getTracks() { return [{ stop() { stopped++; } }]; } };
  assert.strictEqual(scan.closeCamera(fakeStream), true);
  assert.strictEqual(stopped, 1);
  assert.strictEqual(scan.closeCamera(null), false);
  assert.strictEqual(scan.closeCamera({}), false);
});

test('resolve：鞋服扫码定位（款号 / 条码 / 色码）保持不变', () => {
  const products = [
    { id: 'p1', styleCode: 'X001', name: '白色运动鞋', barcode: '6901234567892' },
    { id: 'p2', styleCode: 'X002', name: '黑色卫衣', barcode: '' }
  ];
  const skus = [
    { id: 'X001-白-40', styleCode: 'X001', color: '白', size: '40', barcode: 'SKU-001' }
  ];
  const ctx = {
    data: { products, skus },
    getProduct: (c) => products.find((p) => p.styleCode === String(c).toUpperCase()),
    getSku: (c) => skus.find((s) => s.id === String(c).toUpperCase())
  };
  let r = scan.resolve(ctx, '6901234567892');
  assert.ok(r.found && r.product.styleCode === 'X001' && r.type === 'style');
  r = scan.resolve(ctx, 'SKU-001');
  assert.ok(r.found && r.type === 'sku' && r.styleCode === 'X001');
  r = scan.resolve(ctx, 'x001');
  assert.ok(r.found && r.styleCode === 'X001');
  r = scan.resolve(ctx, 'NOPE');
  assert.ok(!r.found);
});

// ---------- V1.3-5：ZXing 懒加载 + UPC-A 规范化 ----------
test('normalizeCode：12 位 UPC-A 补前导 0 为 13 位 EAN-13，其余原样', () => {
  assert.strictEqual(scan.normalizeCode('076950450479'), '0076950450479');
  assert.strictEqual(scan.normalizeCode('5012345678900'), '5012345678900', '13 位不变');
  assert.strictEqual(scan.normalizeCode('A41611403 01%'), 'A41611403 01%', '含字母不变（Code128）');
  assert.strictEqual(scan.normalizeCode(''), '');
});

test('decodeWith：zxing 返回 12 位 UPC-A 时出口统一补 0 为 13 位（V1.3-5 规范化）', () => {
  return new Promise((resolve, reject) => {
    const impl = {
      native: { available: false },
      ean13: { available: false },
      zxing: { available: true, decode(src, cb) { cb(true, '076950450479'); } }
    };
    scan.decodeWith({ tagName: 'IMG' }, (ok, text) => {
      try {
        assert.strictEqual(ok, true);
        assert.strictEqual(text, '0076950450479', 'UPC-A 应规范化为 13 位 EAN-13');
        resolve();
      } catch (e) { reject(e); }
    }, impl);
  });
});

test('ensureZxing：ZXing 已就绪时立即回调且不注入 script', () => {
  const savedWindow = global.window;
  const savedDoc = global.document;
  global.window = { ZXing: { decodeCanvas() {} } };
  global.document = { createElement() { throw new Error('不应创建 script'); } };
  try {
    return new Promise((resolve, reject) => {
      scan.ensureZxing((ok) => {
        try {
          assert.strictEqual(ok, true);
          assert.strictEqual(scan.__zxingLoading, undefined, '不应有加载标记');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  } finally {
    global.window = savedWindow;
    global.document = savedDoc;
  }
});

test('ensureZxing：未加载时动态注入 script，onload 后回调成功', () => {
  const savedWindow = global.window;
  const savedDoc = global.document;
  global.window = {};
  let script = null;
  global.document = {
    head: { appendChild(s) { script = s; } },
    createElement(tag) { return { tagName: tag }; }
  };
  try {
    return new Promise((resolve, reject) => {
      scan.ensureZxing((ok) => {
        try {
          assert.strictEqual(ok, true);
          assert.strictEqual(script.src, 'vendor/zxing.min.js', '应加载 vendor/zxing.min.js');
          assert.strictEqual(script.async, true);
          resolve();
        } catch (e) { reject(e); }
      });
      assert.ok(script, '应已注入 script');
      global.window.ZXing = { decodeCanvas() {} };
      script.onload();
    });
  } finally {
    delete global.window.ZXing;
    global.window = savedWindow;
    global.document = savedDoc;
    delete scan.__zxingLoading;
  }
});

test('ensureZxing：加载失败（onerror）回调失败，不抛错', () => {
  const savedWindow = global.window;
  const savedDoc = global.document;
  global.window = {};
  let script = null;
  global.document = {
    head: { appendChild(s) { script = s; } },
    createElement(tag) { return { tagName: tag }; }
  };
  try {
    return new Promise((resolve, reject) => {
      scan.ensureZxing((ok) => {
        try {
          assert.strictEqual(ok, false);
          resolve();
        } catch (e) { reject(e); }
      });
      script.onerror();
    });
  } finally {
    global.window = savedWindow;
    global.document = savedDoc;
    delete scan.__zxingLoading;
  }
});

test('start：扫码启动前先 ensureZxing 预热，回调后才进入扫码主流程（V1.3-5 懒加载）', () => {
  const savedWindow = global.window;
  const savedDoc = global.document;
  global.document = {};
  global.window = {};
  let ensured = false;
  let flowStarted = false;
  const savedEnsure = scan.ensureZxing;
  const savedChoose = scan.chooseMode;
  scan.ensureZxing = function (cb) {
    ensured = true;
    // 模拟加载未完成：不立即回调，验证主流程确实等待预热（加载完成才启动扫码）
  };
  scan.chooseMode = function () { flowStarted = true; return 'manual'; };
  try {
    scan.start({ onError() {} });
    assert.strictEqual(ensured, true, 'start 应先调用 ensureZxing 预热');
    assert.strictEqual(flowStarted, false, 'ensureZxing 未回调前不应进入扫码主流程');
    assert.strictEqual(scan.__zxingLoading, undefined, 'ensureZxing 内部自行管理加载标记');
  } finally {
    scan.ensureZxing = savedEnsure;
    scan.chooseMode = savedChoose;
    global.window = savedWindow;
    global.document = savedDoc;
  }
});

test('ensureZxing：onload 后补挂 zxingBridge.install（bridge 先于 zxing 加载场景，V1.3-5）', () => {
  const savedWindow = global.window;
  const savedDoc = global.document;
  let installed = 0;
  global.window = { ERP: { zxingBridge: { install(Z) { installed++; return Z; } } } };
  let script = null;
  global.document = {
    head: { appendChild(s) { script = s; } },
    createElement(tag) { return { tagName: tag }; }
  };
  try {
    return new Promise((resolve, reject) => {
      scan.ensureZxing((ok) => {
        try {
          assert.strictEqual(ok, true);
          assert.strictEqual(installed, 1, 'onload 后应调用 zxingBridge.install 挂载 decodeCanvas');
          resolve();
        } catch (e) { reject(e); }
      });
      global.window.ZXing = { decodeCanvas() {} };
      script.onload();
    });
  } finally {
    global.window = savedWindow;
    global.document = savedDoc;
    delete scan.__zxingLoading;
  }
});
