/**
 * core/coding.js —— 款号 / SKU id / 条码自动生成（PRD 11.3、验收 10.0）
 *
 * 款号 styleCode = 类别字母 + 3 位流水          例：X001
 * SKU id        = 款号 + 2 位色序 + 尺码码      例：X001 01 38 → X0010138
 * 条码          = 产品类型(1 字母) + 颜色(1 字母) + 四位随机码   例：XW1234
 *               同一「款 + 色」的所有号码共用同一条码（同款同色可贴同一个条码）
 *               （开启「一码一色码」后 = SKU id，一个色码一个条码）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.coding = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var coding = {};

  /* ---------------- 基础规则 ---------------- */

  /** 类别 → 字母前缀（设置可自定义，未定义的类别走「其他」） */
  coding.prefixOf = function prefixOf(category, settings) {
    var map = (settings && settings.categoryPrefix) || schema.DEFAULT_CATEGORY_PREFIX;
    var key = String(category || '').trim();
    if (map[key]) return String(map[key]).trim().toUpperCase();
    return String(map['其他'] || 'O').trim().toUpperCase();
  };

  /** 某前缀下已有款号的最大流水号 */
  coding.maxStyleSeq = function maxStyleSeq(prefix, products) {
    var max = 0;
    (products || []).forEach(function (p) {
      var code = String(p.styleCode || '').toUpperCase();
      if (code.indexOf(prefix.toUpperCase()) !== 0) return;
      var tail = code.slice(prefix.length);
      var n = parseInt(tail, 10);
      if (!isNaN(n) && /^\d+$/.test(tail) && n > max) max = n;
    });
    return max;
  };

  /** 生成下一个款号：类别内流水 +1，冲突顺延 */
  coding.genStyleCode = function genStyleCode(category, products, settings) {
    var prefix = coding.prefixOf(category, settings);
    var seq = coding.maxStyleSeq(prefix, products) + 1;
    var code = prefix + util.pad(seq, 3);
    var taken = {};
    (products || []).forEach(function (p) {
      taken[String(p.styleCode).toUpperCase()] = true;
    });
    while (taken[code.toUpperCase()]) {
      seq += 1;
      code = prefix + util.pad(seq, 3);
    }
    return code;
  };

  /** 同款判定：名称 + 类别 完全相同 → 复用款号 */
  coding.findSameStyle = function findSameStyle(name, category, products) {
    var n = util.cleanText(name).toUpperCase();
    var c = util.cleanText(category);
    if (!n) return null;
    return (products || []).find(function (p) {
      return util.cleanText(p.name).toUpperCase() === n && util.cleanText(p.category) === c;
    }) || null;
  };

  /** 同款内色序：同色复用序号，新色 +1 */
  coding.nextColorSeq = function nextColorSeq(styleCode, color, skus) {
    var c = util.cleanColor(color).toUpperCase();
    var mine = (skus || []).filter(function (s) {
      return s.styleCode === styleCode;
    });
    var hit = mine.find(function (s) {
      return util.cleanColor(s.color).toUpperCase() === c;
    });
    if (hit && hit.colorSeq) return hit.colorSeq;
    var max = 0;
    mine.forEach(function (s) {
      var n = parseInt(s.colorSeq, 10) || parseInt(String(s.id).slice(String(styleCode).length, String(styleCode).length + 2), 10) || 0;
      if (n > max) max = n;
    });
    return max + 1;
  };

  /** SKU id = 款号 + 2 位色序 + 尺码码 */
  coding.genSkuId = function genSkuId(styleCode, colorSeq, size) {
    return String(styleCode) + util.pad(colorSeq, 2) + util.cleanSize(size);
  };

  /** 条码内容（款级 = 款号；一码一色码 = SKU id） */
  coding.genBarcode = function genBarcode(styleCode, skuId, settings) {
    var oneCode = settings && settings.oneCodePerSku;
    return oneCode ? skuId : styleCode;
  };

  /** 颜色 → 单字母码（用于条码中的「颜色」段；未知颜色按哈希兜底） */
  coding.colorCode = function colorCode(color) {
    var map = {
      '白': 'W', '黑': 'K', '灰': 'H', '米白': 'M', '棕': 'Z', '卡其': 'Q',
      '红': 'R', '蓝': 'B', '绿': 'G', '粉': 'P', '杏': 'X', '银': 'S',
      '黄': 'Y', '紫': 'U', '橙': 'O'
    };
    var c = util.cleanColor(color);
    if (map[c]) return map[c];
    var h = 0;
    for (var i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
    return String.fromCharCode(65 + (h % 26));
  };

  /**
   * 生成「产品类型 + 颜色 + 四位随机码」条码（问题3 新规则）
   * - 产品类型：类别前缀（X/F/K/P/B/O），1 字母
   * - 颜色：单字母码，1 字母
   * - 四位随机码：0000~9999，保证与 taken 集合不冲突
   * 同一「款 + 色」共用同一份条码（同款同色可贴同一个条码）。
   */
  coding.genColorBarcode = function genColorBarcode(category, color, settings, taken) {
    var prefix = coding.prefixOf(category, settings); // 产品类型（1 字母）
    var cc = coding.colorCode(color);                // 颜色（1 字母）
    var code;
    do {
      var rand = ('000' + Math.floor(Math.random() * 10000)).slice(-4);
      code = (prefix + cc + rand).toUpperCase();
    } while (taken && taken[code]);
    return code;
  };

  /** 查找同款下「颜色 + 尺码」是否已存在 */
  coding.findSku = function findSku(styleCode, color, size, skus) {
    var c = util.cleanColor(color).toUpperCase();
    var z = util.cleanSize(size).toUpperCase();
    return (skus || []).find(function (s) {
      return s.styleCode === styleCode &&
        util.cleanColor(s.color).toUpperCase() === c &&
        util.cleanSize(s.sizeCode || s.size).toUpperCase() === z;
    }) || null;
  };

  /* ---------------- 预览与建档 ---------------- */

  /**
   * 输入：{name, category, brand, costPrice, salePrice, colors[], sizes[], threshold}
   * 输出预览（不落库）：{styleCode, isNewStyle, rows[], newCount, duplicateCount, errors[]}
   */
  coding.preview = function preview(input, ctx) {
    var data = ctx.data;
    var settings = ctx.settings || schema.defaultSettings();
    var errors = [];
    var warnings = [];

    var name = util.cleanText(input.name);
    var category = util.cleanText(input.category);
    if (!name) errors.push('请填写商品名称');
    if (!category) errors.push('请选择类别');
    var colors = (input.colors || []).map(util.cleanColor).filter(Boolean);
    // 展示保留小数点（38.5），编码在生成 id 时再清洗为 385
    var sizes = (input.sizes || []).map(util.displaySize).filter(Boolean);
    if (!colors.length) errors.push('请至少选择一个颜色');
    if (!sizes.length) errors.push('请至少选择一个号码');

    var same = coding.findSameStyle(name, category, data.products);
    var isNewStyle = !same;
    var styleCode = same ? same.styleCode : coding.genStyleCode(category, data.products, settings);
    if (input.styleCode) styleCode = util.cleanText(input.styleCode).toUpperCase();

    var rows = [];
    var dupCount = 0;
    var newCount = 0;
    var virtualSkus = data.skus.slice();

    // 已占用条码集合（避免新生成与既有 SKU / 供应商吊牌码冲突）
    var taken = Object.create(null);
    (data.skus || []).forEach(function (s) {
      if (s.barcode) taken[String(s.barcode).toUpperCase()] = true;
    });
    (data.products || []).forEach(function (p) {
      if (p.barcode) taken[String(p.barcode).toUpperCase()] = true;
    });
    // 同一「款 + 色」复用同一份条码
    var oneCodePerSku = !!(settings && settings.oneCodePerSku);
    var colorBarcodeOf = {};
    var firstColorBarcode = null;

    colors.forEach(function (color) {
      var cleanC = util.cleanColor(color).toUpperCase();
      // 复用既有（款+色）条码
      var existing = virtualSkus.find(function (s) {
        return s.styleCode === styleCode && util.cleanColor(s.color).toUpperCase() === cleanC && s.barcode;
      });
      var colorBarcode;
      if (existing) {
        colorBarcode = existing.barcode;
        colorBarcodeOf[cleanC] = colorBarcode;
      } else if (colorBarcodeOf[cleanC]) {
        colorBarcode = colorBarcodeOf[cleanC];
      } else {
        colorBarcode = coding.genColorBarcode(category, color, settings, taken);
        taken[colorBarcode.toUpperCase()] = true;
        colorBarcodeOf[cleanC] = colorBarcode;
      }
      if (!firstColorBarcode) firstColorBarcode = colorBarcode;

      var colorSeq = coding.nextColorSeq(styleCode, color, virtualSkus);
      sizes.forEach(function (rawSize) {
        var size = util.displaySize(rawSize);
        var sizeCode = util.cleanSize(rawSize);
        var skuId = coding.genSkuId(styleCode, colorSeq, sizeCode);
        var exist = virtualSkus.find(function (s) {
          return s.id === skuId;
        });
        var conflictN = 0;
        while (exist && exist.styleCode !== styleCode) {
          conflictN += 1;
          skuId = coding.genSkuId(styleCode, colorSeq, sizeCode) + '-' + conflictN;
          exist = virtualSkus.find(function (s) {
            return s.id === skuId;
          });
        }
        // 「一码一色码」开关打开时，条码退化为一个色码一个条码（= SKU id）
        var rowBarcode = oneCodePerSku ? skuId : colorBarcode;
        if (exist) {
          dupCount += 1;
          rows.push({
            color: color, size: size, sizeCode: sizeCode, colorSeq: colorSeq,
            skuId: skuId, barcode: rowBarcode, exists: true, conflict: false
          });
        } else {
          newCount += 1;
          rows.push({
            color: color, size: size, sizeCode: sizeCode, colorSeq: colorSeq,
            skuId: skuId, barcode: rowBarcode, exists: false, conflict: conflictN > 0
          });
          virtualSkus.push({
            id: skuId, styleCode: styleCode, color: color,
            size: size, sizeCode: sizeCode, colorSeq: colorSeq
          });
        }
      });
    });

    if (dupCount) {
      var first = rows.filter(function (r) {
        return r.exists;
      })[0];
      warnings.push('已存在 ' + dupCount + ' 个色码，将自动跳过（如：' + first.skuId + '）');
    }
    if (same) warnings.push('已存在同名同类的款，复用款号 ' + same.styleCode + '（不新开款）');

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      styleCode: styleCode,
      isNewStyle: isNewStyle,
      reusedStyleCode: same ? same.styleCode : null,
      barcode: firstColorBarcode,
      rows: rows,
      newCount: newCount,
      duplicateCount: dupCount
    };
  };

  /**
   * 落库建档：新增款 + 批量新增色码 SKU
   * 返回 {ok, product, skus, created, duplicates, warnings, errors}
   */
  coding.create = function create(input, ctx) {
    var pv = coding.preview(input, ctx);
    if (!pv.ok) {
      return { ok: false, errors: pv.errors, warnings: pv.warnings, created: 0, duplicates: 0, rows: pv.rows };
    }
    var data = ctx.data;
    var settings = ctx.settings || schema.defaultSettings();
    var now = util.nowISO();
    var threshold = input.threshold === undefined || input.threshold === null
      ? (settings.defaultThreshold || 3)
      : parseInt(input.threshold, 10);

    var product = data.products.find(function (p) {
      return p.styleCode === pv.styleCode;
    });

    if (!product) {
      product = {
        styleCode: pv.styleCode,
        name: util.cleanText(input.name),
        category: util.cleanText(input.category),
        brand: util.cleanText(input.brand || ''),
        costPrice: util.parseMoney(input.costPrice),
        salePrice: util.parseMoney(input.salePrice),
        // 款级代表条码 = 首个颜色的条码（类型+颜色+四位随机码）
        barcode: pv.barcode || pv.styleCode,
        barcodeSource: schema.BARCODE_SOURCE.SYSTEM,
        barcodeAt: now,
        threshold: threshold,
        createdAt: now,
        status: schema.STATUS.ON,
        printedAt: null
      };
      data.products.push(product);
    } else {
      // 复用款：补充价格（有填才覆盖）
      if (input.costPrice !== undefined && input.costPrice !== null && input.costPrice !== '') {
        product.costPrice = util.parseMoney(input.costPrice);
      }
      if (input.salePrice !== undefined && input.salePrice !== null && input.salePrice !== '') {
        product.salePrice = util.parseMoney(input.salePrice);
      }
    }
    ctx.touch('products', product);

    var created = [];
    var duplicates = [];
    pv.rows.forEach(function (row) {
      if (row.exists) {
        duplicates.push(row);
        return;
      }
      var sku = {
        id: row.skuId,
        styleCode: product.styleCode,
        color: row.color,
        size: row.size,
        sizeCode: row.sizeCode,
        colorSeq: row.colorSeq,
        stock: 0,
        threshold: threshold,
        price: null,
        costPrice: null,
        barcode: row.barcode,
        status: schema.STATUS.ON,
        createdAt: now,
        printedAt: null
      };
      data.skus.push(sku);
      ctx.touch('skus', sku);
      created.push(sku);
    });

    return {
      ok: true,
      product: product,
      skus: created,
      created: created.length,
      duplicates: duplicates,
      styleCode: product.styleCode,
      isNewStyle: pv.isNewStyle,
      warnings: pv.warnings,
      errors: []
    };
  };

  /* ---------------- 款号改名：同步 SKU id 与条码 ---------------- */

  /**
   * 款号手动修改 → 该款全部 SKU 的 id 与条码同步更新，并提示需重新打印标签
   */
  coding.renameStyleCode = function renameStyleCode(styleCode, newCode, ctx) {
    var data = ctx.data;
    newCode = String(newCode || '').trim().toUpperCase();
    var product = data.products.find(function (p) {
      return p.styleCode === styleCode;
    });
    if (!product) return { ok: false, error: '款号 ' + styleCode + ' 不存在' };
    if (!newCode) return { ok: false, error: '新款号不能为空' };
    if (!/^[A-Za-z0-9\-]{1,20}$/.test(newCode)) {
      return { ok: false, error: '款号只能包含字母、数字和短横线' };
    }
    if (newCode === styleCode) return { ok: false, error: '新款号与原款号相同' };
    var clashed = data.products.find(function (p) {
      return p.styleCode.toUpperCase() === newCode;
    });
    if (clashed) return { ok: false, error: '款号 ' + newCode + ' 已被商品「' + clashed.name + '」占用' };

    var oldPrefix = String(styleCode);
    var mySkus = data.skus.filter(function (s) {
      return s.styleCode === styleCode;
    });
    var idMap = {};
    // 改名后按「款 + 色」重新生成条码，同色复用
    var takenRename = Object.create(null);
    data.skus.forEach(function (s) {
      if (s.barcode) takenRename[String(s.barcode).toUpperCase()] = true;
    });
    var oneCode = !!(ctx.settings && ctx.settings.oneCodePerSku);
    var colorBc = {};
    var firstBc = null;
    mySkus.forEach(function (sku) {
      var suffix = String(sku.id).slice(oldPrefix.length);
      var newId = newCode + suffix;
      idMap[sku.id] = newId;
      sku.id = newId;
      sku.styleCode = newCode;
      var cc = util.cleanColor(sku.color).toUpperCase();
      if (!colorBc[cc]) {
        colorBc[cc] = coding.genColorBarcode(product.category, sku.color, ctx.settings, takenRename);
        takenRename[colorBc[cc].toUpperCase()] = true;
      }
      if (!firstBc) firstBc = colorBc[cc];
      // 一码一色码：条码 = 新 SKU id；否则同款同色共用色条码
      sku.barcode = oneCode ? newId : colorBc[cc];
      ctx.touch('skus', sku);
    });

    // 同步引用：单据明细 / 库存流水 / 打印队列
    ['purchases', 'sales', 'stocktakes'].forEach(function (store) {
      (data[store] || []).forEach(function (doc) {
        (doc.items || []).forEach(function (it) {
          if (idMap[it.skuId]) it.skuId = idMap[it.skuId];
          if (it.styleCode === styleCode) it.styleCode = newCode;
        });
        ctx.touch(store, doc);
      });
    });
    ['stockLogs', 'printJobs'].forEach(function (store) {
      (data[store] || []).forEach(function (rec) {
        var touched = false;
        if (idMap[rec.skuId]) {
          rec.skuId = idMap[rec.skuId];
          touched = true;
        }
        if (rec.styleCode === styleCode) {
          rec.styleCode = newCode;
          touched = true;
        }
        if (touched) ctx.touch(store, rec);
      });
    });

    product.styleCode = newCode;
    if (product.barcodeSource !== schema.BARCODE_SOURCE.SUPPLIER || !product.barcode) {
      // 系统生成码随款重排：取首个颜色的新条码作为款级代表码
      product.barcode = firstBc || newCode;
    }
    ctx.touch('products', product);

    return {
      ok: true,
      styleCode: newCode,
      updatedSkus: mySkus.length,
      needReprint: true,
      warning: '款号已改为 ' + newCode + '，' + mySkus.length + ' 个色码的 id 与条码已同步更新，需重新打印标签'
    };
  };

  /* ---------------- 条码唯一性与供应商吊牌码 ---------------- */

  /** 条码是否被其他款占用（排除 excludeStyleCode） */
  coding.barcodeOwner = function barcodeOwner(barcode, ctx, excludeStyleCode) {
    var code = String(barcode || '').trim();
    if (!code) return null;
    var found = (ctx.data.products || []).find(function (p) {
      return String(p.barcode) === code && p.styleCode !== excludeStyleCode;
    });
    if (found) return found;
    var sku = (ctx.data.skus || []).find(function (s) {
      return String(s.barcode) === code && s.styleCode !== excludeStyleCode;
    });
    if (sku) return { styleCode: sku.styleCode, name: sku.id };
    return null;
  };

  /** 绑定供应商吊牌码（覆盖系统生成码，留来源与时间） */
  coding.setSupplierBarcode = function setSupplierBarcode(styleCode, barcode, ctx) {
    var code = String(barcode || '').trim();
    if (!code) return { ok: false, error: '条码不能为空' };
    var product = (ctx.data.products || []).find(function (p) {
      return p.styleCode === styleCode;
    });
    if (!product) return { ok: false, error: '款号 ' + styleCode + ' 不存在' };
    var owner = coding.barcodeOwner(code, ctx, styleCode);
    if (owner) {
      return { ok: false, error: '条码「' + code + '」已被 款号 ' + owner.styleCode + ' 占用' };
    }
    product.barcode = code;
    product.barcodeSource = schema.BARCODE_SOURCE.SUPPLIER;
    product.barcodeAt = util.nowISO();
    ctx.touch('products', product);
    (ctx.data.skus || []).forEach(function (s) {
      if (s.styleCode !== styleCode) return;
      s.barcode = code;
      ctx.touch('skus', s);
    });
    return { ok: true, product: product, barcode: code };
  };

  /* ---------------- CSV 批量导入 ---------------- */

  /**
   * rows：二维数组（含表头），第一行作为表头映射
   * 支持列：名称/商品名称、类别、颜色、号码/尺码、进价、售价、品牌、款号、条码
   * 返回 {ok, created, updated, errors:[{row, msg}], skus}
   */
  coding.importFromRows = function importFromRows(rows, ctx) {
    var result = { ok: true, created: 0, updated: 0, errors: [], skus: 0, styles: [] };
    if (!rows || rows.length < 2) {
      result.ok = false;
      result.errors.push({ row: 0, msg: '文件内容为空或只有表头' });
      return result;
    }
    var header = rows[0].map(function (h) {
      return String(h || '').trim();
    });
    function idx(keys, fallback) {
      for (var i = 0; i < keys.length; i++) {
        var p = header.indexOf(keys[i]);
        if (p >= 0) return p;
      }
      return fallback === undefined ? -1 : fallback;
    }
    var cName = idx(['名称', '商品名称', '品名'], -1);
    var cCat = idx(['类别', '分类'], -1);
    var cColor = idx(['颜色', '色'], -1);
    var cSize = idx(['号码', '尺码', '尺寸'], -1);
    var cCost = idx(['进价', '进货价', '成本价'], -1);
    var cSale = idx(['售价', '零售价', '销售价'], -1);
    var cBrand = idx(['品牌'], -1);
    var cCode = idx(['款号'], -1);
    var cBarcode = idx(['条码', '条形码'], -1);

    if (cName < 0) {
      result.ok = false;
      result.errors.push({ row: 1, msg: '缺少「名称」列' });
      return result;
    }

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var name = util.cleanText(row[cName]);
      if (!name) {
        result.errors.push({ row: r + 1, msg: '缺少商品名称' });
        continue;
      }
      var category = util.cleanText(cCat >= 0 ? row[cCat] : '') || '其他';
      var colors = String(cColor >= 0 ? row[cColor] : '')
        .split(/[、,，\/|]/)
        .map(util.cleanColor)
        .filter(Boolean);
      // 尺码不按「/」拆分：'39/40' 是一个尺码（显示为 39-40），不是两个
      var sizes = String(cSize >= 0 ? row[cSize] : '')
        .split(/[、,，|]/)
        .map(util.displaySize)
        .filter(Boolean);
      if (!colors.length) colors = ['默认'];
      if (!sizes.length) sizes = ['均码'];

      var input = {
        name: name,
        category: category,
        brand: cBrand >= 0 ? util.cleanText(row[cBrand]) : '',
        costPrice: cCost >= 0 ? row[cCost] : 0,
        salePrice: cSale >= 0 ? row[cSale] : 0,
        colors: colors,
        sizes: sizes
      };
      if (cCode >= 0 && util.cleanText(row[cCode])) input.styleCode = util.cleanText(row[cCode]);

      var res = coding.create(input, ctx);
      if (!res.ok) {
        result.errors.push({ row: r + 1, msg: (res.errors || []).join('；') || '建档失败' });
        continue;
      }
      if (res.isNewStyle) result.created += 1;
      else result.updated += 1;
      result.skus += res.created;
      if (result.styles.indexOf(res.styleCode) < 0) result.styles.push(res.styleCode);

      if (cBarcode >= 0 && util.cleanText(row[cBarcode])) {
        var bc = util.cleanText(row[cBarcode]);
        var bcRes = coding.setSupplierBarcode(res.styleCode, bc, ctx);
        if (!bcRes.ok) result.errors.push({ row: r + 1, msg: bcRes.error });
      }
    }
    result.ok = result.errors.length === 0;
    return result;
  };

  return coding;
});
