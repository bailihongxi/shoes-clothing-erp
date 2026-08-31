/**
 * core/util.js —— 通用工具（纯函数，浏览器 + Node 双端可用）
 * 约定：金额一律整数「分」存储，用户输入的「元」在入口处 parseMoney 转分。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.util = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var util = {};

  /* ---------------- 数字与金额 ---------------- */

  function pad(n, len) {
    n = String(n);
    while (n.length < len) n = '0' + n;
    return n;
  }
  util.pad = pad;

  /** 把「元」（数字或字符串，支持 ¥ 与千分位）安全解析为「分」整数 */
  util.parseMoney = function parseMoney(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Math.round(v * 100);
    var s = String(v).trim().replace(/[¥,，\s]/g, '');
    if (!s) return 0;
    var neg = /^-/.test(s);
    s = s.replace(/^[-+]/, '');
    var parts = s.split('.');
    var intPart = (parts[0] || '0').replace(/\D/g, '') || '0';
    var frac = ((parts[1] || '') + '00').replace(/\D/g, '').slice(0, 2);
    var val = parseInt(intPart, 10) * 100 + parseInt(frac || '0', 10);
    return neg ? -val : val;
  };

  /** 分 → 元（数字，保留两位） */
  util.fenToYuan = function fenToYuan(fen) {
    return Math.round(fen) / 100;
  };

  /** 分 → 展示字符串，如 12900 → '129.00' */
  util.fmtMoney = function fmtMoney(fen) {
    var f = Math.round(Number(fen) || 0);
    var neg = f < 0;
    f = Math.abs(f);
    var yuan = Math.floor(f / 100);
    var cent = f % 100;
    return (neg ? '-' : '') + yuan + '.' + pad(cent, 2);
  };

  /** 分 → 带 ¥ 前缀 */
  util.fmtYuan = function fmtYuan(fen) {
    return '¥' + util.fmtMoney(fen);
  };

  util.isNum = function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  };

  util.sum = function sum(list, fn) {
    var t = 0;
    for (var i = 0; i < (list || []).length; i++) {
      t += fn ? (fn(list[i], i) || 0) : (list[i] || 0);
    }
    return t;
  };

  /* ---------------- 文本清洗 ---------------- */

  util.cleanText = function cleanText(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
  };

  /**
   * 尺码清洗（编码安全）：
   *   '38' -> '38'   '38.5' -> '385'   '39/40' -> '39-40'   'xl' -> 'XL'
   */
  util.cleanSize = function cleanSize(s) {
    var t = String(s === null || s === undefined ? '' : s).trim();
    t = t.replace(/\s+/g, '');
    t = t.replace(/\//g, '-');
    t = t.replace(/\./g, '');
    t = t.replace(/[^0-9A-Za-z\-]/g, '');
    t = t.replace(/-+/g, '-');
    t = t.replace(/^-|-$/g, '');
    return t.toUpperCase();
  };

  /**
   * 尺码展示值：保留小数点（38.5 仍显示 38.5），斜杠转短横线，去空格
   * 编码仍然用 cleanSize（38.5 → 385），两者分开，界面好看且不冲突
   */
  util.displaySize = function displaySize(s) {
    var t = String(s === null || s === undefined ? '' : s).trim();
    t = t.replace(/\s+/g, '');
    t = t.replace(/[\/／]/g, '-');
    t = t.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return t.toUpperCase();
  };

  /** 颜色清洗：去首尾空格、压缩中间空格 */
  util.cleanColor = function cleanColor(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
  };

  util.escapeHtml = function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* ---------------- 日期 ---------------- */

  util.pad2 = function pad2(n) {
    return pad(n, 2);
  };

  function fmtDateParts(d) {
    return {
      y: String(d.getFullYear()),
      m: pad(d.getMonth() + 1, 2),
      d: pad(d.getDate(), 2),
      h: pad(d.getHours(), 2),
      mi: pad(d.getMinutes(), 2),
      s: pad(d.getSeconds(), 2)
    };
  }

  /** 'YYYY-MM-DD'（本地时区） */
  util.today = function today(d) {
    var p = fmtDateParts(d || new Date());
    return p.y + '-' + p.m + '-' + p.d;
  };

  /** 完整 ISO 字符串（本地时区，无 Z 后缀） */
  util.nowISO = function nowISO(d) {
    var p = fmtDateParts(d || new Date());
    return p.y + '-' + p.m + '-' + p.d + 'T' + p.h + ':' + p.mi + ':' + p.s;
  };

  /** 备份文件名用 'YYYYMMDD_HHmm' */
  util.stamp = function stamp(d) {
    var p = fmtDateParts(d || new Date());
    return p.y + p.m + p.d + '_' + p.h + p.mi;
  };

  util.compactDate = function compactDate(dateStr) {
    var s = String(dateStr || util.today());
    return s.replace(/-/g, '');
  };

  util.isDateStr = function isDateStr(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  };

  /** 日期加减天数，返回 'YYYY-MM-DD' */
  util.addDays = function addDays(dateStr, n) {
    var base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + n);
    return util.today(base);
  };

  util.diffDays = function diffDays(fromDate, toDate) {
    var a = new Date(String(fromDate) + 'T00:00:00').getTime();
    var b = new Date(String(toDate || util.today()) + 'T00:00:00').getTime();
    return Math.round((b - a) / 86400000);
  };

  /** 'YYYY-MM' */
  util.monthOf = function monthOf(dateStr) {
    return String(dateStr || '').slice(0, 7);
  };

  /** 日期区间 ['2026-08-01','2026-08-31'] 内所有日期 */
  util.dateRange = function dateRange(start, end) {
    var out = [];
    if (!start || !end) return out;
    var cur = start;
    var guard = 0;
    while (cur <= end && guard < 10000) {
      out.push(cur);
      cur = util.addDays(cur, 1);
      guard++;
    }
    return out;
  };

  util.monthRange = function monthRange(monthStr) {
    if (!monthStr) return null;
    var parts = String(monthStr).split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var last = new Date(y, m, 0).getDate();
    return { start: monthStr + '-01', end: monthStr + '-' + pad(last, 2) };
  };

  /* ---------------- ID ---------------- */

  var seq = 0;
  util.uuid = function uuid(prefix) {
    seq += 1;
    var rnd = '';
    if (typeof Math.random === 'function') {
      rnd = Math.floor(Math.random() * 1e6).toString(36);
    }
    return (prefix || 'id') + '_' + Date.now().toString(36) + seq.toString(36) + rnd;
  };

  /* ---------------- 数组工具 ---------------- */

  util.paginate = function paginate(list, page, size) {
    var arr = list || [];
    var total = arr.length;
    var pageSize = size > 0 ? size : (total || 1);
    var pages = Math.max(1, Math.ceil(total / pageSize));
    var p = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
    var start = (p - 1) * pageSize;
    return {
      page: p,
      size: pageSize,
      total: total,
      pages: pages,
      items: arr.slice(start, start + pageSize)
    };
  };

  util.groupBy = function groupBy(list, fn) {
    var out = {};
    for (var i = 0; i < (list || []).length; i++) {
      var k = fn(list[i], i);
      (out[k] = out[k] || []).push(list[i]);
    }
    return out;
  };

  util.sortBy = function sortBy(list, fn, desc) {
    var arr = (list || []).slice();
    arr.sort(function (a, b) {
      var va = fn(a);
      var vb = fn(b);
      if (va === vb) return 0;
      var r = va > vb ? 1 : -1;
      return desc ? -r : r;
    });
    return arr;
  };

  util.deepClone = function deepClone(o) {
    return o === undefined ? o : JSON.parse(JSON.stringify(o));
  };

  /* ---------------- CSV ---------------- */

  /**
   * 解析 CSV 文本 → 二维数组，支持双引号包裹、"" 转义、CRLF。
   * 返回 { rows, errors }
   */
  util.parseCSV = function parseCSV(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        cell += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(cell);
        cell = '';
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i++;
        continue;
      }
      cell += c;
      i++;
    }
    row.push(cell);
    rows.push(row);
    // 去掉全空行
    var out = rows.filter(function (r) {
      return r.some(function (v) {
        return String(v).trim() !== '';
      });
    });
    return { rows: out, errors: [] };
  };

  util.csvCell = function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  /** 生成带 BOM 的 CSV（Excel 打开中文不乱码） */
  util.toCSV = function toCSV(headers, rows) {
    var lines = [headers.map(util.csvCell).join(',')];
    for (var i = 0; i < (rows || []).length; i++) {
      lines.push((rows[i] || []).map(util.csvCell).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  };

  /* ---------------- 本地口令（仅本地锁屏，非加密级） ---------------- */

  util.hashPassword = function hashPassword(pwd) {
    var s = 'erp|v1|' + String(pwd === null || pwd === undefined ? '' : pwd);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return 'h$' + h.toString(16) + '.' + s.length.toString(16);
  };

  util.verifyPassword = function verifyPassword(pwd, hash) {
    return !!hash && util.hashPassword(pwd) === hash;
  };

  return util;
});
