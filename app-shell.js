/*
 * Money Tracker - app shell: offline loading, "Install app", the iPhone tip, sign-in screen styles, sign out.
 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };

  /* Styles for the pieces this file and backend.js add (uses the page's colour tokens). */
  const css = document.createElement('style');
  css.textContent = `
    #mt-signin{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px));background:var(--bg)}
    #mt-signin[hidden]{display:none}
    .mt-signin-card{width:min(420px,100%);display:grid;gap:14px;justify-items:center;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:32px 24px;box-shadow:var(--shadow)}
    .mt-signin-card img{border-radius:18px}
    .mt-signin-card h1{font-size:24px}
    .mt-signin-card p{margin:0;color:var(--muted);max-width:34ch}
    .mt-google-btn{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 20px;border-radius:999px;border:1px solid var(--line);background:#fff;color:#1f1f1f;font:600 15px/1 var(--font-body);cursor:pointer;box-shadow:var(--shadow)}
    .mt-google-btn:hover{background:#f6f8f9}
    .mt-signin-msg{color:var(--expense)!important;font-weight:600;min-height:0}
    .mt-signin-msg:empty{display:none}
    .mt-signin-small{font-size:12.5px}
    .mt-install{display:none}
    .mt-install.show{display:inline-flex}
    .mt-tip{position:fixed;z-index:40;left:max(12px,env(safe-area-inset-left,0px));right:max(12px,env(safe-area-inset-right,0px));bottom:calc(var(--tabbar-h,66px) + 22px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;box-shadow:var(--shadow);font-size:14px}
    .mt-tip p{margin:0;flex:1}
    .mt-menu{position:absolute;z-index:50;right:0;top:calc(100% + 6px);min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:6px;display:grid}
    .mt-menu p{margin:0;padding:8px 10px;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
    .mt-menu button{text-align:left;justify-content:flex-start}
    #who{position:relative;cursor:pointer}
  `;
  document.head.appendChild(css);

  /* Offline loading: keep the app on the device. */
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* "Install app" (Chrome, Edge, Android): the browser hands us the prompt; we show it on a button. */
  let deferred = null;
  function installButtons() {
    const add = (parent, cls) => {
      if (!parent || $('.mt-install', parent)) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn sm mt-install ' + (cls || '');
      b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg><span>Install app</span>';
      b.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => { }); deferred = null; showInstall(false); };
      parent.insertBefore(b, parent.firstChild);
    };
    add($('.top-actions'));
    add($('.rail-hint') && $('.rail-hint').parentNode, 'rail-install');
  }
  function showInstall(on) { document.querySelectorAll('.mt-install').forEach(b => b.classList.toggle('show', on)); }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; installButtons(); showInstall(true); });
  window.addEventListener('appinstalled', () => { deferred = null; showInstall(false); });

  /* iPhone/iPad Safari has no install prompt: show a one-time tip instead. */
  function iosTip() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios || standalone() || store.get('mt.iosTip')) return;
    const tip = document.createElement('div');
    tip.className = 'mt-tip'; tip.setAttribute('role', 'note');
    tip.innerHTML = '<p><b>Install Money Tracker:</b> tap the Share button, then <b>Add to Home Screen</b>.</p><button type="button" class="btn ghost sm">Got it</button>';
    tip.querySelector('button').onclick = () => { store.set('mt.iosTip', '1'); tip.remove(); };
    document.body.appendChild(tip);
  }

  /* Tap your account chip for "Sign out" / "Switch account". */
  function accountMenu() {
    const who = $('#who'); if (!who || who.dataset.menu) return;
    who.dataset.menu = '1'; who.tabIndex = 0; who.setAttribute('role', 'button'); who.setAttribute('aria-haspopup', 'menu');
    const toggle = () => {
      let m = $('.mt-menu', who);
      if (m) { m.remove(); return; }
      m = document.createElement('div'); m.className = 'mt-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = `<p>Signed in as ${(window.MTAuth.email() || '').replace(/[<>&"]/g, '')}</p>
        <button type="button" class="btn ghost sm" role="menuitem" data-signout>Sign out / switch account</button>`;
      who.appendChild(m);
      $('[data-signout]', m).onclick = e => { e.stopPropagation(); window.MTAuth.signOut(); };
    };
    who.addEventListener('click', e => { if (!e.target.closest('.mt-menu')) toggle(); });
    who.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    document.addEventListener('click', e => { if (!who.contains(e.target)) { const m = $('.mt-menu', who); if (m) m.remove(); } });
  }

  document.addEventListener('DOMContentLoaded', () => { installButtons(); if (deferred) showInstall(true); iosTip(); accountMenu(); });
  if (document.readyState !== 'loading') { installButtons(); iosTip(); accountMenu(); }
})();
