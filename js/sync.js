/* =========================================================
 * sync.js - 기기 간 클라우드 동기화 (GitHub 저장소 이용)
 *  · 소유자: data/sync.enc.json + accounts.enc.json + assignments.json
 *  · 중개사: data/patches/{agentId}.enc.json 에 임차인·계약 변경을 암호화 업로드
 *            소유자 로그인/병합 시 마스터 데이터에 통합
 *  · 다운로드: 공개 저장소라 토큰 불필요
 *  · 업로드: GitHub Contents 쓰기 토큰 필요 (소유자 설정 → 중개사 배정 암호문에 포함)
 * ========================================================= */
window.REMSSync = (function () {
  'use strict';

  var REPO = 'morogohi/real-estate-manager';
  var PATH = 'data/sync.enc.json';
  var ACCOUNTS_PATH = 'data/accounts.enc.json';
  var ASSIGN_PATH = 'data/assignments.json';
  var PATCH_DIR = 'data/patches';
  var BRANCH = 'sync-data';
  var API = 'https://api.github.com/repos/' + REPO + '/contents/' + PATH;
  var ACCOUNTS_API = 'https://api.github.com/repos/' + REPO + '/contents/' + ACCOUNTS_PATH;
  var ASSIGN_API = 'https://api.github.com/repos/' + REPO + '/contents/' + ASSIGN_PATH;
  var PATCH_API = 'https://api.github.com/repos/' + REPO + '/contents/' + PATCH_DIR;
  var CRED_KEY = 'rems_k';
  var LAST_PUSH_KEY = 'rems_last_push';
  var LAST_ACCT_KEY = 'rems_last_acct_push';
  var LAST_PATCH_KEY = 'rems_last_patch_push';

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

  function patchApi(agentId) {
    return PATCH_API + '/' + encodeURIComponent(agentId) + '.enc.json';
  }

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

  /** 중개사 로컬(임차인 작업)과 클라우드 배정본을 물건 단위로 병합 */
  function mergeAgentLocal(cloud, local) {
    if (!cloud) return local;
    if (!local || !local.properties || !local.properties.length) return cloud;
    var out = JSON.parse(JSON.stringify(cloud));
    var byId = {};
    (out.properties || []).forEach(function (p) { byId[p.id] = p; });
    var merged = 0;
    (local.properties || []).forEach(function (lp) {
      var cp = byId[lp.id];
      if (!cp) return;
      var lt = (lp.meta && lp.meta.updatedAt) || (local.meta && local.meta.updatedAt) || 0;
      var ct = (cp.meta && cp.meta.updatedAt) || (out.meta && out.meta.updatedAt) || 0;
      var lLease = lp.lease || null;
      var cLease = cp.lease || null;
      var localHas = !!(lLease && (lLease.tenantName || lLease.tenantPhone || lLease.start || lLease.end));
      var cloudHas = !!(cLease && (cLease.tenantName || cLease.tenantPhone || cLease.start || cLease.end));
      var localTenant = !!(lLease && (lLease.tenantName || lLease.tenantPhone));
      var cloudTenant = !!(cLease && (cLease.tenantName || cLease.tenantPhone));
      var takeLocal = (lt > ct) || (localTenant && !cloudTenant) || (localHas && !cloudHas && lt >= ct);
      if (!takeLocal) return;
      cp.lease = lLease;
      if (lp.memo != null && lp.memo !== '') cp.memo = lp.memo;
      cp.meta = Object.assign({}, cp.meta || {}, {
        updatedAt: Math.max(lt, ct, Date.now()),
        source: 'agent-local',
      });
      byId[lp.id] = cp;
      merged++;
    });
    out.properties = (out.properties || []).map(function (p) { return byId[p.id] || p; });
    out.meta = out.meta || {};
    out.meta.updatedAt = Math.max(out.meta.updatedAt || 0, (local.meta && local.meta.updatedAt) || 0, Date.now());
    out.settings = Object.assign({}, local.settings || {}, out.settings || {});
    out.__remsMergedLocal = merged;
    return out;
  }

  async function buildAccountEntries(data) {
    var accts = (data && data.accounts) || [];
    var ownerToken = (data.settings && data.settings.ghToken) || '';
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
          // 중개사가 임차인 변경을 서버에 올릴 수 있도록 쓰기 토큰 공유(암호문 내부)
          ghToken: ownerToken,
        },
        meta: { updatedAt: (data.meta && data.meta.updatedAt) || Date.now() },
      };
      entries.push(await REMSCrypto.encryptJSON(a.id, a.pw, subset));
    }
    return entries;
  }

  async function putJsonFile(apiUrl, obj, message) {
    var tk = token();
    if (!tk) throw new Error('GitHub 토큰이 등록되지 않았습니다. 관리자 클라우드 동기화에서 토큰을 저장해주세요.');
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

  function buildAgentPatch(data, agentId) {
    var now = Date.now();
    return {
      v: 1,
      agentId: agentId,
      updatedAt: (data.meta && data.meta.updatedAt) || now,
      properties: (data.properties || []).map(function (p) {
        return {
          id: p.id,
          lease: p.lease || null,
          memo: p.memo || '',
          meta: {
            updatedAt: (p.meta && p.meta.updatedAt) || (data.meta && data.meta.updatedAt) || now,
          },
        };
      }),
    };
  }

  /** 중개사: 임차인·계약 변경을 암호화해 patches/{id}.enc.json 에 업로드 */
  async function pushAgentPatch(data) {
    if (window.__REMS_ROLE__ !== 'agent') throw new Error('공인중개사 계정에서만 사용할 수 있습니다.');
    var c = creds();
    if (!c) throw new Error('세션에 로그인 정보가 없습니다. 재로그인해주세요.');
    if (!token()) throw new Error('서버 반영용 토큰이 없습니다. 관리자가 클라우드 동기화(업로드)를 한 번 실행해야 합니다.');
    var src = data || Store.data;
    var patch = buildAgentPatch(src, c.id);
    var entry = await REMSCrypto.encryptJSON(c.id, c.pw, patch);
    await putJsonFile(
      patchApi(c.id),
      entry,
      'sync: 중개사(' + c.id + ') 임차인·계약 반영 (' + new Date().toLocaleString('ko-KR') + ')'
    );
    try { localStorage.setItem(LAST_PATCH_KEY, String(Date.now())); } catch (e) {}
    updateTag();
    return patch;
  }

  async function pullAgentPatch(agentId, agentPw) {
    var res = await fetch(patchApi(agentId) + '?ref=' + BRANCH + '&_=' + Date.now(), {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var entry = JSON.parse(await res.text());
    var text = await REMSCrypto.decryptToText(agentId, agentPw, entry);
    return JSON.parse(text);
  }

  /** 소유자: 모든 중개사 패치를 마스터 데이터에 병합. 변경 건수 반환 */
  async function mergeAgentPatches(data) {
    if (window.__REMS_ROLE__ !== 'owner') throw new Error('소유자 계정에서만 병합할 수 있습니다.');
    var src = data || Store.data;
    var accts = src.accounts || [];
    var byId = {};
    (src.properties || []).forEach(function (p) { byId[p.id] = p; });
    var changed = 0;
    var details = [];
    for (var i = 0; i < accts.length; i++) {
      var a = accts[i];
      if (!a.id || !a.pw) continue;
      var patch = null;
      try { patch = await pullAgentPatch(a.id, a.pw); } catch (e) { continue; }
      if (!patch || !patch.properties) continue;
      (patch.properties || []).forEach(function (pp) {
        var op = byId[pp.id];
        if (!op) return;
        // 배정된 중개사 물건만 병합
        if (op.managerId && op.managerId !== a.id) return;
        var ot = (op.meta && op.meta.updatedAt) || 0;
        var pt = (pp.meta && pp.meta.updatedAt) || patch.updatedAt || 0;
        var oLease = op.lease || null;
        var pLease = pp.lease || null;
        var patchTenant = !!(pLease && (pLease.tenantName || pLease.tenantPhone));
        var ownerTenant = !!(oLease && (oLease.tenantName || oLease.tenantPhone));
        var take = (pt > ot) || (patchTenant && !ownerTenant);
        if (!take) return;
        var before = JSON.stringify(oLease || null);
        var after = JSON.stringify(pLease || null);
        if (before === after && (pp.memo || '') === (op.memo || '')) return;
        op.lease = pLease;
        if (pp.memo != null) op.memo = pp.memo;
        op.meta = Object.assign({}, op.meta || {}, {
          updatedAt: Math.max(ot, pt, Date.now()),
          source: a.id,
        });
        byId[pp.id] = op;
        changed++;
        details.push({ agentId: a.id, propId: pp.id, tenant: (pLease && pLease.tenantName) || '' });
      });
    }
    src.properties = (src.properties || []).map(function (p) { return byId[p.id] || p; });
    if (changed) {
      src.meta = src.meta || {};
      src.meta.updatedAt = Date.now();
    }
    return { changed: changed, details: details };
  }

  async function pushAccounts(data) {
    if (window.__REMS_ROLE__ !== 'owner') throw new Error('소유자 계정에서만 업로드할 수 있습니다.');
    var src = data || Store.data;
    var entries = await buildAccountEntries(src);
    await putJsonFile(ACCOUNTS_API, entries, 'sync: 중개사 배정 갱신 (' + new Date().toLocaleString('ko-KR') + ')');
    await putJsonFile(ASSIGN_API, buildAssignments(src), 'sync: 배정표 갱신 (' + new Date().toLocaleString('ko-KR') + ')');
    try { localStorage.setItem(LAST_ACCT_KEY, String(Date.now())); } catch (e) {}
  }

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

  var timer = null;
  function schedulePush() {
    updateTag();
    var role = window.__REMS_ROLE__;
    if (!creds()) return;
    if (role === 'owner') {
      if (!token()) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        push().catch(function () { updateTag('업로드 실패'); });
      }, 8000);
      return;
    }
    if (role === 'agent') {
      if (!token()) {
        updateTag('서버 반영 불가(관리자 동기화 필요)');
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(function () {
        pushAgentPatch(Store.data)
          .then(function () { updateTag('관리자 반영 완료'); })
          .catch(function (err) { updateTag('반영 실패'); console.warn(err); });
      }, 2500);
    }
  }

  function updateTag(errText) {
    var el = document.getElementById('syncTag');
    if (!el) return;
    var role = window.__REMS_ROLE__;
    if (errText) { el.textContent = '☁️ ' + errText; return; }
    if (role === 'agent') {
      if (!token()) { el.textContent = '☁️ 로컬만 저장(서버 반영 대기)'; return; }
      var last = Number(localStorage.getItem(LAST_PATCH_KEY) || 0);
      var cur = (Store.data && Store.data.meta && Store.data.meta.updatedAt) || 0;
      el.textContent = (last >= cur && last)
        ? '☁️ 관리자 반영됨 ' + new Date(last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        : '☁️ 관리자 반영 대기 중…';
      return;
    }
    if (role !== 'owner') { el.textContent = ''; return; }
    if (!token()) { el.textContent = '☁️ 동기화 미설정(중개사 배정 즉시반영 불가)'; return; }
    var lastP = Number(localStorage.getItem(LAST_PUSH_KEY) || 0);
    var curP = (Store.data && Store.data.meta && Store.data.meta.updatedAt) || 0;
    el.textContent = (lastP >= curP && lastP)
      ? '☁️ 동기화됨 ' + new Date(lastP).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '☁️ 업로드 대기 중…';
  }

  return {
    saveCreds: saveCreds, creds: creds, token: token,
    pullDecrypt: pullDecrypt, pullAccountsList: pullAccountsList,
    pullAssignments: pullAssignments, buildAssignments: buildAssignments,
    applyAssignmentFilter: applyAssignmentFilter, mergeAgentLocal: mergeAgentLocal,
    buildAccountEntries: buildAccountEntries, pushAccounts: pushAccounts,
    push: push, schedulePush: schedulePush, updateTag: updateTag,
    pushAgentPatch: pushAgentPatch, pullAgentPatch: pullAgentPatch,
    mergeAgentPatches: mergeAgentPatches, buildAgentPatch: buildAgentPatch,
  };
})();
