/**
 * barcode/ean13.js —— 自研轻量 EAN-13 解码器（零依赖、纯 JS、Node 可测、国产浏览器兼容）
 *
 * 背景：鞋服 ERP 拍照/抓帧解码原依赖 vendor/zxing.min.js（index.html 已引用但 vendor 缺失，
 *       实际加载 404，拍照通道失效）。本项目借鉴同类进销存模板的「自研解码器」方案：
 *       实现 4-run 比例匹配 + 首位奇偶枚举 + 校验位过滤 + 多行投票 的 EAN-13 解码，
 *       对相机帧 / 直出 JPEG / 轻噪声图像稳定可解，不依赖任何第三方库。
 *
 * 用法（浏览器）：var r = ERP.ean13.decode(gray, width, height);
 *                var gray = ERP.ean13.grayFromCanvas(canvas);
 * 用法（Node 测试）：require('../js/barcode/ean13.js').decode(gray, w, h)
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.ean13 = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- EAN-13 码表（GB/T 12906 / 国际标准） ---------------- */
  // 左侧奇校验（L 码）：7 位条空串，1=黑条 0=白空
  var L_BITS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  // 左侧偶校验（G 码）
  var G_BITS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  // 右侧（R 码）
  var R_BITS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  // 首位数字 → 左侧 6 位的奇偶模式（O=L 奇校验，E=G 偶校验）
  // GB/T 12906 标准表：0 LLLLLL / 1 LLGLGG / 2 LLGGLG / 3 LLGGGL / 4 LGLLGG /
  // 5 LGGLLG / 6 LGGGLL / 7 LGLGLG / 8 LGLGGL / 9 LGGLGL
  // 历史 bug：5/6/7/9 四个模式的奇偶位写错（如 5 被写成 OEOEOE），
  // 导致首位 5/6/7/9 的条码被误读（实测 5012345678900 → 1072305678900）。
  var PARITY = ['OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE', 'OEEOOE', 'OEEEOO', 'OEOEOE', 'OEOEEO', 'OEEOEO'];

  /** 7 模块位串 → 4 段游程长度（白,黑,白,黑 或 黑,白,黑,白） */
  function toRuns(bits7) {
    var runs = [];
    var cur = bits7[0], len = 1;
    for (var i = 1; i < bits7.length; i++) {
      if (bits7[i] === cur) len++;
      else { runs.push(len); cur = bits7[i]; len = 1; }
    }
    runs.push(len);
    while (runs.length < 4) runs.push(0);
    return runs.slice(0, 4);
  }
  var L_PATS = L_BITS.map(toRuns);
  var G_PATS = G_BITS.map(toRuns);
  var R_PATS = R_BITS.map(toRuns);

  /**
   * 单段 4 游程与码表匹配：按总宽度归一化后取绝对偏差和最小的码元
   * @returns {{idx:number, v:number, t:number}} idx=-1 表示偏差超限
   */
  function matchOne(counters, patterns) {
    var total = counters[0] + counters[1] + counters[2] + counters[3];
    var best = -1, bestVar = Infinity;
    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      var patSum = pat[0] + pat[1] + pat[2] + pat[3];
      var v = 0;
      for (var i = 0; i < 4; i++) {
        v += Math.abs(counters[i] - pat[i] * total / patSum);
      }
      if (v < bestVar) { bestVar = v; best = p; }
    }
    return { idx: best, v: bestVar, t: total };
  }

  /** 单条水平扫描线解码（返回 13 位数字串；失败 null） */
  function decodeRow(gray, width, height, y) {
    var row = new Uint8Array(width);
    var sum = 0;
    for (var x = 0; x < width; x++) { row[x] = gray[y * width + x]; sum += row[x]; }
    var mean = sum / width;
    var black = 0;
    for (var j = 0; j < width; j++) if (row[j] < mean) black++;
    if (black < width * 0.03 || black > width * 0.97) return null;

    var bin = new Uint8Array(width);
    for (j = 0; j < width; j++) bin[j] = row[j] < mean ? 1 : 0;
    var runs = [];
    var cur = bin[0], len = 1, start = 0;
    for (x = 1; x < width; x++) {
      if (bin[x] === cur) len++;
      else { runs.push({ v: cur, len: len, start: start }); cur = bin[x]; len = 1; start = x; }
    }
    runs.push({ v: cur, len: len, start: start });

    for (var i = 0; i < runs.length - 2; i++) {
      // 起始符 101（黑 白 黑）
      var r0 = runs[i], r1 = runs[i + 1], r2 = runs[i + 2];
      if (r0.v !== 1 || r1.v !== 0 || r2.v !== 1) continue;
      var a = (r0.len + r1.len + r2.len) / 3;
      if (a < 1.5) continue;
      if (Math.abs(r0.len - a) + Math.abs(r1.len - a) + Math.abs(r2.len - a) > 1.8 * a) continue;

      // 左侧 6 位（白,黑,白,黑 游程）
      var lc = [];
      var j2 = i + 3, ok = true;
      for (var d = 0; d < 6; d++) {
        if (j2 + 3 >= runs.length) { ok = false; break; }
        if (runs[j2].v !== 0 || runs[j2 + 1].v !== 1 || runs[j2 + 2].v !== 0 || runs[j2 + 3].v !== 1) { ok = false; break; }
        lc.push([runs[j2].len, runs[j2 + 1].len, runs[j2 + 2].len, runs[j2 + 3].len]);
        j2 += 4;
      }
      if (!ok || lc.length !== 6) continue;

      // 分隔符 01010（5 段宽度接近模块宽 a）
      if (j2 + 4 >= runs.length) continue;
      if (runs[j2].v !== 0 || runs[j2 + 1].v !== 1 || runs[j2 + 2].v !== 0 || runs[j2 + 3].v !== 1 || runs[j2 + 4].v !== 0) continue;
      var sepOk = true;
      for (var k = 0; k < 5; k++) if (Math.abs(runs[j2 + k].len - a) > 0.8 * a) { sepOk = false; break; }
      if (!sepOk) continue;
      j2 += 5;

      // 右侧 6 位（黑,白,黑,白 游程）
      var rc = [];
      ok = true;
      for (d = 0; d < 6; d++) {
        if (j2 + 3 >= runs.length) { ok = false; break; }
        if (runs[j2].v !== 1 || runs[j2 + 1].v !== 0 || runs[j2 + 2].v !== 1 || runs[j2 + 3].v !== 0) { ok = false; break; }
        rc.push([runs[j2].len, runs[j2 + 1].len, runs[j2 + 2].len, runs[j2 + 3].len]);
        j2 += 4;
      }
      if (!ok || rc.length !== 6) continue;

      // 结束符 101
      if (j2 + 2 >= runs.length) continue;
      if (runs[j2].v !== 1 || runs[j2 + 1].v !== 0 || runs[j2 + 2].v !== 1) continue;

      // 右侧固定 R 码
      var right = '';
      ok = true;
      for (d = 0; d < 6; d++) {
        var m = matchOne(rc[d], R_PATS);
        if (m.idx < 0 || m.v > m.t * 0.30) { ok = false; break; }
        right += m.idx;
      }
      if (!ok) continue;

      // 首位 0-9 枚举：奇偶模式决定左 6 位 L/G，校验位过滤
      var bestRes = null;
      for (var d1 = 0; d1 < 10; d1++) {
        var parity = PARITY[d1];
        var left = '', tv = 0;
        ok = true;
        for (d = 0; d < 6; d++) {
          var pats = parity[d] === 'O' ? L_PATS : G_PATS;
          var m2 = matchOne(lc[d], pats);
          if (m2.idx < 0 || m2.v > m2.t * 0.42) { ok = false; break; }
          left += m2.idx;
          tv += m2.v;
        }
        if (!ok) continue;
        var ds = d1 + left + right;
        var sc = 0;
        for (k = 0; k < 12; k++) sc += (k % 2 === 0) ? +ds[k] : +ds[k] * 3;
        if ((10 - (sc % 10)) % 10 !== +ds[12]) continue;
        if (!bestRes || tv < bestRes.v) bestRes = { digits: ds, v: tv };
      }
      if (bestRes) return bestRes.digits;
    }
    return null;
  }

  /**
   * 多行扫描 + 投票解码
   * @param gray Uint8Array（width*height，0=黑 255=白）
   * @returns {text, votes, lines} 或 null（无任何行通过校验 / 票数不足置信度门槛）
   */
  function decode(gray, width, height) {
    if (!gray || !width || !height || width < 60 || height < 20) return null;
    var tally = {};
    var y0 = Math.round(height * 0.15);
    var y1 = Math.round(height * 0.85);
    var lines = 0;
    for (var y = y0; y < y1; y += 2) {
      var r = decodeRow(gray, width, height, y);
      lines++;
      if (r) tally[r] = (tally[r] || 0) + 1;
    }
    var best = null, bestVotes = 0;
    for (var k in tally) {
      if (tally[k] > bestVotes) { bestVotes = tally[k]; best = k; }
    }
    if (!best) return null;
    if (bestVotes < 3 || bestVotes < lines * 0.3) return null;
    return { text: best, votes: bestVotes, lines: lines };
  }

  /** 浏览器端：canvas → 灰度（getImageData；本地同源 / data URL 不污染画布） */
  function grayFromCanvas(canvas) {
    try {
      if (!canvas || !canvas.getContext) return null;
      var w = canvas.width || 0, h = canvas.height || 0;
      if (!w || !h) return null;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      var data = ctx.getImageData(0, 0, w, h).data;
      var gray = new Uint8Array(w * h);
      for (var i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      }
      return gray;
    } catch (e) { return null; }
  }

  /** EAN-13 校验位计算（供测试与调用方校验用）：digits 为 12 位前导，返回第 13 位 */
  function checksum(first12) {
    var sc = 0;
    for (var k = 0; k < 12; k++) sc += (k % 2 === 0) ? +first12[k] : +first12[k] * 3;
    return (10 - (sc % 10)) % 10;
  }

  return {
    decode: decode,
    decodeRow: decodeRow,
    grayFromCanvas: grayFromCanvas,
    checksum: checksum,
    L_PATS: L_PATS,
    G_PATS: G_PATS,
    R_PATS: R_PATS,
    PARITY: PARITY
  };
});
