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
  var ACCOUNTS_PATH = 'data/accounts.enc.json'; // 중개사 배정 최신본 (배정 변경 즉시 반영)
  var ASSIGN_PATH = 'data/assignments.json';   // 공개 배정표(중개사별 물건 id) — 암호문과 이중 검증
  var BRANCH = 'sync-data'; // 별도 브랜치: 동기화 커밋이 사이트 재배포를 유발하지 않음
  var API = 'https://api.github.com/repos/' + REPO + '/contents/' + PATH;
  var ACCOUNTS_API = 'https://api.github.com/repos/' + REPO + '/contents/' + ACCOUNTS_PATH;
  var ASSIGN_API = 'https://api.github.com/repos/' + REPO + '/contents/' + ASSIGN_PATH;
  var CRED_KEY = 'rems_k';
  var LAST_PUSH_KEY = 'rems_last_push';
  var LAST_ACCT_KEY = 'rems_last_acct_push';

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

  /** 중개사 로그인용 암호문 목록 다운로드 (토큰 불필요). 없으면 [] */
  async function pullAccountsList() {
    var res = await fetch(ACCOUNTS_API + '?ref=' + BRANCH + '&_=' + Date.now(), {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = JSON.parse(await res.text());
    return Array.isArray(data) ? data : [];
  }

  /** 공개 배정표 { map: { agentId: [propId,...] }, updatedAt } */
  async function pullAssignments() {
    var res = await fetch(ASSIGN_API + '?ref=' + BRANCH + '&_=' + Date.now(), {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return JSON.parse(await res.text());
  }

  function buildAssignments(data) {
    var map = {};
    ((data && data.accounts) || []).forEach(function (a) { if (a.id) map[a.id] = []; });
    ((data && data.properties) || []).forEach(function (p) {
      if (!p.managerId) return;
      if (!map[p.managerId]) map[p.managerId] = [];
      map[p.managerId].push(p.id);
    });
    return { v: 1, updatedAt: (data && data.meta && data.meta.updatedAt) || Date.now(), map: map };
  }

  /** 중개사 데이터에 공개 배정표를 적용해 해제된 물건을 제거 */
  function applyAssignmentFilter(data, agentId, assignDoc) {
    if (!data || !agentId) return data;
    var doc = assignDoc || window.__REMS_ASSIGN__;
    if (!doc || !doc.map || !doc.map[agentId]) return data;
    var allow = {};
    doc.map[agentId].forEach(function (id) { allow[id] = true; });
    data.properties = (data.properties || []).filter(function (p) { return allow[p.id]; });
    if (!data.meta) data.meta = {};
    data.meta.updatedAt = Math.max(data.meta.updatedAt || 0, doc.updatedAt || 0);
    return data;
  }

  /** 소유자 데이터에서 중개사별 배정 물건만 담은 암호문 배열 생성 */
  async function buildAccountEntries(data) {
    var accts = (data && data.accounts) || [];
    var entries = [];
    for (var i = 0; i < accts.length; i++) {
      var a = accts[i];
      if (!a.id || !a.pw) continue;
      var subset = {
        business: data.business || [],
        properties: (data.properties || []).filter(function (p) { return p.managerId === a.id; }),
        todos: [],
        accounts: [],
        settings: {
          kakaoKey: (data.settings && data.settings.kakaoKey) || '',
          deemedRate: (data.settings && data.settings.deemedRate) != null ? data.settings.deemedRate : 3.5,
        },
        meta: { updatedAt: (data.meta && data.meta.updatedAt) || Date.now() },
      };
      entries.push(await REMSCrypto.encryptJSON(a.id, a.pw, subset));
    }
    return entries;
  }

  async function putJsonFile(apiUrl, obj, message) {
    var tk = token();
    if (!tk) throw new Error('GitHub 토큰이 등록되지 않았습니다. 동기화 설정에서 토큰을 저장해주세요.');
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    var headers = {
      'Authorization': 'Bearer ' + tk,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    var sha = null;
    var g = await fetch(apiUrl + '?ref=' + BRANCH + '&_=' + Date.now(), { headers: headers, cache: 'no-store' });
    if (g.ok) sha = (await g.json()).sha;
    var body = { message: message, content: content, branch: BRANCH };
    if (sha) body.sha = sha;
    var res = await fetch(apiUrl, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error('토큰 인증 실패(권한/만료 확인). HTTP ' + res.status);
      throw new Error('업로드 실패. HTTP ' + res.status);
    }
  }

  /** 중개사 배정 암호문만 클라우드에 올림 (Pages 재배포 없이 즉시 반영) */
  async function pushAccounts(data) {
    if (window.__REMS_ROLE__ !== 'owner') throw new Error('소유자 계정에서만 업로드할 수 있습니다.');
    var src = data || Store.data;
    var entries = await buildAccountEntries(src);
    await putJsonFile(ACCOUNTS_API, entries, 'sync: 중개사 배정 갱신 (' + new Date().toLocaleString('ko-KR') + ')');
    await putJsonFile(ASSIGN_API, buildAssignments(src), 'sync: 배정표 갱신 (' + new Date().toLocaleString('ko-KR') + ')');
    try { localStorage.setItem(LAST_ACCT_KEY, String(Date.now())); } catch (e) {}
  }

  /** 현재 데이터를 암호화해 저장소에 커밋 (소유자 전용) + 중개사 배정 동시 갱신 */
  async function push() {
    if (window.__REMS_ROLE__ !== 'owner') throw new Error('소유자 계정에서만 업로드할 수 있습니다.');
    var c = creds();
    if (!c) throw new Error('세션에 로그인 정보가 없습니다. 로그아웃 후 다시 로그인해주세요.');
    if (!token()) throw new Error('GitHub 토큰이 등록되지 않았습니다. 동기화 설정에서 토큰을 저장해주세요.');

    var entry = await REMSCrypto.encryptJSON(c.id, c.pw, Store.data);
    await putJsonFile(API, entry, 'sync: 데이터 동기화 (' + new Date().toLocaleString('ko-KR') + ')');
    await pushAccounts(Store.data);
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
    if (!token()) { el.textContent = '☁️ 동기화 미설정(중개사 배정 즉시반영 불가)'; return; }
    var last = Number(localStorage.getItem(LAST_PUSH_KEY) || 0);
    var cur = (Store.data && Store.data.meta && Store.data.meta.updatedAt) || 0;
    el.textContent = (last >= cur && last)
      ? '☁️ 동기화됨 ' + new Date(last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '☁️ 업로드 대기 중…';
  }

  return {
    saveCreds: saveCreds, creds: creds, token: token,
    pullDecrypt: pullDecrypt, pullAccountsList: pullAccountsList,
    pullAssignments: pullAssignments, buildAssignments: buildAssignments,
    applyAssignmentFilter: applyAssignmentFilter,
    buildAccountEntries: buildAccountEntries, pushAccounts: pushAccounts,
    push: push, schedulePush: schedulePush, updateTag: updateTag,
  };
})();
