/* 訳す Yakusu — in-place Japanese → English page translator (bookmarklet).
   Free, no key, no install. Text nodes only; DOM structure untouched. */
(function () {
  var W = window, D = document;
  if (W.__yakusu) { W.__yakusu.toggle(); return; }

  var RELAY = '__RELAY_URL__';
  var EPS = [
    'https://translate.googleapis.com/translate_a/t?client=gtx&sl=ja&tl=en&format=text',
    'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ja&tl=en'
  ];
  var JP = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, KBD: 1, SAMP: 1, VAR: 1, TEMPLATE: 1, CANVAS: 1, OBJECT: 1, EMBED: 1, 'YAKUSU-UI': 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var INLINE = { A: 1, B: 1, STRONG: 1, EM: 1, I: 1, U: 1, S: 1, SPAN: 1, SMALL: 1, BIG: 1, FONT: 1, LABEL: 1, MARK: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, TIME: 1, DATA: 1 };
  var host = location.host || location.protocol;
  var SKEY = 'yakusu1:ja:en';
  var OKKEY = 'yakusu-ok';

  var texts = new Map();   // Text -> {o, t, n}
  var attrs = new Map();   // Element -> {attr: {o, t}}
  var cache = new Map();   // source -> translation
  var pending = new Map(); // source -> {p: priority, f: [callbacks]}
  var roots = [];          // observed roots
  var obs = null, mode = 'en', running = false, inflight = 0, stopped = false;
  var cspHit = false, transport = 'direct', relayWin = null, relayReady = false, relaySeq = 0, relayWait = {};
  var done = 0, failCount = 0, ui = {}, halted = false;

  try { var s = JSON.parse(sessionStorage.getItem(SKEY) || '{}'); for (var k in s) cache.set(k, s[k]); } catch (e) {}

  D.addEventListener('securitypolicyviolation', onCsp, true);
  function onCsp(e) {
    if (/connect-src|default-src/.test(e.violatedDirective || e.effectiveDirective || '') && /google/.test(e.blockedURI || '')) cspHit = true;
  }

  /* ---------- UI (shadow DOM, no innerHTML so Trusted Types pages are fine) ---------- */
  function el(tag, cls, txt, parent) {
    var x = D.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; if (parent) parent.appendChild(x); return x;
  }
  var CSS = ':host{all:initial}*{box-sizing:border-box;font-family:"Segoe UI","Yu Gothic UI","Meiryo UI","Meiryo","Hiragino Sans","Noto Sans JP",sans-serif;font-size:13px;line-height:1.4}' +
    '.box{background:#fffaf3;color:#241f1a;border:1px solid #d9c9b3;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:6px;min-width:150px;max-width:340px}' +
    '.bar{display:flex;align-items:center;gap:4px}.grip{cursor:grab;user-select:none;font-weight:700;color:#3e6b4c;padding:2px 6px;font-size:15px;touch-action:none}' +
    '.seg{display:flex;border:1px solid #d9c9b3;border-radius:999px;overflow:hidden}.seg button,.x,.btn{border:0;background:transparent;color:#6e655c;cursor:pointer;padding:3px 10px;font-weight:600}' +
    '.seg button[aria-pressed=true]{background:#3e6b4c;color:#fff}.x{padding:3px 7px;margin-left:auto;font-size:15px}' +
    '.msg{margin:6px 4px 2px;color:#4a433c;white-space:pre-line}.msg:empty{display:none}.err{color:#a3402a}' +
    '.acts{display:flex;gap:6px;flex-wrap:wrap;margin:6px 4px 2px}.acts:empty{display:none}' +
    '.btn{border:1px solid #3e6b4c;border-radius:999px;color:#3e6b4c;padding:4px 12px}.btn.p{background:#3e6b4c;color:#fff}' +
    '.warn{margin:6px 4px;padding:8px;border-radius:10px;background:#fbefe9;border:1px solid #e9c3b2;color:#5a2a1a}.warn b{display:block;margin-bottom:4px}.warn p{margin:0 0 6px}';

  function buildUI() {
    var h = D.createElement('yakusu-ui');
    h.setAttribute('translate', 'no');
    h.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:block';
    var sr = h.attachShadow ? h.attachShadow({ mode: 'open' }) : h;
    try { var sh = new CSSStyleSheet(); sh.replaceSync(CSS); sr.adoptedStyleSheets = [sh]; } catch (e) { el('style', '', CSS, sr); }
    var box = el('div', 'box', null, sr);
    var bar = el('div', 'bar', null, box);
    var grip = el('span', 'grip', '訳', bar); grip.title = '訳す Yakusu — drag / ドラッグで移動';
    var seg = el('div', 'seg', null, bar);
    ui.en = el('button', '', 'EN', seg); ui.ja = el('button', '', 'JP', seg);
    ui.en.title = 'English'; ui.ja.title = '原文（日本語）/ Original';
    var x = el('button', 'x', '×', bar); x.title = '終了（元に戻す）/ Close & restore';
    ui.msg = el('div', 'msg', '', box);
    ui.acts = el('div', 'acts', '', box);
    ui.en.onclick = function () { setMode('en'); };
    ui.ja.onclick = function () { setMode('ja'); };
    x.onclick = quit;
    drag(grip, h);
    ui.host = h; ui.box = box;
    (D.body && D.body.nodeName !== 'FRAMESET' ? D.body : D.documentElement).appendChild(h);
    paint();
  }
  function drag(handle, h) {
    var sx, sy, ox, oy, on = false;
    handle.addEventListener('pointerdown', function (e) {
      var r = h.getBoundingClientRect(); on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!on) return;
      var nx = Math.max(0, Math.min(innerWidth - 60, ox + e.clientX - sx)), ny = Math.max(0, Math.min(innerHeight - 30, oy + e.clientY - sy));
      h.style.setProperty('left', nx + 'px'); h.style.setProperty('top', ny + 'px');
      h.style.setProperty('right', 'auto'); h.style.setProperty('bottom', 'auto');
    });
    handle.addEventListener('pointerup', function () { on = false; });
  }
  function paint() {
    if (!ui.en) return;
    ui.en.setAttribute('aria-pressed', mode === 'en'); ui.ja.setAttribute('aria-pressed', mode === 'ja');
  }
  function say(t, isErr, acts) {
    if (!ui.msg) return;
    ui.msg.textContent = t || ''; ui.msg.className = 'msg' + (isErr ? ' err' : '');
    while (ui.acts.firstChild) ui.acts.removeChild(ui.acts.firstChild);
    (acts || []).forEach(function (a) { var b = el('button', 'btn' + (a.p ? ' p' : ''), a.t, ui.acts); b.onclick = a.f; });
  }

  /* ---------- privacy consent (once per site) ---------- */
  function hasOk() { try { return localStorage.getItem(OKKEY) === '1'; } catch (e) { return W.__yakusuOk === 1; } }
  function setOk() { try { localStorage.setItem(OKKEY, '1'); } catch (e) {} W.__yakusuOk = 1; }
  function consent(go) {
    var w = el('div', 'warn', null, ui.box);
    el('b', '', 'ご注意 / Privacy', w);
    el('p', '', 'このページの文字は翻訳のため外部サービス（Google 翻訳）に送られます。社外秘・個人情報のページでは使わないでください。', w);
    el('p', '', "This page's text is sent to an outside service (Google Translate). Don't use it on confidential pages or pages with personal data.", w);
    el('p', '', '「' + host + '」では次回から聞きません。/ Won\'t ask again on this site.', w);
    var a = el('div', 'acts', null, w);
    var ok = el('button', 'btn p', 'OK・翻訳する / Translate', a);
    var no = el('button', 'btn', 'やめる / Cancel', a);
    ok.onclick = function () { setOk(); ui.box.removeChild(w); go(); };
    no.onclick = function () { quit(); };
  }

  /* ---------- scanning ---------- */
  function skipEl(e) {
    if (SKIP[e.nodeName.toUpperCase()]) return true;
    if (e.isContentEditable) return true;
    if (e.getAttribute('translate') === 'no') return true;
    var c = e.classList; if (c && (c.contains('notranslate') || c.contains('yakusu-no'))) return true;
    return false;
  }
  function prio(e) {
    try {
      var r = e.getBoundingClientRect();
      if (!r.width && !r.height) return 3;
      return (r.bottom < -400 || r.top > innerHeight + 1200) ? 2 : (r.top > innerHeight ? 1 : 0);
    } catch (_) { return 2; }
  }
  function addRoot(r) {
    if (roots.indexOf(r) >= 0) return;
    roots.push(r); if (obs) watch(r);
    scan(r);
  }
  function scan(root) {
    if (root.nodeType === 3) { addText(root); return; }
    if (root.nodeType === 1 && (skipEl(root))) return;
    if (root.nodeType === 1) visitEl(root);
    var doc = root.ownerDocument || root;
    var tw = doc.createTreeWalker(root, 5, { acceptNode: function (n) { return n.nodeType === 1 && skipEl(n) ? 2 : 1; } });
    var n; while ((n = tw.nextNode())) { if (n.nodeType === 3) addText(n); else visitEl(n); }
  }
  function visitEl(e) {
    if (e.shadowRoot) addRoot(e.shadowRoot);
    var nm = e.nodeName;
    if (nm === 'IFRAME' || nm === 'FRAME') {
      var f = function () { try { var d = e.contentDocument; if (d && (d.body || d.documentElement)) { addRoot(d.body || d.documentElement); hookDoc(d); } } catch (_) {} };
      if (!e.__yk) { e.__yk = 1; e.addEventListener('load', f); }
      f();
      return;
    }
    if (e.hasAttribute) addAttrs(e);
  }
  function hookDoc(d) {
    try { d.addEventListener('securitypolicyviolation', onCsp, true); } catch (_) {}
  }
  function addText(n) {
    var v = n.nodeValue, r = texts.get(n);
    if (r) { if (v === r.t || v === r.o) return; if (++r.n > 30) { texts.delete(n); return; } }
    if (!v || !JP.test(v)) { if (r) texts.delete(n); return; }
    var p = n.parentNode;
    if (p && p.nodeName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', p.value); // keep form value = original
    if (!r) { r = { o: v, t: null, n: 0 }; texts.set(n, r); } else { r.o = v; r.t = null; }
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v);
    want(m[2], p && p.nodeType === 1 ? prio(p) : 2, function (tr) {
      if (r.o !== v) return;
      r.t = m[1] + (!m[1] && needSpace(n, tr) ? ' ' : '') + tr + m[3];
      if (mode === 'en' && n.nodeValue !== r.t) n.nodeValue = r.t;
    });
  }
  // Japanese has no spaces between words, so "<b>午後三時</b>から" would become "3pmwill". Add a space when needed.
  function needSpace(n, tr) {
    if (!/^[A-Za-z0-9("'$]/.test(tr)) return false;
    var x = n, prev = null;
    while (x && !(prev = x.previousSibling)) { x = x.parentNode; if (!x || !INLINE[x.nodeName]) return false; }
    if (!prev) return false;
    var r = prev.nodeType === 3 ? texts.get(prev) : null;
    var pt = r ? r.o : (prev.textContent || '');
    if (!pt) return prev.nodeName !== 'BR';
    return !/[\s(（「『【\[]$/.test(pt);
  }
  function addAttrs(e) {
    var list = ATTRS;
    var it = e.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(e.type) && !e.name;
    if (it) list = ATTRS.concat('value');
    for (var i = 0; i < list.length; i++) (function (a) {
      var v = e.getAttribute(a); if (!v) return;
      var rec = attrs.get(e) || {}, r = rec[a];
      if (r && (v === r.t || v === r.o)) return;
      if (!JP.test(v)) { if (r) delete rec[a]; return; }
      r = rec[a] = { o: v, t: null }; attrs.set(e, rec);
      want(v.trim(), 2, function (tr) { if (r.o !== v) return; r.t = tr; if (mode === 'en') e.setAttribute(a, tr); });
    })(list[i]);
  }

  /* ---------- queue / batching ---------- */
  function want(src, p, cb) {
    if (!src) return;
    if (cache.has(src)) { cb(cache.get(src)); return; }
    var q = pending.get(src);
    if (q) { q.f.push(cb); if (p < q.p) q.p = p; } else pending.set(src, { p: p, f: [cb] });
    pump();
  }
  var pumpT = 0;
  function pump() { if (!pumpT && running) pumpT = setTimeout(function () { pumpT = 0; flush(); }, 30); }
  function flush() {
    if (stopped || !running || halted) return;
    while (inflight < 2 && pending.size) {
      var keys = [];
      pending.forEach(function (v, k) { if (!v.busy) keys.push(k); });
      if (!keys.length) return;
      var best = 9; keys.forEach(function (k) { var pp = pending.get(k).p; if (pp < best) best = pp; });
      var batch = [], chars = 0;
      for (var i = 0; i < keys.length && batch.length < 80; i++) {
        var k = keys[i]; if (pending.get(k).p !== best) continue;
        if (chars && chars + k.length > 3500) break;
        batch.push(k); chars += k.length; pending.get(k).busy = 1;
      }
      send(batch);
    }
    status();
  }
  function send(batch) {
    inflight++;
    var parts = [], map = [];
    batch.forEach(function (k, i) { split(k).forEach(function (s) { parts.push(s); map.push(i); }); });
    translate(parts).then(function (out) {
      var res = batch.map(function () { return []; });
      out.forEach(function (t, j) { res[map[j]].push(t); });
      batch.forEach(function (k, i) {
        var t = res[i].join(' ').trim() || k;
        cache.set(k, t); var q = pending.get(k); pending.delete(k); done++;
        if (q) q.f.forEach(function (f) { try { f(t); } catch (_) {} });
      });
      failCount = 0; saveCache();
      inflight--; setTimeout(flush, 120);
    }, function (err) {
      inflight--;
      batch.forEach(function (k) { var q = pending.get(k); if (q) q.busy = 0; });
      onFail(err);
    });
  }
  function split(s) {
    if (s.length <= 1500) return [s];
    var out = [], cur = '';
    s.split(/(?<=[。！？!?\n])/).forEach(function (piece) {
      while (piece.length > 1500) { out.push(piece.slice(0, 1500)); piece = piece.slice(1500); }
      if ((cur + piece).length > 1500) { out.push(cur); cur = ''; }
      cur += piece;
    });
    if (cur) out.push(cur);
    return out;
  }
  var saveT = 0;
  function saveCache() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try {
        var o = {}, n = 0, arr = Array.from(cache.entries());
        for (var i = Math.max(0, arr.length - 6000); i < arr.length; i++) { o[arr[i][0]] = arr[i][1]; n++; }
        sessionStorage.setItem(SKEY, JSON.stringify(o));
      } catch (e) {}
    }, 800);
  }

  /* ---------- transports ---------- */
  function gpost(url, arr) {
    var body = arr.map(function (s) { return 'q=' + encodeURIComponent(s); }).join('&');
    return fetch(url, { method: 'POST', body: body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } })
      .then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .then(function (j) {
        if (typeof j === 'string') j = [j];
        if (!Array.isArray(j) || j.length !== arr.length) throw new Error('bad response');
        return j.map(function (x) { return Array.isArray(x) ? x[0] : x; });
      });
  }
  function direct(arr) {
    return gpost(EPS[0], arr).catch(function (e1) {
      return gpost(EPS[1], arr).catch(function (e2) { throw (e2.status ? e2 : e1.status ? e1 : e2); });
    });
  }
  function translate(arr) {
    if (transport === 'relay') return viaRelay(arr);
    return direct(arr);
  }
  function viaRelay(arr) {
    return new Promise(function (ok, bad) {
      if (!relayWin || relayWin.closed) { relayReady = false; var e = new Error('relay closed'); e.relay = 1; bad(e); return; }
      var id = ++relaySeq;
      var t = setTimeout(function () { delete relayWait[id]; var e = new Error('relay timeout'); e.relay = 1; bad(e); }, 25000);
      relayWait[id] = function (m) { clearTimeout(t); delete relayWait[id]; if (m.out) ok(m.out); else { var e = new Error(m.err || 'relay error'); e.status = m.status; bad(e); } };
      relayWin.postMessage({ yakusu: 'tr', id: id, q: arr }, '*');
    });
  }
  W.addEventListener('message', onMsg);
  function onMsg(e) {
    var m = e.data; if (!m || !m.yakusu || e.source !== relayWin) return;
    if (m.yakusu === 'ready') {
      relayReady = true; transport = 'relay'; failCount = 0; halted = false;
      say('中継ウィンドウで翻訳中… / Translating via relay…');
      pump();
    } else if (m.yakusu === 'res' && relayWait[m.id]) relayWait[m.id](m);
  }
  function openRelay() {
    relayReady = false;
    relayWin = W.open(RELAY, 'yakusu_relay', 'popup,width=420,height=300');
    if (!relayWin) { say('ポップアップがブロックされました。アドレスバー右端のアイコンから許可してください。\nPopup blocked — allow popups for this site, then try again.', true, [{ t: 'もう一度 / Retry', p: 1, f: openRelay }]); return; }
    say('中継ウィンドウに接続中… / Connecting to relay…');
    setTimeout(function () {
      if (!relayReady) say('中継ウィンドウに接続できませんでした（このページの設定で他のウィンドウとの通信が切られている可能性）。\nCould not connect to the relay window (this page may isolate itself from other windows).', true, [{ t: 'もう一度 / Retry', p: 1, f: openRelay }]);
    }, 8000);
  }

  var backoff = 0;
  function onFail(err) {
    failCount++;
    if (err && err.relay) {
      halted = true;
      say('中継ウィンドウが閉じられました。/ The relay window was closed.', true, [{ t: '中継ウィンドウを開く / Open relay', p: 1, f: openRelay }]);
      return;
    }
    var st = err && err.status;
    if (st === 429 || st >= 500) {
      if (failCount <= 4) { backoff = 2000 * failCount * failCount; say('混み合っています。' + Math.round(backoff / 1000) + '秒後に再試行… / Busy (rate limit), retrying…', true); setTimeout(flush, backoff); return; }
      halted = true;
      say('翻訳サービスの回数制限に達しました。しばらく（数分〜1時間）待ってから押してください。\nTranslation service rate-limited. Wait a while, then retry.', true, [{ t: '再試行 / Retry', p: 1, f: retry }]);
      return;
    }
    halted = true;
    setTimeout(function () {
      if (cspHit) {
        say('このページの設定（CSP）で外部への通信がブロックされています。小さな中継ウィンドウを開くと翻訳できます。\nThis page blocks outside connections (Content-Security-Policy). Open a small relay window to translate.', true,
          [{ t: '中継ウィンドウを開く / Open relay', p: 1, f: openRelay }]);
      } else {
        say('翻訳サービスにつながりませんでした（社内ネットワークで Google がブロックされている可能性）。\nCould not reach the translation service (the network may block Google).', true,
          [{ t: '再試行 / Retry', p: 1, f: retry }, { t: '中継ウィンドウ / Relay', f: openRelay }]);
      }
    }, 60);
  }

  function retry() { failCount = 0; halted = false; say('…'); flush(); }
  function status() {
    if (stopped || halted) return;
    if (pending.size || inflight) say('翻訳中… / Translating… ' + done + '/' + (done + pending.size));
    else if (mode === 'en') say(done ? '✓ 英語 / English' : '✓');
  }

  /* ---------- observer ---------- */
  var dirty = new Set(), obsT = 0;
  function watch(r) { try { obs.observe(r, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') }); } catch (_) {} }
  function startObs() {
    obs = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') m.addedNodes.forEach(function (n) { dirty.add(n); });
        else dirty.add(m.target);
      }
      if (!obsT) obsT = setTimeout(function () {
        obsT = 0; var arr = Array.from(dirty); dirty.clear();
        arr.forEach(function (n) {
          if (!n.isConnected || (ui.host && (n === ui.host || ui.host.contains(n)))) return;
          var p = n.nodeType === 3 ? n.parentElement : n;
          for (var a = p; a && a.nodeType === 1; a = a.parentElement) if (skipEl(a)) return;
          if (n.nodeType === 3) addText(n); else if (n.nodeType === 1) { visitEl(n); if (n.firstChild || n.shadowRoot) scan(n); }
        });
        texts.forEach(function (r, n) { if (!n.isConnected) texts.delete(n); });
      }, 350);
    });
    roots.forEach(watch);
  }

  /* ---------- mode / lifecycle ---------- */
  function apply() {
    texts.forEach(function (r, n) { var v = mode === 'en' && r.t != null ? r.t : r.o; if (n.nodeValue !== v) n.nodeValue = v; });
    attrs.forEach(function (rec, e) { for (var a in rec) { var r = rec[a], v = mode === 'en' && r.t != null ? r.t : r.o; if (e.getAttribute(a) !== v) e.setAttribute(a, v); } });
    if (titleRec) { var v = mode === 'en' && titleRec.t ? titleRec.t : titleRec.o; if (D.title !== v) D.title = v; }
  }
  function setMode(m) { mode = m; apply(); paint(); if (m === 'ja') say('原文 / Original'); else status(); }
  var titleRec = null;
  function doTitle() {
    var t = D.title; if (!t || !JP.test(t)) return;
    titleRec = { o: t, t: null };
    want(t.trim(), 1, function (tr) { titleRec.t = tr; if (mode === 'en') D.title = tr; });
  }
  function start() {
    running = true;
    say('翻訳中… / Translating…');
    startObs();
    doTitle();
    addRoot(D.body || D.documentElement);
    pump();
    setTimeout(status, 200);
  }
  function quit() {
    stopped = true; running = false;
    if (obs) obs.disconnect();
    mode = 'ja'; apply();
    if (ui.host && ui.host.parentNode) ui.host.parentNode.removeChild(ui.host);
    W.removeEventListener('message', onMsg);
    D.removeEventListener('securitypolicyviolation', onCsp, true);
    try { if (relayWin && !relayWin.closed) relayWin.close(); } catch (_) {}
    delete W.__yakusu;
  }
  W.__yakusu = {
    toggle: function () { setMode(mode === 'en' ? 'ja' : 'en'); },
    quit: quit,
    stats: function () { return { texts: texts.size, attrs: attrs.size, cache: cache.size, pending: pending.size, transport: transport, csp: cspHit, mode: mode }; }
  };

  buildUI();
  if (hasOk()) start(); else consent(start);
})();
