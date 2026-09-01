/**
 * app.js —— 启动、路由挂载、事件委托、落库
 * 依赖：core/*、store/*、ui/*、barcode/* 全部以经典 <script> 按序加载（file:// 可用）
 */
(function (root, factory) {
  var mod = factory(root.ERP || {});
  root.ERP = root.ERP || {};
  root.ERP.app = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP) {
  'use strict';

  var app = {
    db: null,
    ctx: null,
    ready: false,
    pageStates: Object.create(null),
    main: null
  };

  function router() {
    return ERP.router;
  }
  function ui() {
    return ERP.ui;
  }

  /* ---------------- 启动 ---------------- */

  function store() {
    return (typeof localStorage !== 'undefined' && localStorage) || {
      getItem: function () { return null; },
      setItem: function () {}
    };
  }
  var CURRENT_KEY = 'erp.currentAccount';
  function loadCurrent() {
    try {
      var raw = store().getItem(CURRENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveCurrent(acct) {
    try { store().setItem(CURRENT_KEY, JSON.stringify(acct)); } catch (e) { /* ignore */ }
  }
  function clearCurrent() {
    try { store().removeItem ? store().removeItem(CURRENT_KEY) : store().setItem(CURRENT_KEY, ''); } catch (e) { /* ignore */ }
  }

  /** 账号信息并入本账号 settings（店名/经营范围/头像，仅当未设置时） */
  function applyAccountToSettings(account) {
    if (!account || !app.ctx) return;
    var s = app.ctx.settings;
    if (!s.shopName || s.shopName === '我的鞋服店') s.shopName = account.shopName || s.shopName;
    if (!s.scopeCategories || !s.scopeCategories.length) {
      s.scopeCategories = (account.scopeCategories && account.scopeCategories.length)
        ? account.scopeCategories.slice()
        : (ERP.schema.ALL_CATEGORIES || []).slice();
    }
    if (!s.avatar && account.avatar) s.avatar = account.avatar;
  }

  /** 渲染登录页（V3：多账号选择 + 密码） */
  function renderLogin() {
    var page = ERP.pages && ERP.pages.login;
    if (!page) return;
    if (!app.pageStates.login) app.pageStates.login = page.init(null, store());
    app.main.innerHTML = page.render(null, app.pageStates.login);
  }

  app.boot = async function boot() {
    if (typeof document === 'undefined') return null;
    app.main = document.getElementById('view');

    // 注册所有已加载的页面到路由
    if (ERP.pages) {
      Object.keys(ERP.pages).forEach(function (name) {
        router().register(name, ERP.pages[name]);
      });
    }

    app.ready = true;
    bindGlobalEvents();

    // V3：多账号登录——已有登录态直接进入，否则展示登录页
    var saved = loadCurrent();
    if (saved && saved.id) {
      ERP.currentAccount = saved;
      await app.enterAccount(saved);
    } else {
      renderLogin();
    }
    return app.ctx;
  };

  /** 登录成功：保存会话 + 按账号独立库进入 */
  app.onLogin = async function onLogin(account) {
    if (!account || !account.id) return;
    ERP.currentAccount = account;
    saveCurrent(account);
    await app.enterAccount(account);
  };

  /** 切换/进入某账号的数据空间（独立 IndexedDB 库 shoeErp_<acctId>） */
  app.enterAccount = async function enterAccount(account) {
    if (!account || !account.id) return app.ctx;
    app.db = await ERP.db.create({ name: ERP.schema.dbNameFor(account.id) });
    // V2 存量单账号数据 → 账号1（仅首次进入账号1 且旧库有数据时迁移）
    if (account.id === 'acct1') await app.migrateLegacyData();
    var data = await ERP.repo.loadAll(app.db);
    app.ctx = ERP.repo.createContext(data);
    applyAccountToSettings(account);
    app.pageStates = Object.create(null);
    app.main = document.getElementById('view');
    if (app.ctx.settings.lock && app.ctx.settings.lock.enabled && app.ctx.settings.lock.hash) {
      showLock();
    } else {
      enter();
    }
    return app.ctx;
  };

  /** V2 存量数据迁移：旧库 shoeErp → 账号1 库（只迁移一次） */
  app.migrateLegacyData = async function migrateLegacyData() {
    if (store().getItem('erp.migratedV3')) return { migrated: false, reason: 'already' };
    var r = { migrated: false, reason: 'no-migrate-module' };
    try {
      if (ERP.migrate) {
        r = await ERP.migrate.migrate(
          function (name) { return ERP.db.create({ name: name }); },
          'shoeErp',
          ERP.schema.dbNameFor('acct1')
        );
      }
    } catch (e) {
      r = { migrated: false, reason: 'error' };
    }
    // 无论结果如何都标记，避免每次进入账号1 都检查旧库
    store().setItem('erp.migratedV3', '1');
    return r;
  };

  /** 退出登录：清会话回登录页 */
  app.logout = function logout() {
    clearCurrent();
    ERP.currentAccount = null;
    app.db = null;
    app.ctx = null;
    renderLogin();
  };

  function enter() {
    router().start();
    router().onChange(function () {
      render();
    });
    // V3：登录成功后若仍停在 login 页（hash 为 #/login），自动跳转到首页，避免"点进入无反馈"
    if (router().currentName && router().currentName() === 'login') {
      router().go('home');
    }
    render();
  }

  function bindGlobalEvents() {
    document.addEventListener('click', function (ev) {
      actHandler(ev, function (el) {
        return el.getAttribute('data-act');
      }, function (name, el, ev2) {
        return dispatch(name, el, ev2);
      });
    });

    document.addEventListener('change', function (ev) {
      actHandler(ev, function (el) {
        return el.getAttribute('data-change');
      }, function (name, el, ev2) {
        return dispatch(name, el, ev2);
      });
    });

    document.addEventListener('input', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input],[data-change]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input') || el.getAttribute('data-change');
      // 输入法组合进行中：完全忽略，等 compositionend 统一处理，避免打断中文输入
      if (app._isComposing(el, ev)) return;
      dispatch(name, el, ev);
      // data-live="1"：实时预览（重渲染并恢复焦点/光标）；普通字段只更新内存，不重渲染
      if (app._isLive(el)) relive(el);
    });

    // 输入法结束后补一次重渲染（中文/日文等组合输入必须靠它才能正确刷新预览）
    document.addEventListener('compositionend', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input],[data-change]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input') || el.getAttribute('data-change');
      dispatch(name, el, ev);
      if (app._isLive(el)) relive(el);
    });

    function relive(el) {
      var pos = null;
      try {
        pos = el.selectionStart;
      } catch (e) {
        pos = null;
      }
      var key = el.getAttribute('data-name') || '';
      render();
      scheduleCommit();
      var selector = '[data-input="' + el.getAttribute('data-input') + '"]' + (key ? '[data-name="' + key + '"]' : '');
      var next = document.querySelector(selector);
      if (next) {
        next.focus();
        if (pos !== null) {
          try {
            next.setSelectionRange(pos, pos);
          } catch (e2) { /* 部分输入类型不支持 */ }
        }
      }
    }

    // 扫码枪：光标在搜索框内，回车即视为扫码输入
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var el = ev.target;
      if (!el || !el.getAttribute) return;
      if (el.getAttribute('data-input') !== 'keyword') return;
      ev.preventDefault();
      var val = String(el.value || '').trim();
      if (!val) return;
      var page = router().current();
      if (page && page.actions && page.actions['scan-input']) {
        page.actions['scan-input'](app.ctx, stateOf(page), { value: val });
        afterAction();
      }
    });

    // 电脑端顶栏全局搜索：回车后带关键词跳转「商品档案」页
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var el = ev.target;
      if (!el || !el.id || el.id !== 'global-search-input') return;
      ev.preventDefault();
      var val = String(el.value || '').trim();
      el.blur();
      if (!val) {
        router().go('product');
        return;
      }
      if (!app.pageStates.product) {
        app.pageStates.product = (ERP.pages && ERP.pages.product && ERP.pages.product.init
          ? ERP.pages.product.init(app.ctx)
          : {});
      }
      app.pageStates.product.keyword = val;
      app.pageStates.product.page = 1;
      router().go('product');
    });

    // 安全网：页面被隐藏 / 卸载前，把尚未落库的脏数据最佳努力写入 IndexedDB，
    // 避免「刚保存就刷新/切走」导致的数据丢失（IndexedDB 事务在页面卸载时可能被中断）。
    function flushOnHide() {
      if (!app.db || !app.ctx) return;
      var pending = app.ctx.dirtyKeys && app.ctx.dirtyKeys().length;
      if (!pending) return;
      app.commit().catch(function (e) {
        if (typeof console !== 'undefined') console.error('页面卸载前落库失败', e);
      });
    }
    document.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushOnHide();
    });
  }

  /** 找到动作处理函数：页面 → 全局（V3：未登录时走登录页 action） */
  function dispatch(name, el, ev) {
    var page = ERP.currentAccount ? router().current() : loginPage();
    var state = stateOf(page);
    var fn = null;
    if (page && page.actions && page.actions[name]) fn = page.actions[name];
    else if (ui().globalActions && ui().globalActions[name]) fn = ui().globalActions[name];
    else if (app.actions && app.actions[name]) fn = app.actions[name];
    if (!fn) return undefined;
    return fn(app.ctx, state, el, ev);
  }

  function loginPage() {
    return (ERP.pages && ERP.pages.login) || null;
  }

  /**
   * 统一的动作派发：先执行动作，再「可靠落库 + 重渲染」。
   * - 动作抛错时给出明确错误提示，而不是整页静默无反应；
   * - afterAction 内部 await 落库，避免保存后因页面刷新/关闭而丢失数据。
   */
  function actHandler(ev, getName, run) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-act],[data-change]') : null;
    if (!el) return;
    var name = getName(el);
    if (!name) return;
    var handled = true;
    try {
      handled = run(name, el, ev);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('动作执行出错：' + name, err);
      ui().toast('操作失败：' + (err && err.message ? err.message : err), 'err');
      return;
    }
    if (handled !== false) {
      afterAction();
    }
  }

  function stateOf(page) {
    if (!page) return {};
    if (!app.pageStates[page.name]) {
      app.pageStates[page.name] = page.init ? page.init(app.ctx) : {};
    }
    return app.pageStates[page.name];
  }

  /**
   * 动作完成后：先把脏数据落库（IndexedDB），成功后再重渲染。
   * 落库失败会明确提示，避免「看起来保存了其实没存上」的假象。
   */
  async function afterAction() {
    try {
      await app.commit();
    } catch (err) {
      if (typeof console !== 'undefined') console.error('落库失败', err);
      ui().toast('保存失败：数据未能写入本地存储（' + (err && err.message ? err.message : err) + '）', 'err');
      return;
    }
    render();
  }

  /* 防抖落库：实时输入（data-live）期间不每次 flush，松开输入 400ms 后再写盘，避免逐键写 IndexedDB 卡顿 */
  var commitTimer = null;
  function scheduleCommit() {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      commitTimer = null;
      app.commit();
    }, 400);
  }

  /** 落库（脏数据刷新） */
  app.commit = async function commit() {
    if (!app.db || !app.ctx) return {};
    return ERP.repo.flush(app.ctx, app.db);
  };

  app.saveSettings = async function saveSettings() {
    app.ctx.settings = ERP.schema.mergeSettings(app.ctx.settings);
    await ERP.repo.saveSettings(app.db, app.ctx.settings);
    return app.ctx.settings;
  };

  app.setMeta = async function setMeta(key, value) {
    await ERP.repo.setMeta(app.db, key, value);
    app.ctx.data[key] = value;
    return value;
  };

  app.toast = function (msg, type) {
    ui().toast(msg, type);
  };

  app.go = function (page, query) {
    router().go(page, query);
  };

  app.resetState = function (name) {
    delete app.pageStates[name];
  };

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (!app.ready) return;
    // V3：未登录 → 只渲染登录页（不进入业务路由）
    if (!ERP.currentAccount) {
      renderLogin();
      return;
    }
    var page = router().current();
    if (!page) return;
    var state = stateOf(page);

    renderNav(page);

    var html = '';
    try {
      html = page.render(app.ctx, state) || '';
    } catch (err) {
      html = '<div class="card"><div class="notice notice-danger">页面渲染出错：' +
        (err && err.message ? String(err.message) : String(err)) + '</div></div>';
      if (typeof console !== 'undefined') console.error(err);
    }
    html = decorateHtml(page, html);

    app.main.innerHTML = html;
    document.title = (app.ctx.settings.shopName || '鞋服店') + ' · ' + (page.title || '');
    if (page.mount) {
      try {
        page.mount(app.ctx, app.main, state);
      } catch (err2) {
        if (typeof console !== 'undefined') console.error(err2);
      }
    }
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  /** 页面渲染结果是否已自带薄荷绿 banner（home/inventory/mine 已内置） */
  function hasBanner(html) {
    return /class="[^"]*page-banner/.test(html || '');
  }

  /** 手机端统一页头 banner：标题 + 可选右上角动作；桌面端由各页 page-head 负责 */
  function mobileBanner(page) {
    return '<div class="page-banner mobile-only page-banner-plain">' +
      '<div class="banner-title">' + (page.title || page.name || '') + '</div>' +
      '</div>';
  }

  /** 渲染前给手机端页面自动补齐薄荷绿 banner（除自带 banner 的页面外） */
  function decorateHtml(page, html) {
    if (hasBanner(html)) return html;
    return mobileBanner(page) + html;
  }

  app.hasBanner = hasBanner;
  app.mobileBanner = mobileBanner;
  app.decorateHtml = decorateHtml;

  app.render = render;

  /* ---------------- 实时输入判定（纯函数，可单测） ---------------- */

  /** 是否处于输入法组合中（中文/日文等）—— 组合中必须忽略 input 事件，否则会打断组字 */
  app._isComposing = function _isComposing(el, ev) {
    if (ev && ev.isComposing) return true;
    if (el && (el.isComposing || el.composing)) return true;
    return false;
  };

  /** 该输入是否为“实时预览”字段（data-live="1"）—— 是则重渲染并恢复焦点 */
  app._isLive = function _isLive(el) {
    return !!(el && el.getAttribute && el.getAttribute('data-live') === '1');
  };

  // 底部导航只保留最高频的三个入口；其余（开单/进货/商品/记账/报表/设置）统一收进「我的 → 常用入口」
  function navItems() {
    return [
      { name: 'home', icon: '📊', text: '首页' },
      { name: 'inventory', icon: '📋', text: '库存' },
      { name: 'mine', icon: '👤', text: '我的' }
    ];
  }
  app.navItems = navItems;

  function renderNav(page) {
    var bar = document.querySelector('.app-tabbar');
    var side = document.querySelector('.app-sidebar .nav-list');
    var inPrimary = navItems().some(function (n) {
      return n.name === page.name;
    });
    var active = inPrimary ? page.name : 'mine';

    if (bar) {
      bar.innerHTML = navItems()
        .map(function (n) {
          return '<button class="tab-item' + (n.name === active ? ' on' : '') + '" data-act="nav" data-page="' + n.name + '">' +
            '<span class="ico">' + n.icon + '</span><span>' + n.text + '</span></button>';
        })
        .join('');
    }
    if (side) {
      side.innerHTML = router()
        .all()
        .filter(function (p) {
          return !p.hideInNav;
        })
        .map(function (p) {
          return '<button class="nav-item' + (p.name === page.name ? ' on' : '') + '" data-act="nav" data-page="' + p.name + '">' +
            '<span class="ico">' + (p.icon || '·') + '</span><span>' + (p.title || p.name) + '</span></button>';
        })
        .join('');
    }
    var brand = document.querySelector('.app-header .brand');
    var brandLogo = (app.ctx.settings.avatar) ? app.ctx.settings.avatar : 'assets/icon-192.png';
    if (brand) brand.innerHTML = '<img class="brand-logo" src="' + brandLogo + '" alt="">' + (app.ctx.settings.shopName || '我的鞋服店');
    var sbrand = document.querySelector('.app-sidebar .brand');
    if (sbrand) sbrand.innerHTML = '<img class="logo" src="' + brandLogo + '" alt="logo"> <span>' + (app.ctx.settings.shopName || '我的鞋服店') + '</span>';

    /* 电脑端顶栏（v2）：店名 + 铃铛红点（有低库存预警时亮） */
    var topShop = document.getElementById('top-shop-name');
    if (topShop) topShop.textContent = app.ctx.settings.shopName || '我的鞋服店';
    var bellDot = document.getElementById('top-bell-dot');
    if (bellDot) {
      var alertCount = 0;
      try {
        alertCount = (ERP.inventory && ERP.inventory.alertStyleCount
          ? ERP.inventory.alertStyleCount(app.ctx) : 0) || 0;
      } catch (e) { /* 库存引擎未就绪时忽略 */ }
      if (alertCount > 0) bellDot.classList.remove('hidden');
      else bellDot.classList.add('hidden');
    }
  }

  app.actions = {
    nav: function (ctx, state, el) {
      router().go(el.getAttribute('data-page'));
      return false;
    }
  };

  /* ---------------- 打开密码 ---------------- */

  function showLock() {
    var mask = document.createElement('div');
    mask.className = 'lock-mask';
    mask.id = 'lock-mask';
    mask.innerHTML =
      '<div class="card lock-card">' +
      '<img class="lock-logo" src="assets/icon-192.png" alt="">' +
      '<h3 style="margin-bottom:8px">' + (app.ctx.settings.shopName || '我的鞋服店') + '</h3>' +
      '<p class="muted small mb8">请输入打开密码</p>' +
      '<input class="input" id="lock-pwd" type="password" inputmode="numeric" placeholder="打开密码" autocomplete="off">' +
      '<div id="lock-err" class="small" style="color:#dc2626;min-height:20px"></div>' +
      '<button class="btn btn-primary btn-block" id="lock-ok">进入</button>' +
      '</div>';
    document.body.appendChild(mask);
    var input = mask.querySelector('#lock-pwd');
    var err = mask.querySelector('#lock-err');
    function tryUnlock() {
      var v = input.value || '';
      if (ERP.util.verifyPassword(v, app.ctx.settings.lock.hash)) {
        document.body.removeChild(mask);
        enter();
      } else {
        err.textContent = '密码错误，请重试';
        input.value = '';
        input.focus();
      }
    }
    mask.querySelector('#lock-ok').addEventListener('click', tryUnlock);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryUnlock();
    });
    setTimeout(function () {
      input.focus();
    }, 60);
  }

  /* ---------------- 全局导出：下载文件 ---------------- */

  app.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        app.boot().catch(function (err) {
          var el = document.getElementById('view');
          if (el) {
            el.innerHTML = '<div class="card"><div class="notice notice-danger">启动失败：' +
              (err && err.message ? err.message : err) + '</div></div>';
          }
          if (typeof console !== 'undefined') console.error(err);
        });
      });
    } else {
      app.boot();
    }
  }

  return app;
});
