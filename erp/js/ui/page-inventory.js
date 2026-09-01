/**
 * ui/page-inventory.js —— 库存管理（v2 薄荷绿 UI 重设计）
 *
 * 设计图 1-2（手机）+ 设计图 5（电脑）合并：
 * - 手机端：薄荷绿 banner「库存管理」+ 2 stat cards（总库存 / 资金占用）
 *          + 3 段 segmented（库存查询 / 预警 / 盘点）+ 搜索栏（带扫码）
 *          + 列表 / 预警 / 盘点 三视图（表格按 CSS 自动适配手机）
 * - 电脑端：保留原标题栏 + 3 按钮 + 表格布局，仅做视觉升级
 *
 * 业务保留：
 *  - 库存查询：按款号 / 名称 / 条码 / SKU id 搜索，可扫码定位、展开颜色×尺码矩阵
 *  - 阈值可在列表直接改，写入款与其全部色码
 *  - 预警：列出低于阈值的色码
 *  - 盘点：选款 → 填实盘数 → 自动生成盘点调整单并留痕
 *  - 变动明细：展示某色码的入库 / 出库 / 盘点流水
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

  /** 全库总件数（按 SKU 汇总） */
  function totalQty(ctx) {
    var sum = 0;
    (ctx.data.skus || []).forEach(function (s) { sum += s.stock || 0; });
    return sum;
  }

  var page = {
    name: 'inventory',
    title: '库存管理',
    icon: '📋',

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        cat: '',
        page: 1,
        expanded: '',
        logsSku: '',
        take: { styleCode: '', counts: {}, keyword: '' },
        takenResult: null
      };
    },

    render: function (ctx, st) {
      // 三个子视图的 body（共用）
      var body;
      if (st.tab === 'alert') body = renderAlert(ctx, st);
      else if (st.tab === 'take') body = renderTake(ctx, st);
      else body = renderList(ctx, st);

      // 手机端：banner + 2 stat + segmented + 搜索 + 空状态/列表
      var mobilePart =
        mobileBanner() +
        mobileStats(ctx) +
        mobileSegmented(ctx, st) +
        mobileSearch(ctx, st) +
        mobileEmpty(ctx) +
        (st.tab === 'list' && (ctx.data.products || []).length ? listTableOnly(ctx, st) : '') +
        (st.tab === 'alert' && inv.getAlerts(ctx).length ? alertTableOnly(ctx, st) : '') +
        (st.tab === 'take' ? takeOnly(ctx, st) : '');

      // 电脑端：标题 + 4 统计卡 + 3 按钮 + searchBar + body（body 内部含表格）
      var desktopPart =
        '<div class="page-head"><h2>' + pageTitle(st) + '</h2>' +
          '<span class="desc">' + pageDesc(ctx, st) + '</span></div>' +
        (st.tab === 'list' ? desktopStats(ctx) : '') +
        desktopTabs(ctx, st) +
        '<div class="card">' + ui.searchBar({ value: st.keyword, placeholder: '搜款号 / 名称 / 条码（可扫码）' }) +
        desktopFilters(ctx, st) +
        '</div>' +
        body;

      return '<div class="mobile-only">' + mobilePart + '</div>' +
             '<div class="desktop-only">' + desktopPart + '</div>';
    },

    actions: {
      tab: function (ctx, st, el) {
        st.tab = el.getAttribute('data-tab');
        if (st.tab === 'take' && !st.take.styleCode) st.takenResult = null;
      },

      keyword: function (ctx, st, el) {
        st.keyword = el.value;
        st.page = 1;
      },

      filter: function (ctx, st, el) {
        var n = el.getAttribute('data-name');
        if (n) st[n] = el.value;
        st.page = 1;
      },

      'reset-filter': function (ctx, st) {
        st.keyword = '';
        st.cat = '';
        st.page = 1;
      },

      'take-keyword': function (ctx, st, el) {
        st.take.keyword = el.value;
      },

      page: function (ctx, st, el) {
        st.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'toggle-expand': function (ctx, st, el) {
        var code = el.getAttribute('data-code');
        st.expanded = st.expanded === code ? '' : code;
      },

      'show-logs': function (ctx, st, el) {
        st.logsSku = el.getAttribute('data-sku');
      },

      'close-logs': function (ctx, st) {
        st.logsSku = '';
      },

      'pick-take-style': function (ctx, st, el) {
        st.take.styleCode = el.getAttribute('data-code');
        st.take.counts = {};
        st.takenResult = null;
      },

      /** 盘点：点格子填入当前账面数，便于从账面开始改 */
      'fill-real': function (ctx, st, el) {
        var skuId = el.getAttribute('data-sku');
        var sku = ctx.getSku(skuId);
        st.take.counts[skuId] = sku ? sku.stock : 0;
      },

      real: function (ctx, st, el) {
        var skuId = el.getAttribute('data-sku');
        var v = el.value === '' ? '' : parseInt(el.value, 10);
        st.take.counts[skuId] = isNaN(v) ? '' : v;
      },

      'save-take': function (ctx, st) {
        var counts = {};
        Object.keys(st.take.counts).forEach(function (k) {
          if (st.take.counts[k] !== '' && st.take.counts[k] !== undefined) {
            counts[k] = parseInt(st.take.counts[k], 10);
          }
        });
        var res = engine.saveStocktake(ctx, {
          date: util.today(),
          styleCode: st.take.styleCode,
          counts: counts,
          note: ''
        });
        if (!res.ok) {
          ui.toast(res.error, 'err');
          return false;
        }
        st.takenResult = res.doc;
        st.take.counts = {};
        ui.toast('已保存盘点单 ' + res.doc.no + '，差异 ' + res.doc.diffQty + ' 件', 'ok');
        return true;
      },

      'set-threshold': function (ctx, st, el) {
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

      'scan-input': function (ctx, st, payload) {
        var code = String((payload && payload.value) || '').trim();
        if (!code) return;
        st.keyword = code;
        var hit = (ctx.data.products || []).find(function (p) {
          return String(p.barcode) === code || p.styleCode === code;
        });
        if (hit) st.expanded = hit.styleCode;
      },

      /** 扫码：识别后弹出商品卡（库存页 / 盘点页入口） */
      'scan': function (ctx, st) {
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
      },

      /** banner 右上角三点菜单（占位：可扩展更多入口） */
      'inventory-menu': function (ctx, st) {
        ui.toast('更多功能即将上线', 'ok');
      }
    }
  };

  /* ---------------- 手机端片段 ---------------- */

  /** 薄荷绿 banner「库存管理」（手机端专属，电脑端有独立 page-head） */
  function mobileBanner() {
    return (
      '<div class="page-banner inventory-banner mobile-only">' +
        '<div class="banner-title">库存管理</div>' +
        '<button class="banner-action" data-act="inventory-menu" aria-label="更多">⋯</button>' +
      '</div>'
    );
  }

  /** 2 stat cards：总库存大卡 + 资金占用小卡 */
  function mobileStats(ctx) {
    var qty = totalQty(ctx);
    var styleCount = (ctx.data.products || []).length;
    var cap = inv.stockValue(ctx);
    return (
      '<div class="mobile-only inventory-stats">' +
        '<div class="stat-card stat-card-lg">' +
          '<div class="big-value">' + styleCount + '款 ' + qty + '件</div>' +
          '<div class="label">总库存</div>' +
        '</div>' +
        '<div class="stat-card stat-card-fund">' +
          '<div class="label">资金占用</div>' +
          '<div class="value">' + ui.money(cap) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /** 3 段 segmented（库存查询 / 预警 N / 盘点） */
  function mobileSegmented(ctx, st) {
    var alertCount = inv.alertStyleCount(ctx);
    return (
      '<div class="mobile-only segmented inventory-seg">' +
        '<button class="seg-item' + (st.tab === 'list' ? ' on' : '') + '" data-act="tab" data-tab="list">' +
          '<span class="ico">🔍</span><span>库存查询</span>' +
        '</button>' +
        '<button class="seg-item' + (st.tab === 'alert' ? ' on' : '') + '" data-act="tab" data-tab="alert">' +
          '<span class="ico">⚠</span><span>预警</span>' +
          '<span class="count">' + alertCount + '</span>' +
        '</button>' +
        '<button class="seg-item' + (st.tab === 'take' ? ' on' : '') + '" data-act="tab" data-tab="take">' +
          '<span class="ico">▦</span><span>盘点</span>' +
        '</button>' +
      '</div>'
    );
  }

  /** 手机端搜索栏（含扫码按钮） */
  function mobileSearch(ctx, st) {
    return (
      '<div class="mobile-only card inventory-search">' +
        '<div class="search-bar">' +
          '<span class="ico">🔍</span>' +
          '<input class="input" data-input="keyword" placeholder="搜款号 / 名称 / 条码（可扫码）" value="' + esc(st.keyword) + '">' +
          '<button class="btn" data-act="scan" title="扫码">📷</button>' +
        '</div>' +
      '</div>'
    );
  }

  /** 手机端空状态卡片（暂无商品数据 → 去进货 CTA） */
  function mobileEmpty(ctx) {
    if ((ctx.data.products || []).length) return '';
    if (ctx.settings._hideEmptyTake) return ''; // 盘点页等场景允许隐藏
    return (
      '<div class="mobile-only empty-state-card">' +
        '<div class="illu">🗄️</div>' +
        '<div class="text">暂无商品数据</div>' +
        '<button class="btn btn-primary" data-act="go" data-page="purchase">去进货</button>' +
      '</div>'
    );
  }

  /* ---------------- 电脑端片段 ---------------- */

  function pageTitle(st) {
    if (st.tab === 'alert') return '库存预警';
    if (st.tab === 'take') return '盘点';
    return '库存管理';
  }

  function pageDesc(ctx, st) {
    if (st.tab === 'alert') return '低于阈值的色码共 ' + inv.getAlerts(ctx).length + ' 个';
    if (st.tab === 'take') return '录入实盘数 → 自动生成盘点调整单并留痕';
    var list = filterList(ctx, st);
    return list.length + ' 款 / ' + totalQty(ctx) + ' 件，资金占用 ' + ui.money(inv.stockValue(ctx));
  }

  function desktopTabs(ctx, st) {
    return '<div class="row wrap mb8">' +
      '<button class="btn' + (st.tab === 'list' ? ' btn-primary' : '') + '" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn' + (st.tab === 'alert' ? ' btn-warn' : '') + '" data-act="tab" data-tab="alert">⚠️ 预警 ' + inv.alertStyleCount(ctx) + '</button>' +
      '<button class="btn' + (st.tab === 'take' ? ' btn-primary' : '') + '" data-act="tab" data-tab="take">🔢 盘点</button>' +
      '</div>';
  }

  /** 电脑端 4 统计卡（设计图 1-5）：总款式 / 总件数 / 资金占用 / 低库存预警 */
  function desktopStats(ctx) {
    var styleCount = (ctx.data.products || []).length;
    var qty = totalQty(ctx);
    var cap = inv.stockValue(ctx);
    var alertCount = inv.getAlerts(ctx).length;
    return (
      '<div class="stat-grid desktop-stats">' +
        '<div class="stat-card">' +
          '<div class="icon mint">👟</div>' +
          '<div class="label">总款式</div>' +
          '<div class="value">' + styleCount + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="icon gray">📦</div>' +
          '<div class="label">总件数</div>' +
          '<div class="value">' + fmtNum(qty) + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="icon lemon">💰</div>' +
          '<div class="label">资金占用</div>' +
          '<div class="value">' + ui.money(cap) + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="icon pink">⚠️</div>' +
          '<div class="label">低库存预警</div>' +
          '<div class="value">' + fmtNum(alertCount) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /** 电脑端筛选条（设计图 1-5）：分类下拉 + 重置 / 搜索 */
  function desktopFilters(ctx, st) {
    var cats = [];
    (ctx.data.products || []).forEach(function (p) {
      // V3 经营范围：分类筛选项只含本账号分类
      if (!schema.inScope(ctx.settings, p.category)) return;
      if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    });
    var opts = [{ value: '', text: '全部分类' }].concat(cats.map(function (c) {
      return { value: c, text: c };
    }));
    return (
      '<div class="row wrap mt8">' +
        ui.select({ name: 'cat', value: st.cat, on: 'filter', options: opts }) +
        '<div class="spacer"></div>' +
        '<button class="btn" data-act="reset-filter">重置</button>' +
      '</div>'
    );
  }

  /** 千分位格式化 */
  function fmtNum(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ---------------- 共用业务逻辑 ---------------- */

  function filterList(ctx, st) {
    var kw = String(st.keyword || '').trim().toUpperCase();
    var cat = String(st.cat || '');
    return ctx.data.products.filter(function (p) {
      // V3 经营范围：只显示本账号分类商品
      if (!schema.inScope(ctx.settings, p.category)) return false;
      if (cat && String(p.category || '') !== cat) return false;
      if (!kw) return true;
      if (String(p.styleCode).toUpperCase().indexOf(kw) >= 0) return true;
      if (String(p.name).toUpperCase().indexOf(kw) >= 0) return true;
      if (String(p.barcode || '').toUpperCase().indexOf(kw) >= 0) return true;
      return ctx.skusOf(p.styleCode).some(function (s) {
        return String(s.id).toUpperCase().indexOf(kw) >= 0;
      });
    });
  }

  /** 电脑端库存列表（含完整标题/按钮/搜索/表格） */
  function renderList(ctx, st) {
    var list = util.sortBy(filterList(ctx, st), function (p) { return p.styleCode; });
    var pg = util.paginate(list, st.page, 300);
    st.page = pg.page;

    var h = '';
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
        (st.expanded === p.styleCode ? '收起' : '矩阵') + '</button></td></tr>';

      if (st.expanded === p.styleCode) {
        h += '<tr><td colspan="7" style="background:#fafafa">';
        h += '<div class="small muted mb8">颜色 × 尺码库存矩阵（点色码格子看变动明细）</div>';
        h += ui.matrixTable(inv.buildMatrix(ctx, p.styleCode), { act: 'show-logs' });
        h += '</td></tr>';
      }
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';

    if (st.logsSku) {
      var sku = ctx.getSku(st.logsSku);
      var logs = inv.logsOfSku(ctx, st.logsSku);
      h += '<div class="card"><div class="card-title">变动明细：' + esc(sku ? sku.styleCode + ' ' + sku.color + '/' + sku.size : st.logsSku) +
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

  /** 手机端库存列表（只渲染表格，不含头部） */
  function listTableOnly(ctx, st) {
    var list = util.sortBy(filterList(ctx, st), function (p) { return p.styleCode; });
    var pg = util.paginate(list, st.page, 300);
    st.page = pg.page;

    if (!pg.items.length) return '';
    var h = '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>款号</th><th>名称</th><th class="num">库存</th></tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var stock = inv.stockOfStyle(ctx, p.styleCode);
      var low = inv.getAlerts(ctx).some(function (a) {
        return a.styleCode === p.styleCode;
      });
      h += '<tr>' +
        '<td class="mono">' + esc(p.styleCode) + '</td>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td class="num">' + (stock ? '<b>' + stock + '</b>' : '<span class="weak">0</span>') +
        (low ? ' ' + ui.badge('低', 'warn') : '') + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div></div>';
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

  function renderAlert(ctx, st) {
    var alerts = inv.getAlerts(ctx);
    if (!alerts.length) {
      return '<div class="card">' + ui.empty('库存充足，暂无预警') + '</div>';
    }
    var h = '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>款号</th><th>名称</th><th>颜色</th><th>号码</th><th class="num">库存</th><th class="num">阈值</th></tr></thead><tbody>';
    alerts.slice(0, 300).forEach(function (a) {
      h += '<tr><td class="mono">' + esc(a.styleCode) + '</td><td>' + esc(a.name) + '</td>' +
        '<td>' + esc(a.color) + '</td><td>' + esc(a.size) + '</td>' +
        '<td class="num"><b style="color:' + (a.empty ? '#dc2626' : '#f59e0b') + '">' + a.stock + '</b></td>' +
        '<td class="num">' + a.threshold + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    void st;
    return h;
  }

  /** 手机端预警表（精简列） */
  function alertTableOnly(ctx, st) {
    var alerts = inv.getAlerts(ctx);
    if (!alerts.length) {
      return '<div class="card empty-state-card"><div class="text">暂无预警，库存充足</div></div>';
    }
    var h = '<div class="card"><ul class="alert-list">';
    alerts.slice(0, 100).forEach(function (a) {
      h += '<li class="alert-item">' +
        '<span class="style">' + esc(a.name) + ' <span class="muted small mono">' + esc(a.styleCode) + '</span></span>' +
        '<span class="cs">' + esc(a.color) + '/' + esc(a.size) + '</span>' +
        '<span class="qty"><b>' + a.stock + '</b>/' + a.threshold + '</span>' +
      '</li>';
    });
    h += '</ul></div>';
    void st;
    return h;
  }

  /* ---------------- 盘点 ---------------- */

  function renderTake(ctx, st) {
    var h = '<div class="card"><div class="card-title">① 选择要盘点的款</div>' +
      '<div class="row mb8"><input class="input" data-input="take-keyword" placeholder="搜索款号 / 名称 / 条码" value="' + esc(st.take.keyword) + '"></div>';
    var kw = String(st.take.keyword || '').toUpperCase();
    var styles = ctx.data.products.filter(function (p) {
      if (!schema.inScope(ctx.settings, p.category)) return false; // V3 经营范围
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
        h += '<button class="chip' + (p.styleCode === st.take.styleCode ? ' on' : '') + '" data-act="pick-take-style" data-code="' + esc(p.styleCode) + '">' +
          esc(p.name) + ' <span class="weak small mono">' + esc(p.styleCode) + '</span></button>';
      });
      h += '</div>';
    }
    h += '</div>';

    if (st.take.styleCode) {
      var m = inv.buildMatrix(ctx, st.take.styleCode);
      var product = ctx.getProduct(st.take.styleCode);
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

    if (st.takenResult) {
      var r = st.takenResult;
      h += '<div class="notice notice-info">盘点单 ' + esc(r.no) + ' 已保存：差异 ' +
        (r.diffQty > 0 ? '+' : '') + r.diffQty + ' 件（' + r.diffCount + ' 行有差异）</div>';
    }
    return h;
  }

  /** 手机端盘点（精简样式：chips 用 wrap） */
  function takeOnly(ctx, st) {
    var h = '<div class="card"><div class="card-title">选择要盘点的款</div>' +
      '<div class="row mb8"><input class="input" data-input="take-keyword" placeholder="搜索款号 / 名称" value="' + esc(st.take.keyword) + '"></div>';
    var kw = String(st.take.keyword || '').toUpperCase();
    var styles = ctx.data.products.filter(function (p) {
      if (!schema.inScope(ctx.settings, p.category)) return false; // V3 经营范围
      if (!kw) return true;
      return String(p.styleCode).toUpperCase().indexOf(kw) >= 0 ||
        String(p.name).toUpperCase().indexOf(kw) >= 0;
    }).slice(0, 20);
    if (!styles.length) {
      h += ui.empty('没有找到商品');
    } else {
      h += '<div class="chips">';
      styles.forEach(function (p) {
        h += '<button class="chip' + (p.styleCode === st.take.styleCode ? ' on' : '') + '" data-act="pick-take-style" data-code="' + esc(p.styleCode) + '">' +
          esc(p.name) + ' <span class="weak small mono">' + esc(p.styleCode) + '</span></button>';
      });
      h += '</div>';
    }
    h += '</div>';

    if (st.take.styleCode) {
      var m = inv.buildMatrix(ctx, st.take.styleCode);
      var product = ctx.getProduct(st.take.styleCode);
      h += '<div class="card"><div class="card-title">录入实盘数（' + esc(product ? product.name : '') + '）</div>';
      h += ui.matrixTable(m, { editable: true, editableName: 'real' });
      h += '<div class="row mt8"><button class="btn btn-primary btn-block" data-act="save-take">保存盘点单</button></div>';
      h += '</div>';
    }

    var last = (ctx.data.stocktakes || []).slice(-5).reverse();
    if (last.length) {
      h += '<div class="card"><div class="card-title">最近盘点记录</div><ul class="stocktake-list">';
      last.forEach(function (d) {
        h += '<li><span class="mono">' + esc(d.no) + '</span><span>' + esc(d.date) + '</span>' +
          '<span class="diff">差异 ' + (d.diffQty > 0 ? '+' : '') + d.diffQty + ' 件</span></li>';
      });
      h += '</ul></div>';
    }

    if (st.takenResult) {
      var r = st.takenResult;
      h += '<div class="notice notice-info">盘点单 ' + esc(r.no) + ' 已保存：差异 ' +
        (r.diffQty > 0 ? '+' : '') + r.diffQty + ' 件（' + r.diffCount + ' 行有差异）</div>';
    }
    return h;
  }

  return page;
});