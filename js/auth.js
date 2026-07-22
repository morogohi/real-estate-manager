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

        // 후보(이 기기의 편집분 / 배포 파일 / 클라우드) 중 가장 최신 데이터 채택
        var ctx = await REMSCrypto.sha256hex(res.role + '|' + id);
        var sameCtx = localStorage.getItem(CTX_KEY) === ctx;
        var candidates = [];
        if (sameCtx && localStorage.getItem(STORAGE_KEY)) {
          try { candidates.push(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e3) {}
        }
        candidates.push(parsed);
        if (window.REMSSync) {
          msg.textContent = '클라우드 확인 중…';
          try {
            var remote = await REMSSync.pullDecrypt(id, pw);
            if (remote && remote.properties) candidates.push(remote);
          } catch (e4) { /* 오프라인/네트워크 오류 시 로컬만 사용 */ }
        }
        var upAt = function (d) { return (d && d.meta && d.meta.updatedAt) || 0; };
        var best = candidates.reduce(function (a, b) { return upAt(b) > upAt(a) ? b : a; });
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
      // 백그라운드로 클라우드 최신본 확인 (다른 기기에서 수정했을 수 있음)
      if (window.REMSSync) {
        var c = REMSSync.creds();
        if (c) {
          REMSSync.pullDecrypt(c.id, c.pw).then(function (remote) {
            if (!remote || !remote.properties) return;
            var local = {};
            try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}
            var lu = (local.meta && local.meta.updatedAt) || 0;
            var ru = (remote.meta && remote.meta.updatedAt) || 0;
            if (ru > lu) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
              if (window.Store && Store.data) {
                Store.data = remote;
                Store.migrate();
                Store.save(false); // 내장 DB에도 반영
                if (typeof renderAll === 'function') renderAll();
              }
            }
          }).catch(function () { /* 오프라인이면 무시 */ });
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
