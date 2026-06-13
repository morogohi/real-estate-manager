/* =========================================================
 * auth.js - 정적 사이트 로그인 게이트 (소유자 + 공인중개사 멀티계정)
 *  · 소유자: data.enc.js(__REMS_ENC__) 전체 데이터 복호화
 *  · 중개사: accounts.enc.js(__REMS_ACCOUNTS__) 중 본인 비밀번호로 풀리는
 *            "본인 배정 물건만" 담긴 암호문 복호화 → 다른 물건 접근 불가(암호학적 격리)
 *  · 아이디/비밀번호는 저장하지 않음(둘 다 키 재료)
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

  // 입력 계정으로 소유자/중개사 암호문을 차례로 시도 → {role, text} 또는 throw
  async function authenticate(id, pw) {
    if (window.__REMS_ENC__) {
      try {
        var t = await REMSCrypto.decryptToText(id, pw, window.__REMS_ENC__);
        return { role: 'owner', text: t };
      } catch (e) { /* 다음 후보 */ }
    }
    var list = window.__REMS_ACCOUNTS__ || [];
    for (var i = 0; i < list.length; i++) {
      try {
        var ta = await REMSCrypto.decryptToText(id, pw, list[i]);
        return { role: 'agent', text: ta };
      } catch (e) { /* 다음 후보 */ }
    }
    throw new Error('invalid');
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

        // 계정(역할+아이디) 컨텍스트가 바뀌면 새 데이터로 교체, 같으면 기존 편집분 유지
        var ctx = await REMSCrypto.sha256hex(res.role + '|' + id);
        if (localStorage.getItem(CTX_KEY) !== ctx || !localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          localStorage.setItem(CTX_KEY, ctx);
        }
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
    location.reload();
  };

  function start() {
    var lo = document.getElementById('btnLogout');
    if (lo) {
      if (!GATE) { lo.style.display = 'none'; }
      else { lo.addEventListener('click', window.__remsLogout); }
    }

    if (!GATE) { applyRole('owner'); return; } // 데스크톱: 전체 접근

    if (sessionStorage.getItem(SESSION_KEY) === '1' && localStorage.getItem(STORAGE_KEY)) {
      applyRole(sessionStorage.getItem(ROLE_KEY) || 'owner');
      if (typeof window.__remsBoot === 'function') window.__remsBoot();
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
