/* =========================================================
 * auth.js - 정적 사이트용 로그인 게이트
 *  · 실데이터는 data.enc.js 에 AES-GCM 암호문으로만 존재(평문 개인정보 없음)
 *  · 입력한 "아이디 + 비밀번호"로 PBKDF2 키를 유도해 복호화에 성공해야만 접근 허용
 *  · 아이디/비밀번호는 저장소·코드 어디에도 저장하지 않음(둘 다 키 재료로만 사용)
 * ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'rems_data_v1'; // data.js 와 동일
  var SESSION_KEY = 'rems_auth';

  // 데스크톱(file://)에서는 게이트 비활성화 → app.js 가 정상 부팅
  var GATE = (location.protocol === 'http:' || location.protocol === 'https:');
  window.__REMS_AUTH_GATE__ = GATE;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function decrypt(id, pw) {
    var enc = window.__REMS_ENC__;
    if (!enc) throw new Error('no-data');
    var salt = b64ToBytes(enc.salt);
    var iv = b64ToBytes(enc.iv);
    var ct = b64ToBytes(enc.ct);
    var pass = new TextEncoder().encode(id + '\n' + pw);
    var baseKey = await crypto.subtle.importKey('raw', pass, 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: enc.iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    return new TextDecoder().decode(ptBuf);
  }

  function buildOverlay() {
    var ov = document.createElement('div');
    ov.id = 'authOverlay';
    ov.innerHTML = [
      '<form class="auth-card" id="authForm" autocomplete="off">',
      '  <div class="auth-logo">🔒</div>',
      '  <h1 class="auth-title">부동산 통합 관리</h1>',
      '  <p class="auth-sub">접근하려면 로그인하세요</p>',
      '  <input class="auth-input" id="authId" type="text" placeholder="아이디" autocomplete="username" />',
      '  <input class="auth-input" id="authPw" type="password" placeholder="비밀번호" autocomplete="current-password" />',
      '  <button class="auth-btn" id="authBtn" type="submit">로그인</button>',
      '  <div class="auth-msg" id="authMsg"></div>',
      '  <div class="auth-foot">데이터는 암호화되어 저장되며, 올바른 계정으로만 복호화됩니다.</div>',
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
      btn.disabled = true;
      msg.textContent = '확인 중…';
      try {
        var jsonText = await decrypt(id, pw);
        var parsed = JSON.parse(jsonText);
        if (!parsed || !parsed.properties) throw new Error('bad');
        // 기존 작업 데이터가 없을 때만 실데이터로 시드(이전 편집분 보존)
        if (!localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        sessionStorage.setItem(SESSION_KEY, '1');
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

  // 로그아웃: 세션 해제 후 새로고침(접근만 잠금)
  window.__remsLogout = function () {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  };

  function start() {
    var lo = document.getElementById('btnLogout');
    if (lo) {
      if (!GATE) { lo.style.display = 'none'; }
      else { lo.addEventListener('click', window.__remsLogout); }
    }

    if (!GATE) return; // 데스크톱: app.js 자동 부팅

    // 같은 탭에서 이미 로그인했고 데이터가 있으면 바로 통과
    if (sessionStorage.getItem(SESSION_KEY) === '1' && localStorage.getItem(STORAGE_KEY)) {
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
