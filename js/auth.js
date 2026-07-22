/* =========================================================
 * auth.js - 정적 사이트 로그인 게이트 (소유자 + 공인중개사 멀티계정)
 *  · 소유자: data.enc.js(__REMS_ENC__) + 클라우드 sync 최신본
 *  · 중개사: 클라우드 accounts.enc.json(배정 최신) → 없으면 배포 accounts.enc.js
 *            로그인 시 항상 복호화된 "배정 물건만"으로 덮어씀 (옛 localStorage 잔존 방지)
 * ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'rems_data_v3';
  var SESSION_KEY = 'rems_auth';
  var ROLE_KEY = 'rems_role';
  var CTX_KEY = 'rems_ctx';

  var GATE = (location.protocol === 'http:' || location.protocol === 'https:');
  window.__REMS_AUTH_GATE__ = GATE;

  function applyRole(role) {
    window.__REMS_ROLE__ = role;
    document.body.classList.toggle('role-agent', role === 'agent');
    document.body.classList.toggle('role-owner', role === 'owner');
  }

  async function tryDecryptList(id, pw, list) {
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      try {
        var ta = await REMSCrypto.decryptToText(id, pw, list[i]);
        return ta;
      } catch (e) { /* 다음 */ }
    }
    return null;
  }

  // 입력 계정으로 소유자/중개사 암호문을 차례로 시도 → {role, text} 또는 throw
  async function authenticate(id, pw) {
    if (window.__REMS_ENC__) {
      try {
        var t = await REMSCrypto.decryptToText(id, pw, window.__REMS_ENC__);
        return { role: 'owner', text: t };
      } catch (e) { /* 다음 후보 */ }
    }

    // 중개사: 클라우드 최신 배정 → 배포 파일 순으로 시도
    if (window.REMSSync && REMSSync.pullAccountsList) {
      try {
        var cloud = await REMSSync.pullAccountsList();
        var tc = await tryDecryptList(id, pw, cloud);
        if (tc) return { role: 'agent', text: tc };
      } catch (e2) { /* 오프라인 등 */ }
    }
    var ta = await tryDecryptList(id, pw, window.__REMS_ACCOUNTS__ || []);
    if (ta) return { role: 'agent', text: ta };

    throw new Error('invalid');
  }

  /** 중개사: 항상 복호화본으로 properties 교체 + 공개 배정표로 재필터. 소유자: 후보 중 최신 */
  async function resolveLoginData(role, id, pw, parsed) {
    if (role === 'agent') {
      var data = parsed;
      var assignDoc = null;
      if (window.REMSSync && REMSSync.pullAssignments) {
        try { assignDoc = await REMSSync.pullAssignments(); } catch (e) {}
      }
      if (window.REMSSync && REMSSync.applyAssignmentFilter) {
        data = REMSSync.applyAssignmentFilter(data, id, assignDoc);
      }
      return data;
    }
    var candidates = [];
    var ctx = await REMSCrypto.sha256hex(role + '|' + id);
    if (localStorage.getItem(CTX_KEY) === ctx && localStorage.getItem(STORAGE_KEY)) {
      try { candidates.push(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) {}
    }
    candidates.push(parsed);
    if (window.REMSSync) {
      try {
        var remote = await REMSSync.pullDecrypt(id, pw);
        if (remote && remote.properties) candidates.push(remote);
      } catch (e4) {}
    }
    var upAt = function (d) { return (d && d.meta && d.meta.updatedAt) || 0; };
    var best = candidates.reduce(function (a, b) { return upAt(b) > upAt(a) ? b : a; });
    // 소유자: 최신 데이터에 토큰이 없어도 다른 후보(클라우드 등)에 있으면 이어 붙임
    // → 배정 해제 후 중개사 클라우드 반영이 끊기지 않도록
    if (role === 'owner') {
      var tok = '';
      candidates.forEach(function (d) {
        if (d && d.settings && d.settings.ghToken) tok = d.settings.ghToken;
      });
      if (tok) {
        best.settings = best.settings || {};
        best.settings.ghToken = tok;
      }
    }
    return best;
  }

  async function refreshAgentFromCloud() {
    if (!window.REMSSync || !REMSSync.creds) return;
    var c = REMSSync.creds();
    if (!c || sessionStorage.getItem(ROLE_KEY) !== 'agent') return;
    try {
      var cloud = await REMSSync.pullAccountsList();
      var text = await tryDecryptList(c.id, c.pw, cloud);
      if (!text) {
        text = await tryDecryptList(c.id, c.pw, window.__REMS_ACCOUNTS__ || []);
      }
      if (!text) return;
      var remote = JSON.parse(text);
      if (!remote || !remote.properties) return;
      var assignDoc = null;
      try { assignDoc = await REMSSync.pullAssignments(); } catch (e) {}
      remote = REMSSync.applyAssignmentFilter(remote, c.id, assignDoc);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
      if (window.Store) {
        Store.data = remote;
        Store.migrate();
        Store.save(false);
        if (typeof renderAll === 'function') renderAll();
      }
    } catch (e) { /* 무시 */ }
  }

  function buildOverlay() {
    var ov = document.createElement('div');
    ov.id = 'authOverlay';
    ov.innerHTML = [
      '<form class="auth-card" id="authForm" autocomplete="off">',
      '  <div class="auth-logo">🔒</div>',
      '  <h1 class="auth-title">부동산 통합 관리</h1>',
      '  <p class="auth-sub">소유자 또는 공인중개사 계정으로 로그인하세요</p>',
      '  <input class="auth-input" id="authId" type="text" placeholder="아이디" autocomplete="username" />',
      '  <input class="auth-input" id="authPw" type="password" placeholder="비밀번호" autocomplete="current-password" />',
      '  <button class="auth-btn" id="authBtn" type="submit">로그인</button>',
      '  <div class="auth-msg" id="authMsg"></div>',
      '  <div class="auth-foot">계정에 따라 접근 가능한 물건만 복호화되어 표시됩니다.</div>',
      '</form>'
    ].join('');
    document.body.appendChild(ov);

    var form = ov.querySelector('#authForm');
    var msg = ov.querySelector('#authMsg');
    var btn = ov.querySelector('#authBtn');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = ov.querySelector('#authId').value.trim();
      var pw = ov.querySelector('#authPw').value;
      if (!id || !pw) { msg.textContent = '아이디와 비밀번호를 입력하세요.'; return; }
      btn.disabled = true; msg.textContent = '확인 중…';
      try {
        var res = await authenticate(id, pw);
        var parsed = JSON.parse(res.text);
        if (!parsed || !parsed.properties) throw new Error('bad');

        msg.textContent = '데이터 확인 중…';
        var best = await resolveLoginData(res.role, id, pw, parsed);
        var ctx = await REMSCrypto.sha256hex(res.role + '|' + id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
        localStorage.setItem(CTX_KEY, ctx);
        if (window.REMSSync) REMSSync.saveCreds(id, pw);
        try { localStorage.removeItem('rems_data_v1'); } catch (e2) {}

        sessionStorage.setItem(SESSION_KEY, '1');
        sessionStorage.setItem(ROLE_KEY, res.role);
        applyRole(res.role);
        ov.remove();
        document.body.classList.remove('auth-locked');
        if (typeof window.__remsBoot === 'function') window.__remsBoot();
      } catch (err) {
        msg.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
        btn.disabled = false;
      }
    });

    setTimeout(function () { var f = ov.querySelector('#authId'); if (f) f.focus(); }, 50);
  }

  window.__remsLogout = function () {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem('rems_view_as');
    location.reload();
  };

  function start() {
    var lo = document.getElementById('btnLogout');
    if (lo) {
      if (!GATE) { lo.style.display = 'none'; }
      else { lo.addEventListener('click', window.__remsLogout); }
    }

    if (!GATE) { applyRole('owner'); return; }

    if (sessionStorage.getItem(SESSION_KEY) === '1' && localStorage.getItem(STORAGE_KEY)) {
      applyRole(sessionStorage.getItem(ROLE_KEY) || 'owner');
      if (typeof window.__remsBoot === 'function') window.__remsBoot();
      // 중개사: 세션 유지 중이라도 클라우드 최신 배정으로 강제 갱신
      if (sessionStorage.getItem(ROLE_KEY) === 'agent') {
        refreshAgentFromCloud();
      } else if (window.REMSSync) {
        var c = REMSSync.creds();
        if (c) {
          REMSSync.pullDecrypt(c.id, c.pw).then(function (remote) {
            if (!remote || !remote.properties) return;
            var local = {};
            try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}
            var lu = (local.meta && local.meta.updatedAt) || 0;
            var ru = (remote.meta && remote.meta.updatedAt) || 0;
            var tok = (remote.settings && remote.settings.ghToken)
              || (local.settings && local.settings.ghToken) || '';
            // 로컬이 더 최신(배정 해제 등)이면 로컬 유지 — 토큰만 클라우드에서 보강
            var best = (ru > lu) ? remote : local;
            if (tok) {
              best.settings = best.settings || {};
              best.settings.ghToken = tok;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
            if (window.Store && Store.data) {
              Store.data = best;
              Store.migrate();
              Store.save(false);
              if (typeof renderAll === 'function') renderAll();
            }
            if (typeof reconcileAssignmentsToCloud === 'function') {
              reconcileAssignmentsToCloud();
            }
          }).catch(function () {});
        }
      }
      return;
    }

    document.body.classList.add('auth-locked');
    buildOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
