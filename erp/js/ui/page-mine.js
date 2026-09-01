/**
 * ui/page-mine.js —— 我的（v2 薄荷绿 UI 重设计）
 *
 * 设计图 1-3（手机）：
 * - 薄荷绿 banner「我的」
 * - 店铺卡片：圆形头像 + 店铺名 + 副标题「进销存记账 · 个体工商户」+ 右箭头
 * - 云同步卡片：标题 + 3 按钮（同步到云端 / 从云端恢复 / 同步设置）+ 副文字
 * - 8 格圆形快捷入口（2 行 4 列）：开单 / 进货 / 商品 / 供应商 / 库存 / 记账中心 / 报表 / 设置
 * - 底部版本信息：V3.0 / 数据存储于本机 IndexedDB / 自动备份保障数据安全
 *
 * 云同步（问题5）：手机端一键把账本加密上传到 GitHub 仓库固定路径（覆盖历史），
 * 另一台设备打开 GitHub Pages 页面 → 「从云端恢复」→ 输入同一同步口令即可覆盖本地。
 * Token 与口令只存本机 localStorage，不进 Git、不进备份、不进上传的快照。
 *
 * 关于 / 常用入口 / 同步设置等关键能力保留（兼容既有断言）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var sync = isNode ? require('../core/sync.js') : (ERP.sync || null);
  var accounts = isNode ? require('../core/accounts.js') : (ERP.accounts || null);
  var mod = factory(ERP, util, ui, schema, sync, accounts);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.mine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema, sync, accounts) {
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

  /** V3：当前登录账号 id（同步配置按账号隔离） */
  function currentAcctId() {
    return (ERP && ERP.currentAccount && ERP.currentAccount.id) || null;
  }

  /** 首次进入：读本机配置（V3 按账号），owner/repo 为空时尝试从当前网址猜 */
  function initCfg() {
    var cfg = sync.loadConfig(store(), currentAcctId());
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
        msgType: 'ok',
        // V3：店铺资料编辑
        editShop: false,
        shopNameEdit: '',
        avatarDataUrl: ''
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
        state.cfg = sync.saveConfig(store(), state.cfg, currentAcctId());
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
        state.cfg = sync.saveConfig(store(), state.cfg, currentAcctId());
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
          state.cfg = sync.saveConfig(store(), state.cfg, currentAcctId());
          finish(
            state,
            '☁️ 已同步到云端（' + r.summaryText + '，' + Math.max(1, Math.round(r.bytes / 1024)) + ' KB），云端历史已被覆盖',
            'ok'
          );
        });
      },

      /** 从云端恢复（下载解密，覆盖本地） */
      'sync-down': function (ctx, state) {
        if (state.busy) return false;
        state.cfg = sync.saveConfig(store(), state.cfg, currentAcctId());
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
            state.cfg = sync.saveConfig(store(), state.cfg, currentAcctId());
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
      },

      /** 跳转店铺设置 */
      'go-shop-edit': function (ctx, state) {
        if (ERP.app && ERP.app.go) ERP.app.go('setting');
        else if (ui.toast) ui.toast('请到设置页修改店铺信息', 'ok');
      },

      /** V3：展开/收起店铺资料编辑 */
      'toggle-shop-edit': function (ctx, state) {
        state.editShop = !state.editShop;
        state.shopNameEdit = state.editShop ? (ctx.settings.shopName || '') : '';
        state.avatarDataUrl = '';
      },

      /** 店铺名称输入 */
      'shop-name-edit': function (ctx, state, el) {
        state.shopNameEdit = el.value;
      },

      /** 头像文件选择 → 读为 dataURL 预览（保存时写入 settings.avatar） */
      'pick-avatar': function (ctx, state, el) {
        if (!el || !el.files || !el.files.length) return false;
        var file = el.files[0];
        if (!/^image\//.test(file.type || '')) {
          if (ui.toast) ui.toast('请选择图片文件', 'err');
          return false;
        }
        if (file.size > 512 * 1024) {
          if (ui.toast) ui.toast('图片过大（≤500KB）', 'err');
          return false;
        }
        var reader = new FileReader();
        var self = state;
        reader.onload = function (e) {
          self.avatarDataUrl = String(e.target && e.target.result || '');
          var a = app();
          if (a && a.render) a.render();
        };
        reader.readAsDataURL(file);
        return false;
      },

      /** 保存店铺资料（店名 + 头像）→ settings + 账号列表同步 */
      'save-shop': function (ctx, state) {
        var name = String(state.shopNameEdit || '').trim();
        if (!name) {
          if (ui.toast) ui.toast('店铺名称不能为空', 'err');
          return false;
        }
        ctx.settings.shopName = name;
        if (state.avatarDataUrl) ctx.settings.avatar = state.avatarDataUrl;
        // 同步到账号列表（登录页展示用）
        if (accounts && ERP.currentAccount) {
          accounts.updateProfile(store(), ERP.currentAccount.id, {
            shopName: name,
            avatar: state.avatarDataUrl || (ctx.settings.avatar || '')
          });
          ERP.currentAccount.shopName = name;
          if (state.avatarDataUrl) ERP.currentAccount.avatar = state.avatarDataUrl;
        }
        // 保存 settings 到库
        var a = app();
        if (a && a.saveSettings) a.saveSettings();
        state.editShop = false;
        state.msg = '店铺资料已保存';
        state.msgType = 'ok';
        if (ui.toast) ui.toast('店铺资料已保存', 'ok');
        return true;
      },

      /** 切换账号：退出登录回登录页 */
      'switch-account': function (ctx, state) {
        var a = app();
        if (a && a.logout) a.logout();
        return false;
      }
    },

    render: function (ctx, state) {
      return (
        '<div class="mobile-only">' + mobileMine(ctx, state) + '</div>' +
        '<div class="desktop-only">' + desktopMine(ctx, state) + '</div>'
      );
    }
  };

  /* ---------------- 桌面端我的（banner 收进手机端，桌面用 page-head） ---------------- */

  function desktopMine(ctx, state) {
    var s = ctx.settings || {};
    var h = '<div class="page-head"><h2>我的</h2>' +
      '<span class="desc">' + esc(s.shopName || '我的鞋服店') + ' · 进销存记账</span></div>';
    h += '<div class="mine-desktop">' + mobileMine(ctx, state, true) + '</div>';
    return h;
  }

  /* ---------------- 手机端我的（v2 设计图 1-3） ---------------- */

  function mobileMine(ctx, state, noBanner) {
    var s = ctx.settings || {};
    var cfg = state.cfg || sync.defaultConfig();

    var h = '';

    // 1. 薄荷绿 banner（桌面端由 page-head 替代，noBanner=true 时跳过）
    if (!noBanner) {
      h += '<div class="page-banner mine-banner">' +
        '<div class="banner-title">我的</div>' +
      '</div>';
    }

    // 2. 店铺信息卡片（头像 + 店名 + 经营范围 + 右箭头）—— V3：显示账号头像，可编辑
    var scopeText = (ctx.settings.scopeCategories && ctx.settings.scopeCategories.length)
      ? (ctx.settings.scopeCategories.join(' / ')) : '全部分类';
    var avatarHtml = s.avatar
      ? '<img class="avatar-img" src="' + esc(s.avatar) + '" alt="">'
      : '<div class="avatar">👟</div>';
    h += '<div class="shop-info-card" data-act="toggle-shop-edit">' +
      avatarHtml +
      '<div class="info">' +
        '<div class="name">' + esc(s.shopName || '我的鞋服店') + '</div>' +
        '<div class="sub">经营：' + esc(scopeText) + '</div>' +
      '</div>' +
      '<div class="arrow">›</div>' +
    '</div>';

    // V3：店铺资料编辑面板（店名 / 头像上传 / 切换账号）
    if (state.editShop) {
      h += '<div class="card mt8 shop-edit-box">' +
        '<div class="card-title">店铺资料</div>' +
        '<div class="field"><label>店铺名称</label>' +
        '<input class="input" data-input="shop-name-edit" data-live="1" value="' + esc(state.shopNameEdit) + '" placeholder="如 我的鞋店"></div>' +
        '<div class="field"><label>店铺头像</label>' +
        '<div class="row wrap"><input type="file" accept="image/*" data-change="pick-avatar" style="max-width:220px">' +
        (state.avatarDataUrl ? '<img class="avatar-preview" src="' + esc(state.avatarDataUrl) + '" alt="">' : '') +
        '</div><div class="small muted">支持 JPG/PNG，建议 500KB 以内</div></div>' +
        '<div class="row"><button class="btn btn-primary" data-act="save-shop">保存</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn" data-act="switch-account">切换账号</button></div>' +
      '</div>';
    }

    // 3. 云同步卡片
    h += renderSyncCard(state, cfg);

    // 4. 常用入口（9 格圆形 3×3 九宫格）—— 关键字串「常用入口」保留
    h += renderQuickGrid();

    // 5. 关于 + 版本信息（保留「关于」字串以兼容既有测试）
    h += renderAbout();

    return h;
  }

  /** 云同步卡片（按图1布局） */
  function renderSyncCard(state, cfg) {
    var busy = !!state.busy;
    var lastPush = cfg.lastPushAt ? (util.fmtDateTime ? util.fmtDateTime(cfg.lastPushAt) : cfg.lastPushAt) : '';

    var h = '<div class="card sync-card">' +
      '<div class="sync-head">' +
        '<div class="sync-title">☁ 云同步 <span class="sync-sub">(GitHub Pages)</span></div>' +
        '<button class="sync-setting-btn" data-act="toggle-sync-cfg">同步设置</button>' +
      '</div>' +
      '<div class="sync-actions">' +
        '<button class="sync-btn cloud-up" data-act="sync-up"' + (busy ? ' disabled' : '') + '>' +
          '<span class="ico">☁</span>' +
          '<span class="t">' + (busy ? '同步中…' : '同步到云端') + '</span>' +
        '</button>' +
        '<button class="sync-btn cloud-down" data-act="sync-down"' + (busy ? ' disabled' : '') + '>' +
          '<span class="ico">⬇</span>' +
          '<span class="t">从云端恢复</span>' +
        '</button>' +
      '</div>' +
      '<div class="sync-tip">' +
        '把本机账本加密上传到仓库固定路径，每次覆盖历史；换手机/电脑打开同一网址后点「从云端恢复」，输入同一同步口令即可拿到最新数据。' +
      '</div>' +
      '<div class="sync-status">' +
        (lastPush ? '上次同步：<b>' + esc(lastPush) + '</b>' : '还没同步过') +
      '</div>';

    if (state.msg) {
      h += '<div class="notice ' + (state.msgType === 'err' ? 'notice-danger' : 'notice-info') + ' mt8">' +
        esc(state.msg) + '</div>';
    }

    // 同步设置展开面板
    if (state.syncOpen) {
      h += '<div class="sync-cfg-panel">' +
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

  /** 8 格圆形快捷入口（2 行 4 列），颜色匹配设计图 */
  function renderQuickGrid() {
    var items = [
      { page: 'sale',      icon: '➕', text: '开单',     color: 'c-green' },
      { page: 'purchase',  icon: '🛍', text: '进货',     color: 'c-teal' },
      { page: 'product',   icon: '🛒', text: '商品',     color: 'c-blue' },
      { page: 'supplier',  icon: '👤', text: '供应商',   color: 'c-yellow' },
      { page: 'inventory', icon: '▦',  text: '库存',     color: 'c-teal' },
      { page: 'account',   icon: '📋', text: '记账中心', color: 'c-purple' },
      { page: 'report',    icon: '📊', text: '报表',     color: 'c-pink' },
      { page: 'exchange',  icon: '🔁', text: '退换货',   color: 'c-peach' },
      { page: 'setting',   icon: '⚙', text: '设置',     color: 'c-gray' }
    ];
    var h = '<div class="card quick-grid-card"><h3 class="card-title">常用入口</h3><div class="quick-grid mine-quick">';
    items.forEach(function (it) {
      h += '<button class="quick-circle ' + it.color + '" data-act="go" data-page="' + esc(it.page) + '">' +
        '<span class="disc">' + it.icon + '</span>' +
        '<span class="text">' + esc(it.text) + '</span>' +
      '</button>';
    });
    h += '</div></div>';
    return h;
  }

  /** 关于 + 版本信息 */
  function renderAbout() {
    return (
      '<div class="card about-card">' +
        '<h3 class="card-title">关于</h3>' +
        '<ul class="about-list">' +
          '<li>版本：V3.0（schema v' + schema.VERSION + '）</li>' +
          '<li>数据存储于本机 IndexedDB</li>' +
          '<li>自动备份保障数据安全</li>' +
        '</ul>' +
      '</div>'
    );
  }

  function field(label, name, value, placeholder, type) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input class="input" type="' + (type || 'text') + '" data-input="sync-field" data-name="' + esc(name) + '" ' +
      'placeholder="' + esc(placeholder || '') + '" value="' + esc(value === undefined || value === null ? '' : value) + '" ' +
      'autocomplete="off" spellcheck="false"></div>';
  }

  page.renderSync = renderSyncCard;

  return page;
});