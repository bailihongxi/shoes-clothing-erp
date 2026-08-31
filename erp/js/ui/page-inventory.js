/**
 * ui/page-inventory.js —— 库存查询（款-色-码）、颜色×尺码矩阵、预警、盘点
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.inventory || (isNode ? require('../core/inventory.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.inventory = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, inv, engine, repo, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  var page = {
    name: 'inventory',
    title: '库存管理',
    icon: '📋',

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        page: 1,
        expanded: '',
        logsSku: '',
        take: { styleCode: '', counts: {}, keyword: '' },
        takenResult: null
      };
    },

    render: function (ctx, state) {
      if (state.tab === 'alert') return renderAlert(ctx, state);
      if (state.tab === 'take') return renderTake(ctx, state);
      return renderList(ctx, state);
    },

    actions: {
      tab: function (ctx, state, el) {
        state.tab = el.getAttribute('data-tab');
        if (state.tab === 'take' && !state.take.styleCode) state.takenResult = null;
      },

      keyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },

      'take-keyword': function (ctx, state, el) {
        state.take.keyword = el.value;
      },

      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'toggle-expand': function (ctx, state, el) {
        var code = el.getAttribute('data-code');
        state.expanded = state.expanded === code ? '' : code;
      },

      'show-logs': function (ctx, state, el) {
        state.logsSku = el.getAttribute('data-sku');
      },

      'close-logs': function (ctx, state) {
        state.logsSku = '';
      },

      'pick-take-style': function (ctx, state, el) {
        state.take.styleCode = el.getAttribute('data-code');
        state.take.counts = {};
        state.takenResult = null;
      },

      /** 盘点：点格子填入当前账面数，便于从账面开始改 */
      'fill-real': function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var sku = ctx.getSku(skuId);
        state.take.counts[skuId] = sku ? sku.stock : 0;
      },

      real: function (ctx, state, el) {
        var skuId = el.getAttribute('data-sku');
        var v = el.value === '' ? '' : parseInt(el.value, 10);
        state.take.counts[skuId] = isNaN(v) ? '' : v;
      },

      'save-take': function (ctx, state) {
        var counts = {};
        Object.keys(state.take.counts).forEach(function (k) {
          if (state.take.counts[k] !== '' && state.take.counts[k] !== undefined) {
            counts[k] = parseInt(state.take.counts[k], 10);
          }
        });
        var res = engine.saveStocktake(ctx, {
          date: util.today(),
          styleCode: state.take.styleCode,
          counts: counts,
          note: ''
        });
        if (!res.ok) {
          ui.toast(res.error, 'err');
          return false;
        }
        state.takenResult = res.doc;
        state.take.counts = {};
        ui.toast('已保存盘点单 ' + res.doc.no + '，差异 ' + res.doc.diffQty + ' 件', 'ok');
        return true;
      },

      'set-threshold': function (ctx, state, el) {
        var code = el.getAttribute('data-code');
        var v = parseInt(el.value, 10);
        if (isNaN(v) || v < 0) return;
        var product = ctx.getProduct(code);
        if (!product) return;
        product.threshold = v;
        ctx.touch('products', product);
        ctx.skusOf(code).forEach(function (s) {
          s.threshold = v;
          ctx.touch('skus', s);
        });
      },

      'scan-input': function (ctx, state, payload) {
        var code = String((payload && payload.value) || '').trim();
        if (!code) return;
        state.keyword = code;
        var hit = (ctx.data.products || []).find(function (p) {
          return String(p.barcode) === code || p.styleCode === code;
        });
        if (hit) state.expanded = hit.styleCode;
      },

      /** 扫码：识别后弹出商品卡（库存页 / 盘点页入口） */
      'scan': function (ctx, state) {
        if (!ERP.scan || !ERP.scan.start) {
          ui.toast('当前环境不支持扫码，可手动输入条码', 'err');
          return;
        }
        ERP.scan.start({
          onResult: function (code) {
            if (ERP.scan && ERP.scan.openCard) ERP.scan.openCard(ctx, code, ERP.app);
            if (ERP.app) ERP.app.render();
          },
          onError: function (msg) {
            ui.toast(msg || '扫码不可用', 'err');
          }
        });
      }
    }
  };

  /* ---------------- 库存查询 ---------------- */

  function renderList(ctx, state) {
    var kw = String(state.keyword || '').trim().toUpperCase();
    var list = ctx.data.products.filter(function (p) {
      if (!kw) return true;
      if (String(p.styleCode).toUpperCase().indexOf(kw) >= 0) return true;
      if (String(p.name).toUpperCase().indexOf(kw) >= 0) return true;
      if (String(p.barcode || '').toUpperCase().indexOf(kw) >= 0) return true;
      return ctx.skusOf(p.styleCode).some(function (s) {
        return String(s.id).toUpperCase().indexOf(kw) >= 0;
      });
    });
    list = util.sortBy(list, function (p) {
      return p.styleCode;
    });
    var pg = util.paginate(list, state.page, 300);
    state.page = pg.page;

    var totalQty = 0;
    (ctx.data.skus || []).forEach(function (s) {
      totalQty += s.stock || 0;
    });

    var h = '<div class="page-head"><h2>库存管理</h2>' +
      '<span class="desc">' + list.length + ' 款 / ' + totalQty + ' 件，资金占用 ' + ui.money(inv.stockValue(ctx)) + '</span></div>';

    h += '<div class="row wrap mb8">' +
      '<button class="btn' + (state.tab === 'list' ? ' btn-primary' : '') + '" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn' + (state.tab === 'alert' ? ' btn-warn' : '') + '" data-act="tab" data-tab="alert">⚠️ 预警 ' + inv.alertStyleCount(ctx) + '</button>' +
      '<button class="btn' + (state.tab === 'take' ? ' btn-primary' : '') + '" data-act="tab" data-tab="take">🔢 盘点</button>' +
      '</div>';

    h += '<div class="card">' + ui.searchBar({ value: state.keyword, placeholder: '搜款号 / 名称 / 条码（可扫码）' }) + '</div>';

    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('没有找到商品') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>款号</th><th>名称</th><th>条码</th><th class="num">在售色码</th><th class="num">库存</th>' +
      '<th class="num">阈值</th><th>操作</th></tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var skus = ctx.skusOf(p.styleCode);
      var stock = inv.stockOfStyle(ctx, p.styleCode);
      var low = inv.getAlerts(ctx).some(function (a) {
        return a.styleCode === p.styleCode;
      });
      h += '<tr>' +
        '<td class="mono">' + esc(p.styleCode) + '</td>' +
        '<td>' + esc(p.name) + ' <span class="weak small">' + esc(p.category) + '</span></td>' +
        '<td class="mono small">' + esc(p.barcode || '-') + '</td>' +
        '<td class="num">' + skus.length + '</td>' +
        '<td class="num">' + (stock ? '<b>' + stock + '</b>' : '<span class="weak">0</span>') +
        (low ? ' ' + ui.badge('低', 'warn') : '') + '</td>' +
        '<td class="num"><input class="input" style="width:60px;text-align:right" data-change="set-threshold" data-code="' + esc(p.styleCode) + '" inputmode="numeric" value="' + (p.threshold === undefined ? ctx.settings.defaultThreshold : p.threshold) + '"></td>' +
        '<td class="act"><button data-act="toggle-expand" data-code="' + esc(p.styleCode) + '">' +
        (state.expanded === p.styleCode ? '收起' : '矩阵') + '</button></td></tr>';

      if (state.expanded === p.styleCode) {
        h += '<tr><td colspan="7" style="background:#fafafa">';
        h += '<div class="small muted mb8">颜色 × 尺码库存矩阵（点色码格子看变动明细）</div>';
        h += ui.matrixTable(inv.buildMatrix(ctx, p.styleCode), { act: 'show-logs' });
        h += '</td></tr>';
      }
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';

    if (state.logsSku) {
      var sku = ctx.getSku(state.logsSku);
      var logs = inv.logsOfSku(ctx, state.logsSku);
      h += '<div class="card"><div class="card-title">变动明细：' + esc(sku ? sku.styleCode + ' ' + sku.color + '/' + sku.size : state.logsSku) +
        '<button class="btn btn-sm" data-act="close-logs">关闭</button></div>';
      if (!logs.length) {
        h += ui.empty('暂无变动记录');
      } else {
        h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>日期</th><th>类型</th><th>单据号</th>' +
          '<th class="num">变动</th><th class="num">余额</th></tr></thead><tbody>';
        logs.slice(0, 100).forEach(function (l) {
          h += '<tr><td>' + esc(l.date) + '</td><td>' + esc(refLabel(l.refType)) + '</td>' +
            '<td class="mono small">' + esc(l.refNo || '') + '</td>' +
            '<td class="num" style="color:' + (l.delta > 0 ? '#16a34a' : '#dc2626') + '">' +
            (l.delta > 0 ? '+' : '') + l.delta + '</td>' +
            '<td class="num">' + l.balance + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '</div>';
    }
    return h;
  }

  function refLabel(refType) {
    switch (refType) {
      case 'purchase': return '进货入库';
      case 'sale': return '销售出库';
      case 'gift': return '赠送出库';
      case 'refund': return '退货入库';
      case 'stocktake': return '盘点调整';
      case 'void': return '单据作废';
      default: return refType || '-';
    }
  }

  /* ---------------- 预警 ---------------- */

  function renderAlert(ctx, state) {
    var alerts = inv.getAlerts(ctx);
    var h = '<div class="page-head"><h2>库存预警</h2><span class="desc">低于阈值的色码共 ' + alerts.length + ' 个</span></div>';
    h += '<div class="row wrap mb8">' +
      '<button class="btn" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn btn-warn" data-act="tab" data-tab="alert">⚠️ 预警 ' + inv.alertStyleCount(ctx) + '</button>' +
      '<button class="btn" data-act="tab" data-tab="take">🔢 盘点</button></div>';

    if (!alerts.length) {
      h += '<div class="card">' + ui.empty('库存充足，暂无预警') + '</div>';
      return h;
    }
    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>款号</th><th>名称</th><th>颜色</th><th>号码</th><th class="num">库存</th><th class="num">阈值</th></tr></thead><tbody>';
    alerts.slice(0, 300).forEach(function (a) {
      h += '<tr><td class="mono">' + esc(a.styleCode) + '</td><td>' + esc(a.name) + '</td>' +
        '<td>' + esc(a.color) + '</td><td>' + esc(a.size) + '</td>' +
        '<td class="num"><b style="color:' + (a.empty ? '#dc2626' : '#f59e0b') + '">' + a.stock + '</b></td>' +
        '<td class="num">' + a.threshold + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    void state;
    return h;
  }

  /* ---------------- 盘点 ---------------- */

  function renderTake(ctx, state) {
    var h = '<div class="page-head"><h2>盘点</h2><span class="desc">录入实盘数 → 自动生成盘点调整单并留痕</span></div>';
    h += '<div class="row wrap mb8">' +
      '<button class="btn" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn" data-act="tab" data-tab="alert">⚠️ 预警 ' + inv.alertStyleCount(ctx) + '</button>' +
      '<button class="btn btn-primary" data-act="tab" data-tab="take">🔢 盘点</button></div>';

    h += '<div class="card"><div class="card-title">① 选择要盘点的款</div>' +
      '<div class="row mb8"><input class="input" data-input="take-keyword" placeholder="搜索款号 / 名称 / 条码" value="' + esc(state.take.keyword) + '"></div>';
    var kw = String(state.take.keyword || '').toUpperCase();
    var styles = ctx.data.products.filter(function (p) {
      if (!kw) return true;
      return String(p.styleCode).toUpperCase().indexOf(kw) >= 0 ||
        String(p.name).toUpperCase().indexOf(kw) >= 0 ||
        String(p.barcode || '').toUpperCase().indexOf(kw) >= 0;
    }).slice(0, 20);
    if (!styles.length) {
      h += ui.empty('没有找到商品');
    } else {
      h += '<div class="chips">';
      styles.forEach(function (p) {
        h += '<button class="chip' + (p.styleCode === state.take.styleCode ? ' on' : '') + '" data-act="pick-take-style" data-code="' + esc(p.styleCode) + '">' +
          esc(p.name) + ' <span class="weak small mono">' + esc(p.styleCode) + '</span></button>';
      });
      h += '</div>';
    }
    h += '</div>';

    if (state.take.styleCode) {
      var m = inv.buildMatrix(ctx, state.take.styleCode);
      var product = ctx.getProduct(state.take.styleCode);
      h += '<div class="card"><div class="card-title">② 录入实盘数（' + esc(product ? product.name : '') + '）' +
        '<span class="more">格子内填数字，留空表示不盘</span></div>';
      h += ui.matrixTable(m, { editable: true, editableName: 'real' });
      h += '<div class="row mt8"><button class="btn btn-primary btn-block" data-act="save-take">保存盘点单</button></div>';
      h += '</div>';
    }

    var last = (ctx.data.stocktakes || []).slice(-5).reverse();
    if (last.length) {
      h += '<div class="card"><div class="card-title">最近盘点记录</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>单号</th><th>日期</th><th class="num">差异件数</th><th class="num">差异行</th></tr></thead><tbody>';
      last.forEach(function (d) {
        h += '<tr><td class="mono">' + esc(d.no) + '</td><td>' + esc(d.date) + '</td>' +
          '<td class="num">' + (d.diffQty > 0 ? '+' : '') + d.diffQty + '</td>' +
          '<td class="num">' + d.diffCount + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    if (state.takenResult) {
      var r = state.takenResult;
      h += '<div class="notice notice-info">盘点单 ' + esc(r.no) + ' 已保存：差异 ' +
        (r.diffQty > 0 ? '+' : '') + r.diffQty + ' 件（' + r.diffCount + ' 行有差异）</div>';
    }
    return h;
  }

  return page;
});
