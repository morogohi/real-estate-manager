/* =========================================================
 * sync.js - 기기 간 클라우드 동기화 (GitHub 저장소 이용)
 *  · 데이터를 소유자 계정으로 AES-GCM 암호화해 저장소의
 *    data/sync.enc.json 에 올리고(업로드), 로그인 시 내려받아(다운로드)
 *    더 최신인 쪽을 사용합니다. 평문은 절대 저장소에 올라가지 않습니다.
 *  · 다운로드: 공개 저장소라 토큰 불필요
 *  · 업로드: 소유자가 발급한 GitHub Fine-grained 토큰 필요
 *            (해당 저장소 Contents: Read and write 권한만)
 * ========================================================= */
window.REMSSync = (function () {
  'use strict';

  var REPO = 'morogohi/real-estate-manager';
  var PATH = 'data/sync.enc.json';
  var BRANCH = 'sync-data'; // 별도 브랜치: 동기화 커밋이 사이트 재배포를 유발하지 않음
  var API = 'https://api.github.com/repos/' + REPO + '/contents/' + PATH;
  var CRED_KEY = 'rems_k';
  var LAST_PUSH_KEY = 'rems_last_push';

  /* 로그인 성공 시 auth.js가 세션에 보관한 자격(키 재료) */
  function saveCreds(id, pw) {
    try { sessionStorage.setItem(CRED_KEY, btoa(unescape(encodeURIComponent(id + '\n' + pw)))); } catch (e) {}
  }
  function creds() {
    try {
      var raw = sessionStorage.getItem(CRED_KEY);
      if (!raw) return null;
      var t = decodeURIComponent(escape(atob(raw)));
      var i = t.indexOf('\n');
      return { id: t.slice(0, i), pw: t.slice(i + 1) };
    } catch (e) { return null; }
  }

  function token() {
    try { return (Store.data && Store.data.settings && Store.data.settings.ghToken) || ''; } catch (e) { return ''; }
  }

  /** 원격 sync 파일을 내려받아 복호화. 파일 없으면 null, 실패 시 throw */
  async function pullDecrypt(id, pw) {
    var res = await fetch(API + '?ref=' + BRANCH + '&_=' + Date.now(), {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var entry = JSON.parse(await res.text());
    var text = await REMSCrypto.decryptToText(id, pw, entry);
    return JSON.parse(text);
  }

  /** 현재 데이터를 암호화해 저장소에 커밋 (소유자 전용) */
  async function push() {
    if (window.__REMS_ROLE__ !== 'owner') throw new Error('소유자 계정에서만 업로드할 수 있습니다.');
    var c = creds();
    if (!c) throw new Error('세션에 로그인 정보가 없습니다. 로그아웃 후 다시 로그인해주세요.');
    var tk = token();
    if (!tk) throw new Error('GitHub 토큰이 등록되지 않았습니다. 동기화 설정에서 토큰을 저장해주세요.');

    var entry = await REMSCrypto.encryptJSON(c.id, c.pw, Store.data);
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(entry))));
    var headers = {
      'Authorization': 'Bearer ' + tk,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    var sha = null;
    var g = await fetch(API + '?ref=' + BRANCH + '&_=' + Date.now(), { headers: headers, cache: 'no-store' });
    if (g.ok) sha = (await g.json()).sha;

    var body = { message: 'sync: 데이터 동기화 (' + new Date().toLocaleString('ko-KR') + ')', content: content, branch: BRANCH };
    if (sha) body.sha = sha;
    var res = await fetch(API, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error('토큰 인증 실패(권한/만료 확인). HTTP ' + res.status);
      throw new Error('업로드 실패. HTTP ' + res.status);
    }
    try { localStorage.setItem(LAST_PUSH_KEY, String((Store.data.meta && Store.data.meta.updatedAt) || Date.now())); } catch (e) {}
    updateTag();
  }

  /* 저장 후 8초 뒤 자동 업로드 (연속 편집 시 마지막 1회만) */
  var timer = null;
  function schedulePush() {
    updateTag();
    if (window.__REMS_ROLE__ !== 'owner' || !token() || !creds()) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      push().catch(function () { updateTag('업로드 실패'); });
    }, 8000);
  }

  /** 사이드바 동기화 상태 표시 */
  function updateTag(errText) {
    var el = document.getElementById('syncTag');
    if (!el) return;
    if (window.__REMS_ROLE__ !== 'owner') { el.textContent = ''; return; }
    if (errText) { el.textContent = '☁️ ' + errText; return; }
    if (!token()) { el.textContent = '☁️ 동기화 미설정'; return; }
    var last = Number(localStorage.getItem(LAST_PUSH_KEY) || 0);
    var cur = (Store.data && Store.data.meta && Store.data.meta.updatedAt) || 0;
    el.textContent = (last >= cur && last)
      ? '☁️ 동기화됨 ' + new Date(last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '☁️ 업로드 대기 중…';
  }

  return { saveCreds: saveCreds, creds: creds, token: token, pullDecrypt: pullDecrypt, push: push, schedulePush: schedulePush, updateTag: updateTag };
})();
