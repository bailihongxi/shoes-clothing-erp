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

  app.boot = async function boot() {
    if (typeof document === 'undefined') return null;
    app.db = await ERP.db.create({});
    var data = await ERP.repo.loadAll(app.db);
    app.ctx = ERP.repo.createContext(data);
    app.main = document.getElementById('view');

    // 注册所有已加载的页面到路由
    if (ERP.pages) {
      Object.keys(ERP.pages).forEach(function (name) {
        router().register(name, ERP.pages[name]);
      });
    }

    app.ready = true;

    bindGlobalEvents();

    if (app.ctx.settings.lock && app.ctx.settings.lock.enabled && app.ctx.settings.lock.hash) {
      showLock();
    } else {
      enter();
    }
    return app.ctx;
  };

  function enter() {
    router().start();
    router().onChange(function () {
      render();
    });
    render();
  }

  function bindGlobalEvents() {
    document.addEventListener('click', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!el) return;
      var name = el.getAttribute('data-act');
      var handled = dispatch(name, el, ev);
      if (handled !== false) {
        afterAction();
      }
    });

    document.addEventListener('change', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-change]') : null;
      if (!el) return;
      var name = el.getAttribute('data-change');
      if (dispatch(name, el, ev) !== false) afterAction();
    });

    document.addEventListener('input', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input');
      // 输入法组合进行中：完全忽略，等 compositionend 统一处理，避免打断中文输入
      if (app._isComposing(el, ev)) return;
      dispatch(name, el, ev);
      // data-live="1"：实时预览（重渲染并恢复焦点/光标）；普通字段只更新内存，不重渲染
      if (app._isLive(el)) relive(el);
    });

    // 输入法结束后补一次重渲染（中文/日文等组合输入必须靠它才能正确刷新预览）
    document.addEventListener('compositionend', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input');
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
  }

  /** 找到动作处理函数：页面 → 全局 */
  function dispatch(name, el, ev) {
    var page = router().current();
    var state = stateOf(page);
    var fn = null;
    if (page && page.actions && page.actions[name]) fn = page.actions[name];
    else if (ui().globalActions && ui().globalActions[name]) fn = ui().globalActions[name];
    else if (app.actions && app.actions[name]) fn = app.actions[name];
    if (!fn) return undefined;
    return fn(app.ctx, state, el, ev);
  }

  function stateOf(page) {
    if (!page) return {};
    if (!app.pageStates[page.name]) {
      app.pageStates[page.name] = page.init ? page.init(app.ctx) : {};
    }
    return app.pageStates[page.name];
  }

  async function afterAction() {
    await commit();
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

  function navItems() {
    return [
      { name: 'home', icon: '📊', text: '首页' },
      { name: 'sale', icon: '🛒', text: '开单' },
      { name: 'inventory', icon: '📋', text: '库存' },
      { name: 'report', icon: '📈', text: '报表' },
      { name: 'mine', icon: '👤', text: '我的' }
    ];
  }

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
    if (brand) brand.textContent = app.ctx.settings.shopName || '我的鞋服店';
    var sbrand = document.querySelector('.app-sidebar .brand');
    if (sbrand) sbrand.innerHTML = '👟 <span>' + (app.ctx.settings.shopName || '我的鞋服店') + '</span>';
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
      '<h3 style="margin-bottom:8px">🔒 ' + (app.ctx.settings.shopName || '我的鞋服店') + '</h3>' +
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
