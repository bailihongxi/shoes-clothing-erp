/**
 * ui/page-mine.js —— 我的（店铺信息 + 云同步 + 常用入口 + 关于）
 *
 * 云同步（问题5）：手机端一键把账本加密上传到 GitHub 仓库固定路径（覆盖历史），
 * 另一台设备打开 GitHub Pages 页面 → 「从云端恢复」→ 输入同一同步口令即可覆盖本地。
 * Token 与口令只存本机 localStorage，不进 Git、不进备份、不进上传的快照。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var sync = isNode ? require('../core/sync.js') : (ERP.sync || null);
  var mod = factory(ERP, util, ui, schema, sync);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.mine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema, sync) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  /** 本机存储（localStorage）；不可用时返回 null，配置只在本次会话有效 */
  function store() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /** 首次进入：读本机配置，owner/repo 为空时尝试从当前网址猜 */
  function initCfg() {
    var cfg = sync.loadConfig(store());
    if (!cfg.owner || !cfg.repo) {
      var loc = typeof location !== 'undefined' ? location : null;
      var g = sync.guessFromLocation(loc);
      if (g) {
        cfg.owner = cfg.owner || g.owner;
        cfg.repo = cfg.repo || g.repo;
      }
    }
    return cfg;
  }

  function app() {
    return ERP.app || null;
  }

  /** 异步流程结束后：落库 + 重渲染 */
  function finish(state, msg, type) {
    state.busy = false;
    state.msg = msg || '';
    state.msgType = type || 'ok';
    if (msg) ui.toast(msg, type === 'err' ? 'err' : 'ok');
    var a = app();
    if (!a) return;
    Promise.resolve(a.commit ? a.commit() : null)
      .catch(function () { /* 落库失败已在 app 层提示 */ })
      .then(function () {
        if (a.render) a.render();
      });
  }

  var page = {
    name: 'mine',
    title: '我的',
    icon: '👤',

    init: function () {
      return {
        cfg: initCfg(),
        syncOpen: false,
        busy: false,
        msg: '',
        msgType: 'ok'
      };
    },

    actions: {
      /** 展开/收起同步设置 */
      'toggle-sync-cfg': function (ctx, state) {
        state.syncOpen = !state.syncOpen;
      },

      /** 同步设置字段（只记值，不重渲染，避免打断输入） */
      'sync-field': function (ctx, state, el) {
        var k = el.getAttribute('data-name');
        if (!k) return;
        state.cfg[k] = el.value;
      },

      /** 保存同步设置到本机 */
      'save-sync-cfg': function (ctx, state) {
        state.cfg = sync.saveConfig(store(), state.cfg);
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.msg = '已保存，但还差：' + v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        state.msg = '同步设置已保存在本机（不会上传、不进 Git）';
        state.msgType = 'ok';
        ui.toast('同步设置已保存', 'ok');
        return true;
      },

      /** 一键同步到云端（加密上传，覆盖历史） */
      'sync-up': function (ctx, state) {
        if (state.busy) return false;
        state.cfg = sync.saveConfig(store(), state.cfg);
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.syncOpen = true;
          state.msg = v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        state.busy = true;
        state.msg = '正在加密并上传…';
        state.msgType = 'ok';
        sync.syncUp(ctx, state.cfg).then(function (r) {
          if (!r.ok) {
            finish(state, '同步失败：' + r.error, 'err');
            return;
          }
          state.cfg.lastPushAt = r.at;
          state.cfg = sync.saveConfig(store(), state.cfg);
          finish(
            state,
            '☁️ 已同步到云端（' + r.summaryText + '，' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB），云端历史已被覆盖',
            'ok'
          );
        });
        return true;
      },

      /** 从云端恢复（下载解密，覆盖本地） */
      'sync-down': function (ctx, state) {
        if (state.busy) return false;
        state.cfg = sync.saveConfig(store(), state.cfg);
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.syncOpen = true;
          state.msg = v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        var run = function () {
          state.busy = true;
          state.msg = '正在下载并解密…';
          state.msgType = 'ok';
          sync.syncDown(ctx, state.cfg).then(function (r) {
            if (!r.ok) {
              finish(state, '恢复失败：' + r.error, 'err');
              return;
            }
            state.cfg.lastPullAt = util.nowISO();
            state.cfg = sync.saveConfig(store(), state.cfg);
            finish(state, '⬇️ 已用云端快照覆盖本机（' + r.summaryText + '）', 'ok');
          });
        };
        if (ui.confirm) {
          ui.confirm('从云端恢复', '将用云端快照<b>覆盖本机全部数据</b>，本机未同步的改动会丢失。<br>确定继续？')
            .then(function (yes) {
              if (yes) run();
            });
          return false;
        }
        run();
        return true;
      }
    },

    render: function (ctx, state) {
      var s = ctx.settings;
      var info =
        '<div class="card mb8"><div class="row" style="align-items:center;gap:12px">' +
        '<div class="avatar">👟</div>' +
        '<div><div class="strong">' + esc(s.shopName || '我的鞋服店') + '</div>' +
        '<div class="muted small">鞋服进销存记账 · 本地离线可用</div></div>' +
        '</div></div>';

      var links = C.quickGrid([
        { page: 'sale', icon: '🛒', text: '开单' },
        { page: 'purchase', icon: '📥', text: '进货' },
        { page: 'product', icon: '📦', text: '商品' },
        { page: 'inventory', icon: '📋', text: '库存' },
        { page: 'account', icon: '💰', text: '记账中心' },
        { page: 'report', icon: '📈', text: '报表' },
        { page: 'setting', icon: '⚙️', text: '设置' }
      ]);

      var about =
        '<div class="card"><h3 class="card-title">关于</h3>' +
        '<ul class="about-list">' +
        '<li>版本：v1.0（schema v' + schema.VERSION + '）</li>' +
        '<li>部署：电脑双击 index.html 即可用；手机端经 https 托管可启用实时扫码与蓝牙打印</li>' +
        '<li>数据：全部保存在本机浏览器（IndexedDB），请勿清除浏览器数据</li>' +
        '<li>备份纪律：每天导出一份账本，电脑 + 网盘各存一份</li>' +
        '</ul></div>';

      return (
        '<div class="page-head"><h2>我的</h2></div>' +
        info +
        renderSync(state) +
        '<div class="card mb8"><h3 class="card-title">常用入口</h3>' + links + '</div>' +
        about
      );
    }
  };

  /* ---------------- 云同步卡片 ---------------- */

  function renderSync(state) {
    var cfg = state.cfg || sync.defaultConfig();
    var busy = !!state.busy;

    var h = '<div class="card mb8"><h3 class="card-title">云同步（GitHub Pages）' +
      '<button class="btn btn-sm" data-act="toggle-sync-cfg">' + (state.syncOpen ? '收起设置' : '同步设置') + '</button>' +
      '</h3>';

    h += '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" data-act="sync-up"' + (busy ? ' disabled' : '') + '>' +
      (busy ? '同步中…' : '☁️ 同步到云端') + '</button>' +
      '<button class="btn" data-act="sync-down"' + (busy ? ' disabled' : '') + '>⬇️ 从云端恢复</button>' +
      '</div>';

    h += '<div class="small muted mt8">把本机账本加密上传到仓库固定路径，<b>每次覆盖历史</b>；' +
      '换手机/电脑打开同一网址后点「从云端恢复」，输入同一同步口令即可拿到最新数据。</div>';

    if (cfg.lastPushAt) {
      h += '<div class="small mt8">最后同步：<b>' + esc(util.fmtDateTime ? util.fmtDateTime(cfg.lastPushAt) : cfg.lastPushAt) + '</b></div>';
    } else {
      h += '<div class="small weak mt8">还没同步过</div>';
    }
    if (cfg.lastPullAt) {
      h += '<div class="small weak">最后恢复：' + esc(util.fmtDateTime ? util.fmtDateTime(cfg.lastPullAt) : cfg.lastPullAt) + '</div>';
    }

    if (state.msg) {
      h += '<div class="notice ' + (state.msgType === 'err' ? 'notice-danger' : 'notice-info') + ' mt8">' +
        esc(state.msg) + '</div>';
    }

    if (state.syncOpen) {
      h += '<div class="mt8" style="border-top:1px solid var(--line,#e5e7eb);padding-top:8px">' +
        field('GitHub 用户名', 'owner', cfg.owner, 'bailihongxi') +
        field('仓库名', 'repo', cfg.repo, 'shoes-clothing-erp') +
        field('分支', 'branch', cfg.branch, 'gh-pages') +
        field('快照路径', 'path', cfg.path, 'data/erp-snapshot.json') +
        field('GitHub Token', 'token', cfg.token, 'github_pat_… 仅存本机', 'password') +
        field('同步口令', 'passphrase', cfg.passphrase, '至少 6 位，换设备恢复要用同一口令', 'password') +
        '<div class="row mt8"><button class="btn btn-primary btn-sm" data-act="save-sync-cfg">保存同步设置</button></div>' +
        '<ul class="about-list small mt8">' +
        '<li>Token 去 GitHub → Settings → Developer settings → Fine-grained tokens 生成，' +
        '只勾这一个仓库的 <b>Contents: Read and write</b>。</li>' +
        '<li>上传的是 <b>AES-GCM 密文</b>，公开仓库里别人也看不到你的经营数据。</li>' +
        '<li>Token 与口令只存在这台设备的浏览器里，不会上传、不进 Git、不进备份文件。</li>' +
        '<li>口令丢了云端快照就解不开了，请自己记牢。</li>' +
        '</ul>' +
        '</div>';
    }

    h += '</div>';
    return h;
  }

  function field(label, name, value, placeholder, type) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input class="input" type="' + (type || 'text') + '" data-input="sync-field" data-name="' + esc(name) + '" ' +
      'placeholder="' + esc(placeholder || '') + '" value="' + esc(value === undefined || value === null ? '' : value) + '" ' +
      'autocomplete="off" spellcheck="false"></div>';
  }

  page.renderSync = renderSync;

  return page;
});
