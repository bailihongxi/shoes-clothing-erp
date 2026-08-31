/**
 * ui/router.js —— hash 路由（无 History API，file:// 下同样可用）
 * 页面对象约定：
 *   { name, title, icon, render(ctx, state) -> html, mount?(ctx, root, state), actions?{...} }
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.router = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var pages = {};
  var order = [];
  var listeners = [];
  var currentName = 'home';

  function register(name, page) {
    page = page || {};
    page.name = name;
    pages[name] = page;
    if (order.indexOf(name) < 0) order.push(name);
    return page;
  }

  function get(name) {
    return pages[name] || null;
  }

  function all() {
    return order.map(function (n) {
      return pages[n];
    });
  }

  function current() {
    return pages[currentName] || pages.home || null;
  }

  function currentNameGet() {
    return currentName;
  }

  /** 解析 hash → 页面名（#/sale?x=1 → sale） */
  function parse(hash) {
    var h = String(hash || '').replace(/^#\/?/, '');
    var q = h.indexOf('?');
    var name = q >= 0 ? h.slice(0, q) : h;
    var query = {};
    if (q >= 0) {
      h.slice(q + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
    }
    return { name: name || 'home', query: query };
  }

  function go(name, query) {
    var hash = '#/' + name;
    if (query) {
      var qs = Object.keys(query)
        .map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
        })
        .join('&');
      if (qs) hash += '?' + qs;
    }
    if (typeof location !== 'undefined') {
      if (location.hash === hash) {
        notify(parse(hash));
      } else {
        location.hash = hash;
      }
    } else {
      notify(parse(hash));
    }
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function notify(parsed) {
    var page = pages[parsed.name] ? parsed.name : 'home';
    currentName = page;
    listeners.forEach(function (fn) {
      fn(page, parsed.query);
    });
  }

  function start() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', function () {
        notify(parse(location.hash));
      });
    }
    notify(parse(typeof location !== 'undefined' ? location.hash : ''));
  }

  return {
    register: register,
    get: get,
    all: all,
    current: current,
    currentName: currentNameGet,
    parse: parse,
    go: go,
    start: start,
    onChange: onChange
  };
});
