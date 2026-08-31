/**
 * ui/components.js —— 通用组件
 * 纯字符串类（matrixTable / pager / searchBar / badge ...）可在 Node 中直接断言；
 * DOM 类（toast / modal / confirm）只在浏览器生效，调用前会判断 document 是否存在。
 */
(function (root, factory) {
  var util = (typeof module !== 'undefined' && module.exports)
    ? require('../core/util.js')
    : root.ERP && root.ERP.util;
  var mod = factory(util);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.ui = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var esc = util.escapeHtml;
  var fmt = util.fmtMoney;

  var C = { esc: esc, fmt: fmt };

  /* ---------------- 纯字符串组件 ---------------- */

  C.badge = function badge(text, type) {
    return '<span class="badge ' + (type || '') + '">' + esc(text) + '</span>';
  };

  C.empty = function empty(text) {
    return '<div class="empty">' + esc(text || '暂无数据') + '</div>';
  };

  /** 搜索栏：data-input="keyword" 由页面自行处理 */
  C.searchBar = function searchBar(opts) {
    opts = opts || {};
    var ph = opts.placeholder || '搜索名称 / 款号 / 条码';
    return (
      '<div class="row mb8">' +
      '<input class="input" data-input="keyword" placeholder="' + esc(ph) + '" value="' + esc(opts.value || '') + '">' +
      (opts.scan === false ? '' : '<button class="btn" data-act="scan" title="扫码">📷</button>') +
      (opts.filters || '') +
      '</div>'
    );
  };

  C.select = function select(opts) {
    var name = opts.name;
    var value = opts.value === undefined || opts.value === null ? '' : opts.value;
    var html = '<select class="select"' + (opts.attrs ? ' ' + opts.attrs : '') +
      ' data-change="' + esc(opts.on || name) + '" data-name="' + esc(name) + '">';
    (opts.options || []).forEach(function (o) {
      var v = o.value === undefined ? o : o.value;
      var t = o.text === undefined ? o : o.text;
      html += '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(t) + '</option>';
    });
    html += '</select>';
    return html;
  };

  /**
   * 颜色 × 尺码矩阵
   * @param matrix {colors:[], sizes:[], cells:{'白|38':{skuId,stock,price,threshold}}}
   * @param opts {act:'pick-cell', editable:false, name:'qty'}
   */
  C.matrixTable = function matrixTable(matrix, opts) {
    opts = opts || {};
    if (!matrix || !matrix.colors.length || !matrix.sizes.length) {
      return C.empty('该款暂无色码');
    }
    var h = '<table class="matrix"><thead><tr><th>颜色\\尺码</th>';
    matrix.sizes.forEach(function (s) {
      h += '<th>' + esc(s) + '</th>';
    });
    h += '</tr></thead><tbody>';
    matrix.colors.forEach(function (c) {
      h += '<tr><th>' + esc(c) + '</th>';
      matrix.sizes.forEach(function (s) {
        var cell = matrix.cells[c + '|' + s];
        if (!cell) {
          h += '<td class="cell zero">-</td>';
          return;
        }
        var cls = 'cell';
        if (cell.stock <= 0) cls += ' zero';
        else if (cell.threshold && cell.stock < cell.threshold) cls += ' low';
        if (opts.editable) {
          var inner = '<input class="input" style="min-height:30px;padding:2px 4px;text-align:center" ' +
            'data-change="' + esc(opts.editableName || 'qty') + '" data-sku="' + esc(cell.skuId) + '" value="' +
            (cell.value === undefined ? '' : esc(cell.value)) + '" ' +
            'inputmode="numeric" placeholder="' + cell.stock + '">';
          h += '<td class="' + cls + '">' + inner + '</td>';
          return;
        }
        if (opts.act && cell.stock > 0) {
          h += '<td class="' + cls + '" data-act="' + esc(opts.act) + '" data-sku="' + esc(cell.skuId) + '">' +
            esc(cell.stock) + '</td>';
        } else {
          h += '<td class="' + cls + (cell.stock > 0 ? '' : ' zero') + '">' + esc(cell.stock) + '</td>';
        }
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
  };

  C.pager = function pager(page, pages, total) {
    if (!pages || pages <= 1) {
      return total ? '<div class="pager weak small">共 ' + total + ' 条</div>' : '';
    }
    return (
      '<div class="pager">' +
      '<button class="btn btn-sm" data-act="page" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="muted small">' + page + ' / ' + pages + '　共 ' + total + ' 条</span>' +
      '<button class="btn btn-sm" data-act="page" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button>' +
      '</div>'
    );
  };

  C.stat = function stat(k, v, cls) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
  };

  C.notice = function notice(text, type, action) {
    var cls = type === 'danger' ? 'notice-danger' : type === 'info' ? 'notice-info' : 'notice-warn';
    var actionHtml = '';
    if (action) {
      var extra = action.page ? ' data-page="' + esc(action.page) + '"' : '';
      actionHtml = '<button class="btn btn-sm" data-act="' + esc(action.act) + '"' + extra + '>' + esc(action.text) + '</button>';
    }
    return (
      '<div class="notice ' + cls + '"><span>' + text + '</span>' + actionHtml + '</div>'
    );
  };

  /** 快捷入口网格 */
  C.quickGrid = function quickGrid(items) {
    var h = '<div class="grid quick-grid">';
    items.forEach(function (it) {
      h += '<button class="btn quick-item" data-act="go" data-page="' + esc(it.page) + '">' +
        '<span class="ico">' + it.icon + '</span><span>' + esc(it.text) + '</span></button>';
    });
    h += '</div>';
    return h;
  };

  /* ---------------- DOM 组件（仅浏览器） ---------------- */

  function hasDom() {
    return typeof document !== 'undefined' && document && document.body;
  }

  C.toast = function toast(msg, type) {
    if (!hasDom()) return null;
    var wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2200);
    return el;
  };

  /** 打开模态框：{title, body, actions:[{text, cls, act, close}], onMount} */
  C.modal = function modal(opts) {
    if (!hasDom()) return null;
    closeModal();
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'modal-mask';
    var html = '<div class="modal" role="dialog"><h3>' + esc(opts.title || '') + '</h3>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      '<div class="modal-actions"></div></div>';
    mask.innerHTML = html;
    document.body.appendChild(mask);

    var actions = mask.querySelector('.modal-actions');
    (opts.actions || [{ text: '关闭', cls: 'btn', act: 'close-modal' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || 'btn');
      b.textContent = a.text;
      if (a.act === 'close-modal') {
        b.addEventListener('click', closeModal);
      } else {
        b.setAttribute('data-act', a.act);
      }
      actions.appendChild(b);
    });

    mask.addEventListener('click', function (e) {
      if (e.target === mask && opts.maskClose !== false) closeModal();
    });

    if (opts.onMount) opts.onMount(mask.querySelector('.modal-body'), mask);
    return mask;
  };

  /** 关闭当前模态框（闭包内顶层声明，让 modal() 内部 addEventListener/handler 可直接引用） */
  function closeModal() {
    if (!hasDom()) return;
    var mask = document.getElementById('modal-mask');
    if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
  }
  C.closeModal = closeModal;

  /** 确认框：返回 Promise<boolean> */
  C.confirm = function confirm(title, body, okText) {
    if (!hasDom()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var done = false;
      C.modal({
        title: title,
        body: '<p>' + body + '</p>',
        maskClose: false,
        actions: [
          {
            text: '取消',
            cls: 'btn',
            act: 'confirm-no'
          },
          {
            text: okText || '确定',
            cls: 'btn btn-primary',
            act: 'confirm-yes'
          }
        ],
        onMount: function (bodyEl, mask) {
          mask.querySelector('[data-act="confirm-yes"]').addEventListener('click', function () {
            done = true;
            C.closeModal();
            resolve(true);
          });
          mask.querySelector('[data-act="confirm-no"]').addEventListener('click', function () {
            C.closeModal();
            resolve(false);
          });
        }
      });
      void done;
    });
  };

  /* 全局动作：关闭模态框 / 跳转 */
  C.globalActions = {
    'close-modal': function () {
      C.closeModal();
      return false;
    },
    go: function (ctx, state, el) {
      if (typeof location !== 'undefined') location.hash = '#/' + el.getAttribute('data-page');
      return false;
    }
  };

  /* ---------------- 格式化助手 ---------------- */

  C.money = function (fen) {
    return '¥' + fmt(fen);
  };

  C.dateShort = function (iso) {
    return String(iso || '').slice(0, 10);
  };

  /** 自绘 SVG 柱状图（不引第三方图表库） */
  C.barChart = function barChart(points, opts) {
    opts = opts || {};
    if (!points || !points.length) return C.empty('暂无数据');
    var w = opts.width || 640;
    var h = opts.height || 180;
    var padL = 44;
    var padB = 24;
    var padT = 10;
    var max = Math.max.apply(null, points.map(function (p) {
      return p.value;
    }));
    if (!isFinite(max) || max <= 0) max = 1;
    var innerW = w - padL - 8;
    var innerH = h - padB - padT;
    var step = innerW / points.length;
    var barW = Math.max(6, Math.min(38, step * 0.6));
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="xMidYMid meet" role="img">';
    // 网格线
    for (var g = 0; g <= 3; g++) {
      var y = padT + (innerH * g) / 3;
      var val = max - (max * g) / 3;
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (w - 8) + '" y2="' + y + '" stroke="#e5e7eb" stroke-width="1"/>';
      s += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#9ca3af">' +
        (val >= 10000 ? (val / 10000).toFixed(1) + '万' : Math.round(val)) + '</text>';
    }
    points.forEach(function (p, i) {
      var bh = (p.value / max) * innerH;
      var x = padL + step * i + (step - barW) / 2;
      var y = padT + innerH - bh;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, bh).toFixed(1) +
        '" rx="2" fill="' + (opts.color || '#2563eb') + '"/>';
      if (p.value > 0) {
        s += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="middle" font-size="9" fill="#6b7280">' +
          esc(String(p.labelValue === undefined ? '' : p.labelValue)) + '</text>';
      }
      s += '<text x="' + (padL + step * i + step / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="#6b7280">' +
        esc(p.label) + '</text>';
    });
    s += '</svg>';
    return s;
  };

  return C;
});
