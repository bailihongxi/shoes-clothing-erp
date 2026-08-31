/**
 * ui/page-setting.js —— 设置 / 备份恢复 / 打开密码 / 打印设置 / 操作日志（PRD 5.8 / 7）
 * 表单值在 state 中暂存（data-change="field"），保存类动作读取 state 写回 ctx.settings。
 * 文件导入在 mount 中走浏览器 FileReader；核心备份逻辑由 core/backup.js 承担（已单测）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var backup = isNode ? require('../core/backup.js') : (ERP.backup || null);
  var repo = isNode ? require('../store/repo.js') : (ERP.repo || null);
  var mod = factory(ERP, util, ui, schema, backup, repo);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.setting = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema, backup, repo) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  function app() { return ERP.app; }

  var page = {
    name: 'setting',
    title: '设置',
    icon: '⚙️',
    hideInNav: true,

    init: function (ctx) {
      var s = (ctx && ctx.settings) || {};
      var lab = s.label || {};
      var prn = s.print || {};
      return {
        shopName: s.shopName || '',
        widthMm: lab.widthMm || 40,
        heightMm: lab.heightMm || 30,
        dpi: lab.dpi || 203,
        protocol: prn.protocol || 'tspl',
        density: prn.density || 8,
        pwd: '',
        pwd2: '',
        showLog: false,
        imported: null
      };
    },

    render: function (ctx, state) {
      var s = ctx.settings;
      var val = function (k, v) {
        return 'value="' + esc(v == null ? '' : v) + '"';
      };

      /* ---- 店铺与打印设置 ---- */
      var general =
        '<div class="card mb8"><h3 class="card-title">店铺与打印</h3>' +
        '<div class="form-row"><label>店铺名称</label>' +
        '<input class="input" data-change="field" data-name="shopName" ' + val('shopName', state.shopName) + '></div>' +
        '<div class="grid grid-3">' +
        '<div class="form-row"><label>标签宽(mm)</label><input class="input" inputmode="decimal" data-change="field" data-name="widthMm" ' + val('widthMm', state.widthMm) + '></div>' +
        '<div class="form-row"><label>标签高(mm)</label><input class="input" inputmode="decimal" data-change="field" data-name="heightMm" ' + val('heightMm', state.heightMm) + '></div>' +
        '<div class="form-row"><label>打印DPI</label><input class="input" inputmode="numeric" data-change="field" data-name="dpi" ' + val('dpi', state.dpi) + '></div>' +
        '</div>' +
        '<div class="grid grid-3">' +
        '<div class="form-row"><label>打印机指令</label>' + C.select({
          name: 'protocol', value: state.protocol, on: 'field',
          options: [{ value: 'tspl', text: 'TSPL（标签机）' }, { value: 'escpos', text: 'ESC-POS（小票机）' }]
        }) + '</div>' +
        '<div class="form-row"><label>打印浓度</label><input class="input" inputmode="numeric" data-change="field" data-name="density" ' + val('density', state.density) + '></div>' +
        '<div class="form-row" style="justify-content:flex-end"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" data-act="save-settings">保存设置</button></div>' +
        '</div>' +
        '</div>';

      /* ---- 打开密码 ---- */
      var lock = s.lock || {};
      var lockHtml = lock.enabled
        ? '<div class="notice notice-info"><span>🔒 打开密码已启用</span>' +
          '<button class="btn btn-sm" data-act="disable-lock">关闭密码</button></div>'
        : '<div class="grid grid-2">' +
          '<div class="form-row"><label>设置密码</label><input class="input" type="password" inputmode="numeric" data-change="field" data-name="pwd" placeholder="6 位数字"></div>' +
          '<div class="form-row"><label>确认密码</label><input class="input" type="password" inputmode="numeric" data-change="field" data-name="pwd2" placeholder="再次输入"></div>' +
          '</div>' +
          '<button class="btn btn-primary" data-act="set-password">启用打开密码</button>';

      var security =
        '<div class="card mb8"><h3 class="card-title">打开密码</h3>' +
        '<p class="muted small mb8">启用后，每次打开软件需输入密码（本地校验，用于防误触，非加密级）。</p>' +
        lockHtml + '</div>';

      /* ---- 备份恢复 ---- */
      var backupCard =
        '<div class="card mb8"><h3 class="card-title">备份与恢复</h3>' +
        '<p class="muted small mb8">每天导出一份账本（电脑 + 网盘各存一份）。导入会用备份文件<strong>整体覆盖</strong>当前数据，导入前会二次确认。</p>' +
        '<div class="row">' +
        '<button class="btn btn-primary" data-act="export-backup">⬇️ 导出备份</button>' +
        '<button class="btn" id="btn-pick-backup" data-act="pick-backup">⬆️ 选择文件导入</button>' +
        '<input type="file" id="backup-file" accept="application/json,.json" data-change="import-backup" style="display:none">' +
        '</div>' +
        (state.imported ? '<div class="small mt8 ' + (state.imported.ok ? 'ok' : 'err') + '">' +
          (state.imported.ok ? '✓ 已恢复 ' + state.imported.summary.products + ' 个商品等数据' : '✗ ' + state.imported.error) + '</div>' : '') +
        '</div>';

      /* ---- 危险操作 ---- */
      var danger =
        '<div class="card mb8"><h3 class="card-title">数据管理</h3>' +
        '<button class="btn btn-danger" data-act="clear-data">清空全部数据</button>' +
        '<span class="muted small ml8">清空后不可恢复，请先导出备份。</span>' +
        '</div>';

      /* ---- 操作日志 ---- */
      var logs = ctx.data.logs || [];
      var logHtml = state.showLog
        ? '<ul class="log-list">' + (logs.length ? logs.slice().reverse().slice(0, 50).map(function (l) {
            return '<li><span class="muted">' + esc(l.at) + '</span> · ' + esc(l.action) + ' ' + esc(l.detail || '') + '</li>';
          }).join('') : '<li class="muted">暂无操作记录</li>') + '</ul>'
        : '';
      var logCard =
        '<div class="card"><h3 class="card-title">操作日志' +
        '<button class="btn btn-sm ' + (state.showLog ? 'btn-primary' : '') + '" data-act="toggle-log" style="float:right">' +
        (state.showLog ? '收起' : '查看') + '</button></h3>' + logHtml + '</div>';

      return general + security + backupCard + danger + logCard;
    },

    actions: {
      field: function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (name) state[name] = el.value;
      },

      'save-settings': function (ctx, state) {
        ctx.settings.shopName = util.cleanText(state.shopName) || '我的鞋服店';
        ctx.settings.label = Object.assign({}, ctx.settings.label, {
          widthMm: util.parseMoney(state.widthMm) / 100 || ctx.settings.label.widthMm,
          heightMm: util.parseMoney(state.heightMm) / 100 || ctx.settings.label.heightMm,
          dpi: parseInt(state.dpi, 10) || ctx.settings.label.dpi
        });
        ctx.settings.print = Object.assign({}, ctx.settings.print, {
          protocol: state.protocol || ctx.settings.print.protocol,
          density: parseInt(state.density, 10) || ctx.settings.print.density
        });
        if (app() && app().saveSettings) app().saveSettings();
        if (app() && app().toast) app().toast('设置已保存', 'ok');
        return true;
      },

      'set-password': function (ctx, state) {
        var pwd = String(state.pwd || '').trim();
        if (!/^\d{4,12}$/.test(pwd)) {
          if (app() && app().toast) app().toast('密码需为 4-12 位数字', 'err');
          return false;
        }
        if (pwd !== String(state.pwd2 || '').trim()) {
          if (app() && app().toast) app().toast('两次输入不一致', 'err');
          return false;
        }
        ctx.settings.lock = { enabled: true, hash: util.hashPassword(pwd) };
        if (app() && app().saveSettings) app().saveSettings();
        state.pwd = ''; state.pwd2 = '';
        if (app() && app().toast) app().toast('打开密码已启用', 'ok');
        return true;
      },

      'disable-lock': function (ctx, state) {
        ctx.settings.lock = { enabled: false, hash: null };
        if (app() && app().saveSettings) app().saveSettings();
        if (app() && app().toast) app().toast('已关闭打开密码', 'ok');
        return true;
      },

      'export-backup': function (ctx, state) {
        var b = backup.build(ctx);
        var json = JSON.stringify(b, null, 2);
        if (app() && app().download) {
          app().download(backup.fileName(ctx), json, 'application/json');
        }
        var now = util.nowISO();
        if (ctx.data) ctx.data.lastBackupAt = now;
        if (app() && app().setMeta) app().setMeta(schema.META_LAST_BACKUP_KEY, now);
        if (app() && app().toast) app().toast('备份已导出', 'ok');
        return true;
      },

      'pick-backup': function (ctx, state, el) {
        var input = document.getElementById('backup-file');
        if (input) input.click();
        return false;
      },

      'import-backup': function (ctx, state, el) {
        // 浏览器：el 为 file input，读取文件后恢复
        if (!el || !el.files || !el.files.length) return false;
        var file = el.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          var text = reader.result;
          var r = backup.restore(ctx, text);
          if (r.ok) {
            if (app() && app().commit) app().commit();
            state.imported = { ok: true, summary: r.summary };
            if (app() && app().toast) app().toast('备份已恢复', 'ok');
          } else {
            state.imported = { ok: false, error: r.error };
            if (app() && app().toast) app().toast('恢复失败：' + r.error, 'err');
          }
          if (app() && app().render) app().render();
        };
        reader.readAsText(file);
        return false;
      },

      'toggle-log': function (ctx, state) {
        state.showLog = !state.showLog;
        return true;
      },

      'clear-data': function (ctx, state) {
        var doClear = function () {
          schema.DATA_STORES.forEach(function (name) {
            ctx.data[name] = [];
            if (ctx.touchAll) ctx.touchAll(name);
          });
          ctx.data.settings = schema.defaultSettings();
          ctx.settings = ctx.data.settings;
          if (ctx.data) ctx.data.lastBackupAt = null;
          if (app() && app().commit) app().commit();
          if (app() && app().toast) app().toast('已清空全部数据', 'ok');
          return true;
        };
        if (app() && app().commit && C.confirm) {
          return C.confirm('清空全部数据', '此操作不可恢复，确定要继续吗？', '确认清空').then(function (ok) {
            if (!ok) return false;
            return doClear();
          });
        }
        return doClear();
      }
    }
  };

  return page;
});
