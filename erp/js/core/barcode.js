/**
 * core/barcode.js —— CODE128 编码（PRD 11.4 / 10.7）
 *   条码内容 = 款号（如 'X001'），CODE128-B 子集足够覆盖；
 *   同时兼容纯数字串（如测试页 'TEST001' 含字母，统一走 Code B）。
 *   纯函数：不碰 DOM，可在 Node 中直接测（node --test）。
 *
 * 导出：ERP.barcode.code128Encode(text) → { values, modules, totalModules, checksum, start, stop }
 *   - values:       符号值序列（含 START_B / 各字符 / 校验 / STOP）
 *   - modules:      条空宽度序列（数字，单位"模块"），偶数位=条，奇数位=空，交替
 *   - totalModules: modules 各元素之和（总模块数）
 *   - checksum:     计算所得校验符号值（0..102）
 *   - quietModules: 建议静区模块数（≥ 10 模块 ≈ ≥2.5mm @203dpi）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.barcode = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 字符值 → 六元条空宽度（单位：模块）。索引即符号值 0..106。
  // CODE128 标准图案表（每个值 6 个宽度，条/空/条/空/条/空，合计 11 模块）。
  var PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
    '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
    '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
    '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
    '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
    '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
    '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
    '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
    '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
    '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
    '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
    '211214', '211232', '2331112'
  ];

  var START_B = 104;
  var STOP = 106;

  /** 单字符 → 符号值（Code B：char - 32，范围 32..126 → 0..94） */
  function charValue(ch) {
    var c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return -1; // 不支持的字符，归位为 '?'
    return c - 32;
  }

  /**
   * 编码主函数
   * @param {string} text 条码内容（款号 / TEST001 等，ASCII 32..126）
   * @returns {object} 见文件头注释
   */
  function code128Encode(text) {
    text = String(text == null ? '' : text);
    var chars = text.split('');
    // 归一：不支持的字符替换为 '?'
    var values = [START_B];
    for (var i = 0; i < chars.length; i++) {
      var v = charValue(chars[i]);
      if (v < 0) { v = charValue('?'); }
      values.push(v);
    }
    // 校验位：(START + Σ(dataValue * 位置)) mod 103，位置从 1 开始
    var sum = START_B;
    for (var j = 1; j < values.length; j++) {
      sum += values[j] * j;
    }
    var checksum = sum % 103;
    values.push(checksum);
    values.push(STOP);

    // 展平为条空模块宽度序列
    var modules = [];
    var totalModules = 0;
    for (var k = 0; k < values.length; k++) {
      var p = PATTERNS[values[k]];
      for (var m = 0; m < p.length; m++) {
        var w = parseInt(p[m], 10);
        modules.push(w);
        totalModules += w;
      }
    }

    return {
      values: values,
      modules: modules,
      totalModules: totalModules,
      checksum: checksum,
      start: START_B,
      stop: STOP,
      quietModules: 10 // ≈ 2.66mm @203dpi（模块 0.125mm），满足 ≥2.5mm
    };
  }

  return {
    code128Encode: code128Encode,
    START_B: START_B,
    STOP: STOP,
    PATTERNS: PATTERNS
  };
});
