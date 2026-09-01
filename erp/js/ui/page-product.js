/**
 * ui/page-product.js —— 商品档案：新款建档（4 项即可）+ 列表 + CSV 导入
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP;
  var mod = factory(
    ERP.coding || (isNode ? require('../core/coding.js') : null),
    ERP.ui || (isNode ? require('./components.js') : null),
    ERP.util || (isNode ? require('../core/util.js') : null),
    ERP.schema || (isNode ? require('../core/schema.js') : null),
    ERP.repo || (isNode ? require('../store/repo.js') : null),
    ERP.render || (isNode ? require('../barcode/render.js') : null),
    ERP.label || (isNode ? require('../barcode/label.js') : null),
    ERP.excel || (isNode ? require('../core/excel.js') : null),
    ERP
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.product = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (coding, ui, util, schema, repo, render, label, excel, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  var PRESET_COLORS = ['白', '黑', '灰', '米白', '棕', '卡其', '红', '蓝', '绿', '粉', '杏', '银'];

  function presetSizes(category) {
    switch (category) {
      case '鞋':
        // 从童码（小朋友鞋）从小到大排，再到成人；去掉 0.5 半号
        return ['26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44'];
      case '服装':
        // 童装按身高(cm)从小到大，再到成人 S~3XL（含均码）
        return ['90', '100', '110', '120', '130', '140', '150', 'S', 'M', 'L', 'XL', '2XL', '3XL', '均码'];
      case '裤':
        // 童裤腰围从小到大，再到成人
        return ['22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
      case '包袋':
      case '配饰':
        return ['均码'];
      default:
        return ['均码', 'S', 'M', 'L', 'XL'];
    }
  }

  function emptyForm() {
    var cats = (ERP.app && ERP.app.ctx && ERP.app.ctx.settings)
      ? schema.categoriesFor(ERP.app.ctx.settings)
      : schema.CATEGORIES.slice();
    return {
      name: '',
      // V3 经营范围：默认分类取本账号第一个可见分类
      category: (cats && cats.length ? cats[0] : '鞋'),
      brand: '',
      costPrice: '',
      salePrice: '',
      threshold: String((ERP.app && ERP.app.ctx && ERP.app.ctx.settings.defaultThreshold) || 3),
      colors: [],
      sizes: [],
      styleCode: ''
    };
  }

  var page = {
    name: 'product',
    title: '商品档案',
    icon: '📦',

    /** 生成条码标签并打印（浏览器）：每个色码一张，条码同为款号 */
    openPrint: function (ctx, state, code) {
      code = String(code || '').toUpperCase();
      var p = ctx.getProduct(code);
      if (!p) { ui.toast('未找到该款', 'err'); return; }
      var skus = ctx.skusOf(code);
      if (!skus.length) { ui.toast('该款还没有色码', 'err'); return; }
      var shop = (ctx.settings && ctx.settings.shopName) || '我的鞋服店';
      var labels = skus.map(function (s) {
        return label.buildLabelData({
          name: p.name, styleCode: p.styleCode, color: s.color, size: s.size,
          salePrice: p.salePrice, barcode: p.barcode || p.styleCode
        }, { shop: shop });
      });
      var html = label.printPage(labels);
      html = html.replace(/<div class="lb-barcode" data-barcode="([^"]*)"><\/div>/g, function (m, bc) {
        return '<div class="lb-barcode">' + render.svg(bc, { dpi: 203, heightMm: 10 }) + '</div>';
      });
      if (typeof window === 'undefined' || !window.open) {
        ui.toast('当前环境无法打印', 'err'); return;
      }
      var win = window.open('', '_blank');
      if (!win) { ui.toast('打印窗口被拦截，请允许弹窗', 'err'); return; }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      p.printedAt = new Date().toISOString();
      ctx.touch('products', p);
      repo.log(ctx, '打印标签', '款号 ' + code + '，' + labels.length + ' 张');
    },

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        filterBarcode: 'all',
        filterPrinted: 'all',
        filterStatus: 'all',
        page: 1,
        form: emptyForm(),
        editing: null,
        csvText: '',
        csvResult: null
      };
    },

    /* ---------------- 渲染入口 ---------------- */

    render: function (ctx, state) {
      if (state.tab === 'new') return renderForm(ctx, state);
      if (state.tab === 'csv') return renderCsv(ctx, state);
      return renderList(ctx, state);
    },

    /* ---------------- 动作 ---------------- */

    actions: {
      'open-new': function (ctx, state) {
        state.tab = 'new';
        state.editing = null;
        state.form = emptyForm();
      },

      'cancel-form': function (ctx, state) {
        state.tab = 'list';
        state.form = emptyForm();
        state.editing = null;
      },

      field: function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        state.form[name] = el.value;
        if (name === 'category') {
          // 切换类别后，尺码预置换一套，已选但不在预置里的保留
          var preset = presetSizes(state.form.category);
          state.form.sizes = state.form.sizes.filter(function (s) {
            return preset.indexOf(s) >= 0;
          });
        }
      },

      'toggle-color': function (ctx, state, el) {
        var v = el.getAttribute('data-value');
        var i = state.form.colors.indexOf(v);
        if (i >= 0) state.form.colors.splice(i, 1);
        else state.form.colors.push(v);
      },

      'toggle-size': function (ctx, state, el) {
        var v = el.getAttribute('data-value');
        var i = state.form.sizes.indexOf(v);
        if (i >= 0) state.form.sizes.splice(i, 1);
        else state.form.sizes.push(v);
      },

      'add-color': function (ctx, state, el) {
        var input = document.querySelector('[data-input="newColor"]');
        var v = util.cleanColor(input ? input.value : el.getAttribute('data-value'));
        if (v && state.form.colors.indexOf(v) < 0) state.form.colors.push(v);
        if (input) input.value = '';
      },

      'add-size': function (ctx, state, el) {
        var input = document.querySelector('[data-input="newSize"]');
        var v = util.cleanSize(input ? input.value : el.getAttribute('data-value'));
        if (v && state.form.sizes.indexOf(v) < 0) state.form.sizes.push(v);
        if (input) input.value = '';
      },

      'save-product': function (ctx, state, el) {
        return save(ctx, state, false);
      },

      'save-print': function (ctx, state) {
        return save(ctx, state, true);
      },

      'edit-product': function (ctx, state, el) {
        var code = el.getAttribute('data-code');
        var p = ctx.getProduct(code);
        if (!p) return;
        state.editing = code;
        state.tab = 'new';
        state.form = {
          name: p.name,
          category: p.category,
          brand: p.brand || '',
          costPrice: p.costPrice ? util.fenToYuan(p.costPrice) : '',
          salePrice: p.salePrice ? util.fenToYuan(p.salePrice) : '',
          threshold: String(p.threshold === undefined ? ctx.settings.defaultThreshold : p.threshold),
          colors: [],
          sizes: [],
          styleCode: p.styleCode
        };
      },

      'toggle-status': function (ctx, state, el) {
        var code = el.getAttribute('data-code');
        var p = ctx.getProduct(code);
        if (!p) return;
        p.status = p.status === schema.STATUS.ON ? schema.STATUS.OFF : schema.STATUS.ON;
        ctx.touch('products', p);
        ctx.skusOf(code).forEach(function (s) {
          s.status = p.status;
          ctx.touch('skus', s);
        });
        repo.log(ctx, p.status === schema.STATUS.ON ? '商品上架' : '商品停售', '款号 ' + code);
      },

      filter: function (ctx, state, el) {
        var key = el.getAttribute('data-name');
        state[key] = el.value;
        state.page = 1;
      },

      keyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },

      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'open-csv': function (ctx, state) {
        state.tab = 'csv';
        state.csvResult = null;
      },

      'csv-text': function (ctx, state, el) {
        state.csvText = el.value;
      },

      'do-import': function (ctx, state) {
        var parsed = util.parseCSV(state.csvText);
        var res = coding.importFromRows(parsed.rows, ctx);
        state.csvResult = res;
        repo.log(ctx, 'CSV 导入', '新增 ' + res.created + ' 款 / ' + res.skus + ' 个色码');
        if (res.errors.length === 0) state.csvText = '';
      },

      /** 选择文件直接导入：CSV 读取文本，Excel(xlsx/xls) 解析首个工作表并转为 CSV 填入粘贴框 */
      'pick-import-file': function (ctx, state, el) {
        if (typeof window === 'undefined' || !window.FileReader) return false; // Node 测试不执行
        var file = el && el.files && el.files[0];
        if (!file) return false;
        var name = String(file.name || '').toLowerCase();
        var isCsv = name.slice(-4) === '.csv' || String(file.type || '').indexOf('csv') >= 0;
        var reader = new FileReader();
        var finish = function (text) {
          state.csvText = text;
          if (window.ERP && ERP.app && ERP.app.render) ERP.app.render();
          ui.toast('已读取「' + file.name + '」，请确认后点「开始导入」', 'ok');
        };
        reader.onload = function () {
          try {
            if (isCsv) {
              finish(String(reader.result || ''));
            } else {
              finish(excel.rowsToCsv(excel.parse(reader.result)));
            }
          } catch (e) {
            ui.toast('解析文件失败：' + (e && e.message ? e.message : e), 'err');
          }
        };
        reader.onerror = function () {
          ui.toast('读取文件失败，请重试', 'err');
        };
        if (isCsv) reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
        return false; // 异步读取完成后手动 render，不触发立即重渲染
      },

      'download-template': function (ctx, state, el) {
        if (!ERP.app || !ERP.app.download) return;
        var csv = util.toCSV(['名称', '类别', '颜色', '号码', '进价', '售价', '品牌', '条码'], [
          ['小白鞋', '鞋', '白、黑', '38、39、40', '50', '129', '', ''],
          ['纯棉T恤', '服装', '白', 'M、L、XL', '30', '79', '', '']
        ]);
        ERP.app.download('商品导入模板.csv', csv, 'text/csv');
      },

      'print-label': function (ctx, state, el) {
        var code = el.getAttribute('data-code');
        if (ERP.pages && ERP.pages.product && ERP.pages.product.openPrint) {
          ERP.pages.product.openPrint(ctx, state, code);
        }
      },

      'scan-input': function (ctx, state, payload) {
        // 搜索框内扫码/输入条码 → 命中该款直接定位
        var code = String((payload && payload.value) || '').trim();
        if (!code) return;
        state.keyword = code;
        state.page = 1;
      }
    }
  };

  /* ---------------- 保存 ---------------- */

  function save(ctx, state, andPrint) {
    var form = state.form;
    if (state.editing) {
      var code = state.editing;
      var p = ctx.getProduct(code);
      if (!p) return false;
      var newCode = util.cleanText(form.styleCode).toUpperCase();
      if (newCode && newCode !== code) {
        var r = coding.renameStyleCode(code, newCode, ctx);
        if (!r.ok) {
          ui.toast(r.error, 'err');
          return false;
        }
        code = newCode;
        if (r.warning) ui.toast(r.warning, 'ok');
      }
      p = ctx.getProduct(code);
      p.name = util.cleanText(form.name) || p.name;
      p.brand = util.cleanText(form.brand);
      p.costPrice = util.parseMoney(form.costPrice);
      p.salePrice = util.parseMoney(form.salePrice);
      p.threshold = parseInt(form.threshold, 10) || ctx.settings.defaultThreshold;
      ctx.touch('products', p);
      repo.log(ctx, '修改商品', '款号 ' + code);
      ui.toast('已保存', 'ok');
      state.tab = 'list';
      state.editing = null;
      return true;
    }

    var res = coding.create(
      {
        name: form.name,
        category: form.category,
        brand: form.brand,
        costPrice: form.costPrice,
        salePrice: form.salePrice,
        colors: form.colors,
        sizes: form.sizes,
        threshold: form.threshold
      },
      ctx
    );
    if (!res.ok) {
      ui.toast((res.errors || []).join('；') || '保存失败', 'err');
      return false;
    }
    repo.log(
      ctx,
      '新建商品',
      '款号 ' + res.styleCode + '，新增 ' + res.created + ' 个色码'
    );
    var msg = '已生成 ' + res.created + ' 个色码，款号 ' + res.styleCode;
    if (res.duplicates.length) {
      msg += '（跳过 ' + res.duplicates.length + ' 个已存在色码）';
    }
    ui.toast(msg, 'ok');

    state.tab = 'list';
    state.form = emptyForm();
    if (andPrint && ERP.pages && ERP.pages.product && ERP.pages.product.openPrint) {
      // 打印属于附加动作：即使打印失败，保存本身已成功——捕获异常避免误报「操作失败」且页面已切回列表
      try {
        ERP.pages.product.openPrint(ctx, state, res.styleCode);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('打印标签失败：', e);
        ui.toast('已保存，但打印标签失败：' + (e && e.message ? e.message : e), 'err');
      }
    }
    return true;
  }

  /* ---------------- 列表 ---------------- */

  function renderList(ctx, state) {
    // V3 经营范围：商品列表只显示本账号分类商品
    var list = ctx.data.products.filter(function (p) {
      return schema.inScope(ctx.settings, p.category);
    });
    var kw = String(state.keyword || '').trim().toUpperCase();
    if (kw) {
      list = list.filter(function (p) {
        var inSku = ctx.skusOf(p.styleCode).some(function (s) {
          return String(s.id).toUpperCase().indexOf(kw) >= 0;
        });
        return (
          String(p.styleCode).toUpperCase().indexOf(kw) >= 0 ||
          String(p.name).toUpperCase().indexOf(kw) >= 0 ||
          String(p.barcode || '').toUpperCase().indexOf(kw) >= 0 ||
          inSku
        );
      });
    }
    if (state.filterBarcode === 'has') {
      list = list.filter(function (p) {
        return !!p.barcode;
      });
    } else if (state.filterBarcode === 'none') {
      list = list.filter(function (p) {
        return !p.barcode;
      });
    }
    if (state.filterPrinted === 'printed') {
      list = list.filter(function (p) {
        return !!p.printedAt;
      });
    } else if (state.filterPrinted === 'unprinted') {
      list = list.filter(function (p) {
        return !p.printedAt;
      });
    }
    if (state.filterStatus !== 'all') {
      list = list.filter(function (p) {
        return (p.status || schema.STATUS.ON) === state.filterStatus;
      });
    }
    list = util.sortBy(list, function (p) {
      return p.styleCode;
    });

    var pg = util.paginate(list, state.page, 300);
    state.page = pg.page;

    var h = '';
    h += '<div class="page-head"><h2>商品档案</h2>' +
      '<span class="desc">共 ' + ctx.data.products.length + ' 款 / ' + ctx.data.skus.length + ' 个色码</span>' +
      '<div class="actions">' +
      '<button class="btn" data-act="open-csv">📥 CSV 导入</button>' +
      '<button class="btn btn-primary" data-act="open-new">＋ 新款建档</button>' +
      '</div></div>';

    h += '<div class="card">' + ui.searchBar({ value: state.keyword, placeholder: '搜索款号 / 名称 / 条码 / SKU id' });
    h += '<div class="row wrap">' +
      ui.select({
        name: 'filterBarcode',
        value: state.filterBarcode,
        on: 'filter',
        options: [
          { value: 'all', text: '全部条码' },
          { value: 'has', text: '有条码' },
          { value: 'none', text: '无条码' }
        ]
      }) +
      ui.select({
        name: 'filterPrinted',
        value: state.filterPrinted,
        on: 'filter',
        options: [
          { value: 'all', text: '全部打印状态' },
          { value: 'printed', text: '已打印' },
          { value: 'unprinted', text: '未打印' }
        ]
      }) +
      ui.select({
        name: 'filterStatus',
        value: state.filterStatus,
        on: 'filter',
        options: [
          { value: 'all', text: '全部状态' },
          { value: 'on', text: '在售' },
          { value: 'off', text: '停售' }
        ]
      }) +
      '</div></div>';

    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('没有匹配的商品，点右上角「新款建档」添加') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>款号</th><th>名称 / 品牌</th><th>类别</th><th class="num">售价</th>' +
      '<th class="num">色码</th><th class="num">库存</th><th>条码</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var skus = ctx.skusOf(p.styleCode);
      var stock = 0;
      skus.forEach(function (s) {
        stock += s.stock || 0;
      });
      h += '<tr>' +
        '<td class="mono">' + esc(p.styleCode) + '</td>' +
        '<td>' + esc(p.name) + (p.brand ? ' <span class="weak small">' + esc(p.brand) + '</span>' : '') + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td class="num">' + ui.money(p.salePrice) + '</td>' +
        '<td class="num">' + skus.length + '</td>' +
        '<td class="num">' + stock + '</td>' +
        '<td class="mono small">' + esc(p.barcode || '-') +
        (p.printedAt ? ' <span class="badge on">已打印</span>' : '') + '</td>' +
        '<td>' + ui.badge(p.status === schema.STATUS.OFF ? '停售' : '在售', p.status === schema.STATUS.OFF ? 'off' : 'on') + '</td>' +
        '<td class="act">' +
        '<button data-act="edit-product" data-code="' + esc(p.styleCode) + '">编辑</button>' +
        '<button data-act="print-label" data-code="' + esc(p.styleCode) + '">打标签</button>' +
        '<button data-act="toggle-status" data-code="' + esc(p.styleCode) + '">' +
        (p.status === schema.STATUS.OFF ? '上架' : '停售') + '</button>' +
        '</td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';
    return h;
  }

  /* ---------------- 建档表单 ---------------- */

  function renderForm(ctx, state) {
    var form = state.form;
    var pv = coding.preview(
      {
        name: form.name,
        category: form.category,
        colors: form.colors,
        sizes: form.sizes,
        styleCode: state.editing ? form.styleCode : ''
      },
      ctx
    );

    var h = '<div class="page-head"><h2>' + (state.editing ? '编辑商品' : '新款建档') + '</h2>' +
      '<span class="desc">只填名称 / 类别 / 颜色 / 号码，款号与条码自动生成</span></div>';

    /* 实时预览 */
    if (pv.ok && pv.rows.length) {
      h += '<div class="preview-box mb8">' +
        '将生成：款号 <b>' + esc(pv.styleCode) + '</b>（' + (pv.isNewStyle ? '新开款' : '复用同款 ' + esc(pv.reusedStyleCode || '')) + '）' +
        '　条码 <b>' + esc(pv.rows[0].barcode) + '</b>' +
        '　新增 <b>' + pv.newCount + '</b> 个色码' +
        (pv.duplicateCount ? '　<span style="color:#b45309">跳过重复 ' + pv.duplicateCount + ' 个</span>' : '') +
        '</div>';
    } else if (pv.errors.length) {
      h += '<div class="notice notice-warn">' + esc(pv.errors.join('；')) + '</div>';
    }

    h += '<div class="card">';
    h += '<div class="field"><label class="req">名称</label>' +
      '<input class="input" data-input="field" data-name="name" data-live="1" placeholder="如：小白鞋" value="' + esc(form.name) + '"></div>';
    h += '<div class="field"><label class="req">类别</label>' +
      ui.select({
        name: 'category',
        value: form.category,
        on: 'field',
        options: schema.categoriesFor(ctx.settings).map(function (c) {
          return { value: c, text: c + '（' + coding.prefixOf(c, ctx.settings) + '）' };
        })
      }) + '</div>';
    h += '<div class="grid grid-2">' +
      '<div class="field"><label>参考进价（元）</label>' +
      '<input class="input" data-input="field" data-name="costPrice" data-live="1" inputmode="decimal" placeholder="如 50" value="' + esc(form.costPrice) + '"></div>' +
      '<div class="field"><label>默认售价（元）</label>' +
      '<input class="input" data-input="field" data-name="salePrice" data-live="1" inputmode="decimal" placeholder="如 129" value="' + esc(form.salePrice) + '"></div>' +
      '</div>';
    h += '<div class="grid grid-2">' +
      '<div class="field"><label>品牌（选填）</label>' +
      '<input class="input" data-input="field" data-name="brand" placeholder="选填" value="' + esc(form.brand) + '"></div>' +
      '<div class="field"><label>预警阈值（件）</label>' +
      '<input class="input" data-input="field" data-name="threshold" inputmode="numeric" value="' + esc(form.threshold) + '"></div>' +
      '</div>';

    if (state.editing) {
      h += '<div class="field"><label>款号（可改，改后需重新打印标签）</label>' +
        '<input class="input" data-input="field" data-name="styleCode" value="' + esc(form.styleCode) + '"></div>';
    }

    /* 颜色多选 */
    h += '<div class="field"><label class="req">颜色（可多选）</label><div class="chips">';
    PRESET_COLORS.forEach(function (c) {
      h += '<button class="chip' + (form.colors.indexOf(c) >= 0 ? ' on' : '') + '" data-act="toggle-color" data-value="' + esc(c) + '">' + esc(c) + '</button>';
    });
    form.colors.forEach(function (c) {
      if (PRESET_COLORS.indexOf(c) < 0) {
        h += '<button class="chip on" data-act="toggle-color" data-value="' + esc(c) + '">' + esc(c) + ' ✕</button>';
      }
    });
    h += '</div><div class="row mt8">' +
      '<input class="input" data-input="newColor" placeholder="自定义颜色，如：奶茶色">' +
      '<button class="btn" data-act="add-color">添加</button></div></div>';

    /* 号码多选 */
    var sizes = presetSizes(form.category);
    h += '<div class="field"><label class="req">号码（可多选）</label><div class="chips">';
    sizes.forEach(function (s) {
      h += '<button class="chip' + (form.sizes.indexOf(s) >= 0 ? ' on' : '') + '" data-act="toggle-size" data-value="' + esc(s) + '">' + esc(s) + '</button>';
    });
    form.sizes.forEach(function (s) {
      if (sizes.indexOf(s) < 0) {
        h += '<button class="chip on" data-act="toggle-size" data-value="' + esc(s) + '">' + esc(s) + ' ✕</button>';
      }
    });
    h += '</div><div class="row mt8">' +
      '<input class="input" data-input="newSize" placeholder="自定义号码，如：45">' +
      '<button class="btn" data-act="add-size">添加</button></div></div>';

    h += '</div>';

    /* 将生成的色码清单 */
    if (pv.rows.length) {
      h += '<div class="card"><div class="card-title">将生成的色码（' + pv.newCount + ' 个）</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>颜色</th><th>号码</th><th>SKU id</th><th>条码</th><th>状态</th></tr></thead><tbody>';
      pv.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.color) + '</td><td>' + esc(r.size) + '</td>' +
          '<td class="mono">' + esc(r.skuId) + '</td>' +
          '<td class="mono">' + esc(r.barcode) + '</td>' +
          '<td>' + (r.exists ? ui.badge('已存在', 'warn') : ui.badge('新建', 'on')) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    h += '<div class="row">' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" data-act="save-product">保存</button>' +
      (state.editing ? '' : '<button class="btn btn-primary" data-act="save-print">保存并打印</button>') +
      '</div>';
    return h;
  }

  /* ---------------- CSV 导入 ---------------- */

  function renderCsv(ctx, state) {
    var h = '<div class="page-head"><h2>CSV 批量导入</h2>' +
      '<span class="desc">表头需含：名称、类别、颜色、号码，可选修：进价、售价、品牌、款号、条码</span></div>';
    h += '<div class="card">' +
      '<div class="field"><label>① 直接选择文件导入（支持 CSV / Excel .xlsx .xls）</label>' +
      '<input class="input" type="file" accept=".csv,.xlsx,.xls,text/csv" data-change="pick-import-file">' +
      '<div class="small muted mt4">选择本地 CSV 或 Excel 文件，内容将自动填入下方粘贴框，可修改后点「开始导入」。</div></div>' +
      '<div class="field"><label>② 或粘贴 CSV 内容（Excel 另存为 CSV 后全选复制）</label>' +
      '<textarea class="input" data-input="csv-text" style="min-height:160px" placeholder="名称,类别,颜色,号码,进价,售价">' +
      esc(state.csvText) + '</textarea></div>' +
      '<div class="row">' +
      '<button class="btn" data-act="download-template">下载模板</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" data-act="cancel-form">返回</button>' +
      '<button class="btn btn-primary" data-act="do-import">开始导入</button>' +
      '</div></div>';

    if (state.csvResult) {
      var r = state.csvResult;
      h += '<div class="card"><div class="card-title">导入结果</div>' +
        '<p class="mb8">新增 ' + r.created + ' 款，补充 ' + r.updated + ' 款，共 ' + r.skus + ' 个色码。</p>';
      if (r.errors.length) {
        h += '<div class="notice notice-warn">有 ' + r.errors.length + ' 行未导入：</div>';
        h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>行号</th><th>原因</th></tr></thead><tbody>';
        r.errors.forEach(function (e) {
          h += '<tr><td>' + e.row + '</td><td>' + esc(e.msg) + '</td></tr>';
        });
        h += '</tbody></table></div>';
      } else {
        h += '<div class="notice notice-info">全部导入成功</div>';
      }
      h += '</div>';
    }
    return h;
  }

  // 导出预设尺码，便于单测验证（问题3：默认从童码开始、去除 0.5 半号）
  page.presetSizes = presetSizes;

  return page;
});
