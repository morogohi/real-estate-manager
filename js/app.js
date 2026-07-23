/* =========================================================
 * app.js - 화면 렌더링 및 상호작용
 * ========================================================= */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

/* ---------- 공통 유틸 ---------- */

function fmt(n) {
  return n == null || isNaN(n) ? '-' : Number(n).toLocaleString('ko-KR');
}

function parseNum(str) {
  const n = Number(String(str).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function ddayOf(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function ddayBadge(dday) {
  if (dday == null) return '<span class="badge gray">계약없음</span>';
  if (dday < 0) return `<span class="badge red">경과 ${-dday}일</span>`;
  if (dday <= 60) return `<span class="badge red">D-${dday}</span>`;
  if (dday <= 180) return `<span class="badge amber">D-${dday}</span>`;
  return `<span class="badge green">D-${dday}</span>`;
}

function typeBadge(type) {
  const cls = { '아파트': 'blue', '오피스텔': 'purple', '빌라(다세대)': 'green', '오피스': 'amber', '토지': 'gray' }[type] || 'gray';
  return `<span class="badge ${cls}">${type}</span>`;
}

function propLabel(p) {
  const short = p.address.replace(/^(서울시?|서울특별시|경기도?|경기|충청남도)\s*/, '').split(' ').slice(0, 3).join(' ');
  return `${short} ${p.unit || ''}`.trim();
}

/* ---------- 공시가격 / 주택수 유틸 ---------- */

/** 연도별 공시가격 중 가장 최근 연도의 가격 (없으면 0) */
function latestOfficialPrice(p) {
  if (!Array.isArray(p.priceHistory) || !p.priceHistory.length) return 0;
  const sorted = [...p.priceHistory].sort((a, b) => Number(b.year) - Number(a.year));
  return Number(sorted[0].price) || 0;
}

/** 주택 유형 여부 (종부세·임대소득 합산 대상 판정용) */
function isHouseType(p) {
  return ['아파트', '오피스텔', '빌라(다세대)', '기타'].includes(p.type);
}

/** 등록임대주택(합산배제 대상) 여부 */
function isRegisteredRental(p) {
  return (p.rentalType || '').includes('주택임대사업자');
}

/* ---------- GIS: 지도 · 부동산 공부 외부 링크 ---------- */

function openExternal(url) {
  try {
    if (Store.isDesktop() && window.pywebview.api.open_external) {
      window.pywebview.api.open_external(url);
      return;
    }
  } catch (e) { /* 폴백 */ }
  window.open(url, '_blank');
}

function mapServices(address, unit) {
  const q = encodeURIComponent(`${address} ${unit || ''}`.trim());
  const addrOnly = encodeURIComponent(address);
  return [
    { label: '🗺️ 카카오맵', url: `https://map.kakao.com/?q=${q}` },
    { label: '🗺️ 네이버지도', url: `https://map.naver.com/p/search/${q}` },
    { label: '🏠 네이버부동산', url: `https://m.land.naver.com/search/result/${addrOnly}` },
    { label: '📐 공시가격알리미', url: `https://www.realtyprice.kr/notice/main/mainBody.htm` },
    { label: '📄 일사편리(부동산정보)', url: `https://kras.go.kr/` },
    { label: '🏛️ 정부24', url: `https://www.gov.kr/` },
    { label: '💸 위택스(지방세)', url: `https://www.wetax.go.kr/` },
    { label: '🧾 홈택스(국세)', url: `https://www.hometax.go.kr/` },
  ];
}

/* ---------- 관리자 화면 계정 전환 (view-as) ---------- */

const VIEW_AS_KEY = 'rems_view_as';

/** 현재 전환된 중개사 id ('' = 관리자 본인 화면) */
function currentViewAs() {
  if (window.__REMS_ROLE__ !== 'owner') return '';
  try { return sessionStorage.getItem(VIEW_AS_KEY) || ''; } catch (e) { return ''; }
}

/** 화면에 보여줄 물건 목록 (관리자가 중개사 화면으로 전환 시 배정 물건만) */
function visibleProps() {
  const va = currentViewAs();
  return va
    ? Store.data.properties.filter(p => p.managerId === va)
    : Store.data.properties;
}

/* ---------- 탭 전환 ---------- */

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach(t => t.classList.add('hidden'));
    $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
    document.querySelector('.sidebar')?.classList.remove('menu-open');
    window.scrollTo({ top: 0 });
  });
});

/* 모바일: 상단바 ☰ 로 유틸 메뉴(백업·계정관리 등) 토글 */
$('#btnMenuToggle')?.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('menu-open');
});

$$('.tax-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tax-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.taxpane').forEach(t => t.classList.add('hidden'));
    $(`#taxpane-${btn.dataset.taxtab}`).classList.remove('hidden');
  });
});

/* ---------- 숫자 입력 자동 콤마 ---------- */

document.addEventListener('input', e => {
  if (!e.target.classList || !e.target.classList.contains('num')) return;
  const raw = e.target.value.replace(/[^\d]/g, '');
  e.target.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
});

/* =========================================================
 * 대시보드
 * ========================================================= */

function renderDashboard() {
  const props = visibleProps();
  const todos = Store.data.todos.filter(t => !t.done);

  const byType = {};
  props.forEach(p => { byType[p.type] = (byType[p.type] || 0) + 1; });

  const leased = props.filter(p => p.lease);
  const expired = leased.filter(p => ddayOf(p.lease.end) < 0);
  const expiring = leased.filter(p => { const d = ddayOf(p.lease.end); return d >= 0 && d <= 90; });
  const noInsurance = leased.filter(p => !p.lease.insurance?.joined);
  const rentalBiz = props.filter(p => (p.rentalType || '').includes('주택임대사업자'));

  $('#dashCards').innerHTML = `
    <div class="card"><div class="label">총 보유 물건</div><div class="value">${props.length}건</div>
      <div class="sub">${Object.entries(byType).map(([t, c]) => `${t} ${c}`).join(' · ')}</div></div>
    <div class="card"><div class="label">주택임대사업자 등록</div><div class="value">${rentalBiz.length}건</div>
      <div class="sub">전체 ${props.length}건 중</div></div>
    <div class="card ${expired.length ? 'alert' : ''}"><div class="label">만기 경과 계약</div><div class="value">${expired.length}건</div>
      <div class="sub">갱신·재계약 확인 필요</div></div>
    <div class="card ${expiring.length ? 'warn' : ''}"><div class="label">90일 내 만기</div><div class="value">${expiring.length}건</div>
      <div class="sub">갱신 통지 기한 확인</div></div>
    <div class="card ${noInsurance.length ? 'warn' : ''}"><div class="label">보증보험 미가입</div><div class="value">${noInsurance.length}건</div>
      <div class="sub">임대차 계약 ${leased.length}건 중</div></div>
    <div class="card"><div class="label">미완료 할일</div><div class="value">${todos.length}건</div>
      <div class="sub">민원·신고 업무</div></div>`;

  // 만기 임박/경과
  const expList = [...expired, ...expiring]
    .sort((a, b) => ddayOf(a.lease.end) - ddayOf(b.lease.end))
    .slice(0, 10);
  $('#dashExpiring').innerHTML = expList.length
    ? expList.map(p => `
      <div class="list-item">
        <div><div class="title">${propLabel(p)}</div>
        <div class="sub">${p.owner} · 만기 ${p.lease.end}</div></div>
        ${ddayBadge(ddayOf(p.lease.end))}
      </div>`).join('')
    : '<div class="empty">만기 임박 계약이 없습니다.</div>';

  // 보증보험 미가입
  $('#dashInsurance').innerHTML = noInsurance.length
    ? noInsurance.slice(0, 10).map(p => `
      <div class="list-item">
        <div><div class="title">${propLabel(p)}</div>
        <div class="sub">${p.rentalType || '일반'} · 만기 ${p.lease.end}</div></div>
        <span class="badge red">미가입</span>
      </div>`).join('')
    : '<div class="empty">모든 임대차에 보증보험이 가입되어 있습니다.</div>';

  // 할일
  const dued = todos.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due));
  const rest = todos.filter(t => !t.due);
  $('#dashTodos').innerHTML = [...dued, ...rest].slice(0, 7).map(t => `
    <div class="list-item">
      <div><div class="title">${t.title}</div>${t.note ? `<div class="sub">${t.note}</div>` : ''}</div>
      ${t.due ? ddayBadge(ddayOf(t.due)) : '<span class="badge gray">기한없음</span>'}
    </div>`).join('') || '<div class="empty">미완료 할일이 없습니다.</div>';

  // 사업자 정보
  $('#dashBiz').innerHTML = Store.data.business.map(b => `
    <div class="list-item">
      <div><div class="title">${b.owner}</div>
      <div class="sub">${b.regNo} · 사업자번호 ${b.bizNo}</div></div>
    </div>`).join('');
}

/* =========================================================
 * 부동산 현황
 * ========================================================= */

function buildFilters() {
  const props = visibleProps();
  const fill = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML = sel.options[0].outerHTML +
      [...new Set(values)].filter(Boolean).map(v => `<option>${v}</option>`).join('');
    sel.value = cur;
  };
  fill($('#filterType'), props.map(p => p.type));
  fill($('#filterOwner'), props.map(p => p.owner));
  fill($('#filterRental'), props.map(p => p.rentalType));

  // 담당 중개사 필터 (관리자 전용)
  const fm = $('#filterManager');
  if (fm) {
    const cur = fm.value;
    fm.innerHTML = '<option value="">전체 중개사</option>' +
      (Store.data.accounts || []).map(a =>
        `<option value="${a.id}">${a.name || a.id}</option>`).join('') +
      '<option value="__none">미지정</option>';
    fm.value = cur;
  }
}

function managerOptionsHtml(selectedId) {
  const accts = Store.data.accounts || [];
  return '<option value="">— 미지정 —</option>' +
    accts.map(a =>
      `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.name || a.id}</option>`
    ).join('');
}

function setManager(propId, managerId, { silent } = {}) {
  const p = Store.data.properties.find(x => x.id === Number(propId));
  if (!p) return false;
  const next = managerId || '';
  if (p.managerId === next) return false;
  p.managerId = next;
  Store.save();
  // 중개사 로그인용 배정 암호문을 즉시 클라우드에 반영 (토큰 있을 때)
  if (window.REMSSync && REMSSync.token && REMSSync.token()) {
    clearTimeout(window.__remsAcctTimer);
    window.__remsAcctTimer = setTimeout(() => {
      REMSSync.pushAccounts(Store.data)
        .then(() => {
          const el = $('#mgrBulkMsg');
          if (el) el.textContent = (el.textContent.split('·')[0] || '').trim() + ' ✓ 중개사·대시보드 배정 클라우드 반영됨 (중개사는 재로그인)';
        })
        .catch(err => {
          const el = $('#mgrBulkMsg');
          if (el) el.textContent = `배정 저장됨 · 클라우드 반영 실패: ${err.message}`;
        });
    }, 1500);
  } else if (!silent) {
    // 토큰 없으면 중개사 계정에 반영되지 않음 → 설정 모달 안내
    setTimeout(() => {
      alert('배정은 관리자 화면에만 저장되었습니다.\n\n중개사 로그인·대시보드에 바로 반영하려면:\n① ☁️ 클라우드 동기화에서 GitHub 토큰을 저장하고\n② 「지금 업로드」를 눌러주세요.\n\n(토큰이 없으면 해제한 물건이 중개사 계정에 계속 보일 수 있습니다.)');
      $('#btnSync')?.click();
    }, 100);
  }
  if (!silent) {
    const msg = next
      ? `'${propLabel(p)}' → ${managerName(next)} 지정`
      : `'${propLabel(p)}' 배정 해제`;
    const tip = REMSSync.token && REMSSync.token()
      ? ' · 클라우드 배정 반영 중…'
      : ' · ⚠️ 동기화 토큰 없으면 중개사 로그인에 즉시 반영 안 됨(☁️ 클라우드 동기화에서 토큰 등록)';
    const el = $('#mgrBulkMsg');
    if (el) el.textContent = msg + tip;
  }
  return true;
}

function renderProperties() {
  buildFilters();
  const ft = $('#filterType').value, fo = $('#filterOwner').value,
        fr = $('#filterRental').value, fs = $('#filterSearch').value.trim(),
        fm = $('#filterManager') ? $('#filterManager').value : '';

  // 일괄 배정용 중개사 목록
  const bm = $('#bulkManager');
  if (bm) {
    const cur = bm.value;
    bm.innerHTML = '<option value="">— 중개사 선택 —</option>' +
      (Store.data.accounts || []).map(a =>
        `<option value="${a.id}">${a.name || a.id}</option>`).join('');
    bm.value = cur;
  }

  const rows = visibleProps().filter(p =>
    (!ft || p.type === ft) &&
    (!fo || p.owner === fo) &&
    (!fr || p.rentalType === fr) &&
    (!fm || (fm === '__none' ? !p.managerId : p.managerId === fm)) &&
    (!fs || (p.address + ' ' + p.unit).includes(fs))
  );

  const isOwner = window.__REMS_ROLE__ === 'owner' && !currentViewAs();
  $('#propTable tbody').innerHTML = rows.map(p => `
    <tr data-propid="${p.id}">
      <td class="owner-only"><input type="checkbox" class="mgr-check" data-id="${p.id}"></td>
      <td>${p.id}</td>
      <td>${p.owner}</td>
      <td>${typeBadge(p.type)}</td>
      <td>${p.rentalType || '-'}</td>
      <td>${p.acquireYear ? p.acquireYear + '년' : '-'}</td>
      <td class="addr">${p.address}<span class="map-mini" data-mapid="${p.id}">지도</span></td>
      <td>${p.unit || '-'}</td>
      <td class="owner-only">${isOwner
        ? `<select class="mgr-pick" data-mgr="${p.id}" title="중개사 지정 또는 미지정으로 해제">${managerOptionsHtml(p.managerId)}</select>`
        : (managerName(p.managerId) || '<span class="muted-sm">미지정</span>')}</td>
      <td>${p.lease ? p.lease.end : '-'}</td>
      <td>${ddayBadge(p.lease ? ddayOf(p.lease.end) : null)}</td>
      <td><button class="link-btn" onclick="openModal(${p.id})">상세</button></td>
    </tr>`).join('') ||
    '<tr><td colspan="12" class="empty">조건에 맞는 물건이 없습니다.</td></tr>';

  const all = $('#mgrSelectAll');
  if (all) all.checked = false;
}

// 목록: 지도 링크 / 중개사 지정·해제
$('#propTable').addEventListener('click', e => {
  const id = e.target.dataset.mapid;
  if (id == null) return;
  const p = Store.data.properties.find(x => x.id === Number(id));
  if (p) openExternal(mapServices(p.address, p.unit)[0].url);
});
$('#propTable').addEventListener('change', e => {
  const pick = e.target.closest('.mgr-pick');
  if (pick) {
    setManager(pick.dataset.mgr, pick.value);
    // 필터가 '특정 중개사'면 목록 갱신으로 빠져 나간 행 반영
    if ($('#filterManager')?.value) renderProperties();
    return;
  }
});

$('#mgrSelectAll')?.addEventListener('change', e => {
  $$('#propTable .mgr-check').forEach(c => { c.checked = e.target.checked; });
});

function selectedPropIds() {
  return $$('#propTable .mgr-check:checked').map(c => Number(c.dataset.id));
}

$('#btnBulkAssign')?.addEventListener('click', () => {
  const ids = selectedPropIds();
  const mid = $('#bulkManager').value;
  if (!ids.length) { alert('지정할 물건을 목록에서 선택해주세요.'); return; }
  if (!mid) { alert('지정할 중개사를 선택해주세요.'); return; }
  if (!confirm(`선택 ${ids.length}건을 '${managerName(mid)}'에게 지정할까요?`)) return;
  ids.forEach(id => setManager(id, mid, { silent: true }));
  $('#mgrBulkMsg').textContent =
    `${ids.length}건 → ${managerName(mid)} 지정 완료` +
    (REMSSync.token && REMSSync.token() ? ' · 클라우드 배정 자동 반영 예정' : ' · ⚠️ 동기화 토큰 등록 필요');
  renderProperties();
});

$('#btnBulkUnassign')?.addEventListener('click', () => {
  const ids = selectedPropIds();
  if (!ids.length) { alert('배정을 해제할 물건을 선택해주세요.'); return; }
  if (!confirm(`선택 ${ids.length}건의 중개사 배정을 해제할까요?`)) return;
  ids.forEach(id => setManager(id, '', { silent: true }));
  $('#mgrBulkMsg').textContent =
    `${ids.length}건 배정 해제 완료` +
    (REMSSync.token && REMSSync.token() ? ' · 클라우드 배정 자동 반영 예정' : ' · ⚠️ 동기화 토큰 등록 필요');
  renderProperties();
});

['filterType', 'filterOwner', 'filterRental', 'filterManager'].forEach(id =>
  $(`#${id}`).addEventListener('change', renderProperties));
$('#filterSearch').addEventListener('input', renderProperties);

/* ---------- 물건 모달 ---------- */

let modalPriceHistory = [];   // 모달 편집 중인 연도별 공시가격
let modalMapAddr = '';
let modalMapUnit = '';

function renderModalPrices() {
  const sorted = [...modalPriceHistory].sort((a, b) => Number(b.year) - Number(a.year));
  $('#mPriceTable tbody').innerHTML = sorted.length
    ? sorted.map(r => `
      <tr>
        <td>${r.year}년</td>
        <td style="text-align:right">${fmt(r.price)}원</td>
        <td><button type="button" class="link-btn" data-delyear="${r.year}">삭제</button></td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="empty">등록된 공시가격이 없습니다.</td></tr>';
}

/** 카카오맵 SDK 로드 실패 시 원인별 안내 (403=키 오류/서비스 미활성, 401=도메인 미등록) */
function kakaoFailGuide() {
  const origin = location.origin;
  return `
    <div style="padding:16px 18px; font-size:13px; line-height:1.7">
      <b style="color:var(--danger)">카카오맵을 불러오지 못했습니다.</b><br>
      대부분 <b>카카오 개발자센터에 이 사이트 도메인이 등록되지 않아서</b> 발생합니다. 아래 순서로 확인해주세요.<br><br>
      ① <a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener">카카오 개발자센터</a> → 내 애플리케이션 → 해당 앱 선택<br>
      ② <b>앱 설정 → 플랫폼 → Web</b> 에 사이트 도메인 <code>${origin}</code> 을(를) 추가<br>
      ③ <b>제품 설정 → 카카오맵</b> 에서 사용 설정 <b>ON</b> 확인<br>
      ④ 키는 REST API 키가 아닌 <b>JavaScript 키</b>인지 확인<br><br>
      등록 후 아래 버튼으로 다시 시도하세요.
      <div style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="btnKakaoRetry">🔄 지도 다시 불러오기</button></div>
    </div>`;
}

function renderKakaoPreview(addr) {
  const box = $('#mMapBox');
  const key = Store.data.settings?.kakaoKey;
  if (!key || !addr) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  const draw = () => {
    // autoload=false 방식에서는 services 모듈이 kakao.maps.load() 이후에 생성됨
    if (!(window.kakao && window.kakao.maps && typeof window.kakao.maps.load === 'function')) {
      box.innerHTML = kakaoFailGuide();
      return;
    }
    kakao.maps.load(() => {
      if (!kakao.maps.services) { box.innerHTML = kakaoFailGuide(); return; }
      const map = new kakao.maps.Map(box, { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 3 });
      const geocoder = new kakao.maps.services.Geocoder();
      const place = new kakao.maps.services.Places();
      const setMarker = (lat, lng) => {
        const pos = new kakao.maps.LatLng(lat, lng);
        new kakao.maps.Marker({ map, position: pos });
        map.setCenter(pos);
      };
      geocoder.addressSearch(addr, (res, status) => {
        if (status === kakao.maps.services.Status.OK && res[0]) {
          setMarker(res[0].y, res[0].x);
        } else {
          place.keywordSearch(addr, (r2, s2) => {
            if (s2 === kakao.maps.services.Status.OK && r2[0]) setMarker(r2[0].y, r2[0].x);
          });
        }
      });
    });
  };
  if (window.kakao && window.kakao.maps) { draw(); return; }
  const sc = document.createElement('script');
  sc.id = 'kakaoSdk';
  sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
  sc.onload = draw;
  sc.onerror = () => { box.innerHTML = kakaoFailGuide(); };
  document.head.appendChild(sc);
}

// 지도 재시도: 실패한 SDK 스크립트를 제거하고 다시 로드
$('#mMapBox').addEventListener('click', e => {
  if (e.target.id !== 'btnKakaoRetry') return;
  document.getElementById('kakaoSdk')?.remove();
  renderKakaoPreview(modalMapAddr);
});

// 모달 내 동적 버튼 처리 (지도칩 / 공시가격 삭제)
$('#mMapLinks').addEventListener('click', e => {
  const idx = e.target.dataset.mapidx;
  if (idx == null) return;
  openExternal(mapServices(modalMapAddr, modalMapUnit)[Number(idx)].url);
});
$('#mPriceTable').addEventListener('click', e => {
  const y = e.target.dataset.delyear;
  if (y == null) return;
  modalPriceHistory = modalPriceHistory.filter(r => String(r.year) !== String(y));
  renderModalPrices();
});
$('#btnAddPrice').addEventListener('click', () => {
  const year = parseInt($('#mPriceYear').value, 10);
  const price = parseNum($('#mPriceVal').value);
  if (!year || !price) { alert('연도와 공시가격을 입력해주세요.'); return; }
  modalPriceHistory = modalPriceHistory.filter(r => Number(r.year) !== year);
  modalPriceHistory.push({ year, price });
  renderModalPrices();
  $('#mPriceYear').value = ''; $('#mPriceVal').value = '';
});
$('#btnOpenRealtyPrice').addEventListener('click', () =>
  openExternal('https://www.realtyprice.kr/notice/main/mainBody.htm'));
$('#btnSaveKakao').addEventListener('click', () => {
  Store.data.settings.kakaoKey = $('#mKakaoKey').value.trim();
  Store.save();
  renderKakaoPreview(modalMapAddr);
  alert('카카오맵 키를 저장했습니다.');
});

function syncInsFields() {
  const joined = $('#mInsStatus')?.value === 'yes';
  const box = $('#mLeaseFields');
  if (!box) return;
  box.classList.toggle('ins-joined', joined);
  box.classList.toggle('ins-not', !joined);
}

function fmtBytes(n) {
  if (n < 1024) return n + 'B';
  if (n < 1048576) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1048576).toFixed(1) + 'MB';
}

async function renderModalFiles(propId) {
  const list = $('#mFileList');
  if (!list) return;
  if (!propId || !window.REMSDB) {
    list.innerHTML = '<div class="empty">저장 후 서류를 첨부할 수 있습니다.</div>';
    return;
  }
  const files = await REMSDB.listFiles(propId);
  list.innerHTML = files.length
    ? files.map(f => `
      <div class="file-row">
        <div class="grow" title="${f.name}">📄 ${f.name} <span class="muted-sm">(${fmtBytes(f.size)})</span></div>
        <button type="button" class="link-btn" data-dlfile="${f.id}">열기</button>
        <button type="button" class="link-btn" data-delfile="${f.id}" style="color:var(--danger)">삭제</button>
      </div>`).join('')
    : '<div class="empty">첨부된 서류가 없습니다.</div>';
}

function openModal(id) {
  try {
    const p = id ? Store.data.properties.find(x => x.id === id) : null;
    $('#modalTitle').textContent = p ? `물건 #${p.id} 상세` : '새 물건 추가';
    $('#mId').value = p ? p.id : '';
    $('#mOwner').value = p?.owner || '';
    $('#mType').value = p?.type || '오피스텔';
    $('#mRentalType').value = p?.rentalType || '';
    $('#mAcquireYear').value = p?.acquireYear || '';
    $('#mRegDate').value = p?.regDate || '';
    $('#mAddress').value = p?.address || '';
    $('#mUnit').value = p?.unit || '';
    $('#mMemo').value = p?.memo || '';
    $('#mAcquireDate').value = p?.acquireDate || '';
    $('#mAcquirePrice').value = p?.acquirePrice ? fmt(p.acquirePrice) : '';

    // 관리 공인중개사 선택지
    if ($('#mManager')) {
      $('#mManager').innerHTML = '<option value="">— 미지정 (배정 해제) —</option>' +
        (Store.data.accounts || []).map(a =>
          `<option value="${a.id}">${a.name ? `${a.name} (${a.id})` : a.id}</option>`).join('');
      $('#mManager').value = p?.managerId || '';
    }

    // 연도별 공시가격
    modalPriceHistory = p ? (p.priceHistory || []).map(x => ({ ...x })) : [];
    renderModalPrices();

    // 지도/공부 링크
    const addr = p?.address || '';
    $('#mMapLinks').innerHTML = addr
      ? mapServices(addr, p?.unit).map((s, i) =>
          `<button type="button" class="map-chip" data-mapidx="${i}">${s.label}</button>`).join('')
      : '<span class="hint">주소를 입력하고 저장하면 지도·공부 링크가 활성화됩니다.</span>';
    modalMapAddr = addr; modalMapUnit = p?.unit || '';

    // 카카오 지도 미리보기
    if ($('#mKakaoKey')) $('#mKakaoKey').value = Store.data.settings?.kakaoKey || '';
    renderKakaoPreview(addr);

    const l = p?.lease;
    const ins = l?.insurance || {};
    $('#mHasLease').checked = !!l;
    $('#mLeaseFields').style.display = l ? '' : 'none';
    $('#mLeaseStart').value = l?.start || '';
    $('#mLeaseEnd').value = l?.end || '';
    $('#mDeposit').value = l?.deposit ? fmt(l.deposit) : '';
    $('#mMonthly').value = l?.monthlyRent ? fmt(l.monthlyRent) : '';
    $('#mTenant').value = l?.tenantName || '';
    $('#mTenantPhone').value = l?.tenantPhone || '';

    // 보증보험 (가입/미가입)
    if ($('#mInsStatus')) $('#mInsStatus').value = ins.joined ? 'yes' : 'no';
    if ($('#mInsCoverage')) $('#mInsCoverage').value = ins.coverage || 'full';
    if ($('#mInsCompany')) $('#mInsCompany').value = ins.company || '';
    if ($('#mInsPeriod')) $('#mInsPeriod').value = ins.period || '';
    if ($('#mInsFee')) $('#mInsFee').value = ins.fee ? fmt(ins.fee) : '';
    if ($('#mInsTenantShare')) $('#mInsTenantShare').value = ins.tenantShare ? fmt(ins.tenantShare) : '';
    if ($('#mInsReason')) $('#mInsReason').value = ins.reason || '';
    if ($('#mInsNote')) $('#mInsNote').value = ins.note || '';
    syncInsFields();

    renderModalFiles(p?.id);

    $('#btnModalDelete').classList.toggle('hidden', !p);
    $('#modalBg').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert('상세 화면을 여는 중 오류가 발생했습니다: ' + (err.message || err));
  }
}
window.openModal = openModal;

$('#mHasLease').addEventListener('change', e => {
  $('#mLeaseFields').style.display = e.target.checked ? '' : 'none';
});
$('#mInsStatus')?.addEventListener('change', syncInsFields);

$('#mFileInput')?.addEventListener('change', async e => {
  const propId = Number($('#mId').value);
  if (!propId) { alert('먼저 물건을 저장한 뒤 서류를 첨부해주세요.'); e.target.value = ''; return; }
  const files = [...(e.target.files || [])];
  for (const f of files) {
    if (f.size > 8 * 1024 * 1024) { alert(`${f.name}: 8MB 이하만 첨부 가능합니다.`); continue; }
    await REMSDB.addFile(propId, f);
  }
  e.target.value = '';
  renderModalFiles(propId);
});
$('#mFileList')?.addEventListener('click', async e => {
  const dl = e.target.dataset.dlfile;
  const del = e.target.dataset.delfile;
  if (dl) {
    const rec = await REMSDB.getFile(dl);
    if (!rec?.blob) return;
    const url = URL.createObjectURL(rec.blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  if (del) {
    if (!confirm('이 서류를 삭제할까요?')) return;
    await REMSDB.deleteFile(del);
    renderModalFiles(Number($('#mId').value));
  }
});

$('#btnModalCancel').addEventListener('click', () => $('#modalBg').classList.add('hidden'));
$('#modalBg').addEventListener('click', e => {
  if (e.target === $('#modalBg')) $('#modalBg').classList.add('hidden');
});

$('#btnModalSave').addEventListener('click', () => {
  try {
    if (!window.Store || !Store.data || !Store.data.properties) {
      alert('데이터가 아직 로드되지 않았습니다. 새로고침 후 다시 시도해주세요.');
      return;
    }
    const id = $('#mId').value ? Number($('#mId').value) : null;
    const hasLease = !!$('#mHasLease')?.checked;
    // 구버전(checkbox#mInsJoined) / 신버전(select#mInsStatus) 모두 호환
    const joined = $('#mInsStatus')
      ? $('#mInsStatus').value === 'yes'
      : !!$('#mInsJoined')?.checked;
    const lease = hasLease ? {
      start: $('#mLeaseStart')?.value || '',
      end: $('#mLeaseEnd')?.value || '',
      deposit: parseNum($('#mDeposit')?.value),
      monthlyRent: parseNum($('#mMonthly')?.value),
      tenantName: ($('#mTenant')?.value || '').trim(),
      tenantPhone: ($('#mTenantPhone')?.value || '').trim(),
      insurance: {
        joined,
        coverage: joined ? ($('#mInsCoverage')?.value || 'full') : '',
        company: joined ? ($('#mInsCompany')?.value || '') : '',
        period: joined ? (($('#mInsPeriod')?.value || '').trim()) : '',
        fee: joined ? parseNum($('#mInsFee')?.value) : 0,
        tenantShare: joined ? parseNum($('#mInsTenantShare')?.value) : 0,
        reason: joined ? '' : ($('#mInsReason')?.value || ''),
        note: (($('#mInsNote')?.value || '').trim()),
      },
    } : null;

    const prev = id ? Store.data.properties.find(x => x.id === id) : null;
    const obj = {
      owner: ($('#mOwner')?.value || '').trim(),
      type: $('#mType')?.value || '오피스텔',
      rentalType: ($('#mRentalType')?.value || '').trim(),
      acquireYear: ($('#mAcquireYear')?.value || '').trim(),
      acquireDate: $('#mAcquireDate')?.value || '',
      acquirePrice: parseNum($('#mAcquirePrice')?.value),
      regDate: $('#mRegDate')?.value || '',
      address: ($('#mAddress')?.value || '').trim(),
      unit: ($('#mUnit')?.value || '').trim(),
      memo: ($('#mMemo')?.value || '').trim(),
      // 중개사·미리보기에서는 관리자 셀렉트가 숨겨져 있으므로 기존 배정 유지
      managerId: $('#mManager')
        ? ($('#mManager').value || '')
        : (prev?.managerId || ''),
      priceHistory: (modalPriceHistory || []).map(r => ({ year: Number(r.year), price: Number(r.price) })),
      lease,
    };

    if (!obj.address) { alert('주소를 입력해주세요.'); return; }

    if (id) {
      const idx = Store.data.properties.findIndex(x => x.id === id);
      if (idx < 0) { alert('해당 물건을 찾을 수 없습니다.'); return; }
      Store.data.properties[idx] = { ...Store.data.properties[idx], ...obj };
    } else {
      if (window.__REMS_ROLE__ === 'agent') {
        alert('공인중개사 계정에서는 새 물건을 추가할 수 없습니다. 기존 물건의 임차인·계약 정보만 수정할 수 있습니다.');
        return;
      }
      obj.id = Store.nextId(Store.data.properties);
      obj.rentStartDate = '';
      Store.data.properties.push(obj);
    }
    Store.save();
    $('#modalBg').classList.add('hidden');
    renderAll();
  } catch (err) {
    console.error(err);
    alert('저장 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  }
});

$('#btnModalDelete').addEventListener('click', () => {
  const id = Number($('#mId').value);
  if (!confirm('이 물건을 삭제하시겠습니까?')) return;
  Store.data.properties = Store.data.properties.filter(x => x.id !== id);
  Store.save();
  $('#modalBg').classList.add('hidden');
  renderAll();
});

$('#btnAddProp').addEventListener('click', () => openModal(null));

/* =========================================================
 * 임대차 관리
 * ========================================================= */

function renderLeases() {
  const rows = visibleProps()
    .filter(p => p.lease)
    .sort((a, b) => (ddayOf(a.lease.end) ?? 99999) - (ddayOf(b.lease.end) ?? 99999));

  $('#leaseTable tbody').innerHTML = rows.map(p => {
    const l = p.lease;
    const ins = l.insurance?.joined
      ? `<span class="badge green">가입</span>${l.insurance.period ? `<div class="sub">${l.insurance.period}</div>` : ''}`
      : '<span class="badge red">미가입</span>';
    return `
    <tr>
      <td class="addr"><b>${propLabel(p)}</b><div class="sub" style="color:var(--muted);font-size:12px">${p.owner} · ${p.rentalType || '일반'}</div></td>
      <td>${l.tenantName || '-'}</td>
      <td>${l.tenantPhone || '-'}</td>
      <td>${l.start || '?'} ~ ${l.end || '?'}</td>
      <td>${ddayBadge(ddayOf(l.end))}</td>
      <td style="text-align:right">${l.deposit ? fmt(l.deposit) : '-'}</td>
      <td style="text-align:right">${l.monthlyRent ? fmt(l.monthlyRent) : '-'}</td>
      <td>${ins}</td>
      <td><button class="link-btn" onclick="openModal(${p.id})">상세</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">임대차 계약이 없습니다.</td></tr>';
}

/* ---- 5% 증액 계산 ---- */

$('#btnIncCalc').addEventListener('click', () => {
  const dep = parseNum($('#incDeposit').value);
  const mon = parseNum($('#incMonthly').value);
  const rate = Number($('#incRate').value) || 5;
  if (!dep && !mon) { $('#incResult').innerHTML = '<div class="result-box">보증금 또는 월세를 입력해주세요.</div>'; return; }
  const r = Tax.rentIncrease(dep, mon, rate);
  $('#incResult').innerHTML = `
    <div class="result-box">
      <div class="row"><span>증액 후 보증금 상한</span><b>${fmt(Math.floor(r.maxDeposit))}원 (+${fmt(Math.floor(r.addDeposit))}원)</b></div>
      <div class="row"><span>증액 후 월세 상한</span><b>${fmt(Math.floor(r.maxMonthly))}원 (+${fmt(Math.floor(r.addMonthly))}원)</b></div>
      <div class="note">등록임대주택은 임대료 증액이 직전 임대료의 5% 이내로 제한되며, 증액 후 1년 이내 재증액할 수 없습니다.</div>
    </div>`;
});

/* =========================================================
 * 세금 계산기
 * ========================================================= */

$('#btnAcqCalc').addEventListener('click', () => {
  const price = parseNum($('#acqPrice').value);
  if (!price) { alert('취득가액을 입력해주세요.'); return; }
  const r = Tax.acquisition({
    kind: $('#acqKind').value,
    cause: $('#acqCause').value,
    price,
    houseCount: Number($('#acqHouseCount').value),
    adjusted: $('#acqAdjusted').checked,
    over85: $('#acqOver85').checked,
  });
  $('#acqResult').innerHTML = `
    <div class="result-box">
      <div class="row"><span>적용 세율</span><b>${r.rate.toFixed(2)}%</b></div>
      <div class="row"><span>취득세</span><span>${Tax.won(r.acqTax)}</span></div>
      <div class="row"><span>지방교육세</span><span>${Tax.won(r.eduTax)}</span></div>
      <div class="row"><span>농어촌특별세</span><span>${Tax.won(r.ruralTax)}</span></div>
      <div class="row total"><span>총 납부 예상액</span><span>${Tax.won(r.total)}</span></div>
      <div class="note">${r.note}</div>
    </div>`;
});

$('#btnHoldCalc').addEventListener('click', () => {
  const price = parseNum($('#holdPrice').value);
  if (!price) { alert('공시가격을 입력해주세요.'); return; }
  const r = Tax.propertyTax(price, $('#holdOneSpecial').checked);
  $('#holdResult').innerHTML = `
    <div class="result-box">
      <div class="row"><span>과세표준 (공정시장가액비율 ${(r.ratio * 100).toFixed(0)}%)</span><span>${Tax.won(r.base)}</span></div>
      <div class="row"><span>재산세</span><span>${Tax.won(r.tax)}</span></div>
      <div class="row"><span>도시지역분 (0.14%)</span><span>${Tax.won(r.urbanTax)}</span></div>
      <div class="row"><span>지방교육세 (재산세의 20%)</span><span>${Tax.won(r.eduTax)}</span></div>
      <div class="row total"><span>연간 재산세 합계</span><span>${Tax.won(r.total)}</span></div>
      <div class="note">7월·9월에 1/2씩 분납. 세부담 상한 등으로 실제 고지액과 차이가 있을 수 있습니다.</div>
    </div>`;
});

/* ---- 보유 물건 → 보유세 자동 채우기 ---- */

function populatePropPickers() {
  const opts = visibleProps()
    .filter(p => isHouseType(p))
    .map(p => `<option value="${p.id}">${propLabel(p)} (${p.owner})</option>`).join('');
  ['holdPropPick', 'trPropPick'].forEach(id => {
    const sel = $(`#${id}`);
    if (sel) sel.innerHTML = '<option value="">— 직접 입력 —</option>' + opts;
  });
  // 임대소득 소유자 필터
  const owners = [...new Set(visibleProps().map(p => p.owner))].filter(Boolean);
  const isel = $('#incomeOwner');
  if (isel) {
    const cur = isel.value;
    isel.innerHTML = '<option value="">전체 소유자</option>' + owners.map(o => `<option>${o}</option>`).join('');
    isel.value = cur;
  }
}

$('#holdPropPick').addEventListener('change', e => {
  const p = Store.data.properties.find(x => x.id === Number(e.target.value));
  if (!p) return;
  const price = latestOfficialPrice(p);
  if (!price) { alert('이 물건에 등록된 공시가격이 없습니다. 물건 상세에서 연도별 공시가격을 입력해주세요.'); return; }
  $('#holdPrice').value = fmt(price);
});

$('#trPropPick').addEventListener('change', e => {
  const p = Store.data.properties.find(x => x.id === Number(e.target.value));
  if (!p) return;
  if (p.acquirePrice) $('#trBuy').value = fmt(p.acquirePrice);
  if (p.acquireDate) $('#trBuyDate').value = p.acquireDate;
  $('#trIsHouse').checked = isHouseType(p);
});

/* ---- 종부세 인별 자동 합산 ---- */

$('#btnJbAuto').addEventListener('click', () => {
  const houses = visibleProps().filter(p => isHouseType(p));
  const byOwner = {};
  houses.forEach(p => {
    const owner = p.owner || '미지정';
    if (!byOwner[owner]) byOwner[owner] = { total: 0, excluded: 0, count: 0, noPrice: 0 };
    const price = latestOfficialPrice(p);
    if (!price) byOwner[owner].noPrice++;
    byOwner[owner].total += price;
    byOwner[owner].count++;
    if (isRegisteredRental(p)) byOwner[owner].excluded += price;
  });

  const blocks = Object.entries(byOwner).map(([owner, v]) => {
    const isOne = v.count === 1;
    const r = Tax.jongbuTax(v.total, isOne, v.count, v.excluded);
    return `
      <div class="result-box" style="margin-bottom:10px">
        <div class="row"><b>${owner}</b><span>${v.count}채 / 공시합계 ${Tax.won(v.total)}</span></div>
        <div class="row"><span>합산배제(등록임대)</span><span>- ${Tax.won(v.excluded)}</span></div>
        <div class="row"><span>과세대상 공시가격</span><span>${Tax.won(r.taxableSum)}</span></div>
        <div class="row"><span>기본공제</span><span>${Tax.won(r.deduction)}</span></div>
        <div class="row total"><span>종부세 + 농특세 예상</span><span>${Tax.won(r.total)}</span></div>
        ${v.noPrice ? `<div class="note">⚠️ 공시가격 미입력 물건 ${v.noPrice}건은 0원으로 계산됨 (물건 상세에서 입력 필요)</div>` : ''}
      </div>`;
  }).join('');

  $('#jbAutoResult').innerHTML = blocks ||
    '<div class="result-box">합산할 주택 물건이 없습니다.</div>';
});

$('#btnJbCalc').addEventListener('click', () => {
  const sum = parseNum($('#jbSum').value);
  if (!sum) { alert('공시가격 합계를 입력해주세요.'); return; }
  const r = Tax.jongbuTax(sum, $('#jbOneHouse').checked, Number($('#jbCount').value), parseNum($('#jbExcluded').value));
  $('#jbResult').innerHTML = `
    <div class="result-box">
      <div class="row"><span>과세대상 공시가격 (합산배제 제외 후)</span><span>${Tax.won(r.taxableSum)}</span></div>
      <div class="row"><span>기본공제</span><span>${Tax.won(r.deduction)}</span></div>
      <div class="row"><span>과세표준 (공정시장가액비율 60%)</span><span>${Tax.won(r.base)}</span></div>
      <div class="row"><span>종합부동산세</span><span>${Tax.won(r.tax)}</span></div>
      <div class="row"><span>농어촌특별세 (20%)</span><span>${Tax.won(r.ruralTax)}</span></div>
      <div class="row total"><span>총 납부 예상액</span><span>${Tax.won(r.total)}</span></div>
      <div class="note">재산세 중복분 공제·세부담 상한 미반영 개략 계산입니다. ${r.base === 0 ? '과세표준이 0이므로 종부세가 없습니다.' : ''}</div>
    </div>`;
});

$('#btnTrCalc').addEventListener('click', () => {
  const sale = parseNum($('#trSale').value);
  const buy = parseNum($('#trBuy').value);
  if (!sale || !buy) { alert('양도가액과 취득가액을 입력해주세요.'); return; }
  if (!$('#trBuyDate').value || !$('#trSaleDate').value) { alert('취득일과 양도일을 입력해주세요.'); return; }
  const r = Tax.transfer({
    salePrice: sale,
    buyPrice: buy,
    expense: parseNum($('#trExp').value),
    buyDate: $('#trBuyDate').value,
    saleDate: $('#trSaleDate').value,
    isHouse: $('#trIsHouse').checked,
    oneHouseExempt: $('#trOneExempt').checked,
    residenceYears: Number($('#trResYears').value) || 0,
    heavySurcharge: Number($('#trHeavy').value),
  });
  $('#trResult').innerHTML = `
    <div class="result-box">
      <div class="row"><span>보유기간</span><b>${r.holdYears}년</b></div>
      <div class="row"><span>양도차익${$('#trOneExempt').checked && sale > 1_200_000_000 ? ' (12억 초과분 안분 후)' : ''}</span><span>${Tax.won(Math.max(0, r.gain))}</span></div>
      ${r.ltDeduct ? `<div class="row"><span>장기보유특별공제 (${(r.ltDeductRate * 100).toFixed(0)}%)</span><span>- ${Tax.won(r.ltDeduct)}</span></div>` : ''}
      <div class="row"><span>과세표준 (기본공제 250만원 차감)</span><span>${Tax.won(r.taxable)}</span></div>
      <div class="row"><span>양도소득세</span><span>${Tax.won(r.tax)}</span></div>
      <div class="row"><span>지방소득세 (10%)</span><span>${Tax.won(r.localTax)}</span></div>
      <div class="row total"><span>총 납부 예상액</span><span>${Tax.won(r.total)}</span></div>
      <div class="note">${r.note}</div>
    </div>`;
});

/* =========================================================
 * 할일 / 민원
 * ========================================================= */

function renderTodos() {
  const todos = [...Store.data.todos].sort((a, b) =>
    (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));

  $('#todoList').innerHTML = todos.map(t => `
    <div class="todo-item ${t.done ? 'done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTodo(${t.id})">
      <div class="body">
        <div class="title">${t.title}</div>
        ${t.note ? `<div class="sub" style="color:var(--muted);font-size:12px">${t.note}</div>` : ''}
      </div>
      ${t.due ? ddayBadge(ddayOf(t.due)) : ''}
      <button class="del" onclick="deleteTodo(${t.id})" title="삭제">✕</button>
    </div>`).join('') || '<div class="empty">등록된 할일이 없습니다.</div>';
}

function toggleTodo(id) {
  const t = Store.data.todos.find(x => x.id === id);
  t.done = !t.done;
  Store.save();
  renderTodos();
  renderDashboard();
}

function deleteTodo(id) {
  if (!confirm('이 할일을 삭제하시겠습니까?')) return;
  Store.data.todos = Store.data.todos.filter(x => x.id !== id);
  Store.save();
  renderTodos();
  renderDashboard();
}

$('#btnAddTodo').addEventListener('click', () => {
  const title = $('#todoTitle').value.trim();
  if (!title) { alert('할일 내용을 입력해주세요.'); return; }
  Store.data.todos.push({
    id: Store.nextId(Store.data.todos),
    title,
    note: $('#todoNote').value.trim(),
    due: $('#todoDue').value,
    done: false,
  });
  Store.save();
  $('#todoTitle').value = ''; $('#todoNote').value = ''; $('#todoDue').value = '';
  renderTodos();
  renderDashboard();
});

/* =========================================================
 * 백업 / 복원 / 초기화
 * ========================================================= */

$('#btnExport').addEventListener('click', () => Store.exportJson());

/* ---------- 엑셀(CSV) 내보내기 ---------- */

function downloadCsv(filename, rows) {
  // 각 셀을 따옴표로 감싸고 내부 따옴표는 이스케이프, Excel 한글 깨짐 방지 위해 BOM 추가
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#btnExportPropCsv').addEventListener('click', () => {
  const head = ['번호', '소유자', '유형', '임대유형', '취득연도', '주임사등록일', '주소', '동호수',
    '계약시작', '계약만기', '만기D-day', '보증금', '월세', '임차인', '연락처', '보증보험', '메모'];
  const rows = visibleProps().map(p => {
    const l = p.lease;
    const dday = l ? ddayOf(l.end) : null;
    return [
      p.id, p.owner, p.type, p.rentalType, p.acquireYear, p.regDate, p.address, p.unit,
      l?.start || '', l?.end || '', dday == null ? '' : dday,
      l?.deposit || '', l?.monthlyRent || '', l?.tenantName || '', l?.tenantPhone || '',
      l ? (l.insurance?.joined ? '가입' : '미가입') : '', p.memo || '',
    ];
  });
  downloadCsv('부동산현황', [head, ...rows]);
});

$('#btnExportLeaseCsv').addEventListener('click', () => {
  const head = ['물건', '소유자', '임대유형', '임차인', '연락처', '계약시작', '계약만기', '만기D-day',
    '보증금', '월세', '보증보험', '보증보험기간', '보증보험수수료', '임차인부담분(25%)'];
  const rows = visibleProps().filter(p => p.lease).map(p => {
    const l = p.lease;
    return [
      propLabel(p), p.owner, p.rentalType, l.tenantName || '', l.tenantPhone || '',
      l.start || '', l.end || '', ddayOf(l.end) ?? '',
      l.deposit || '', l.monthlyRent || '',
      l.insurance?.joined ? '가입' : '미가입', l.insurance?.period || '',
      l.insurance?.fee || '', l.insurance?.tenantShare || '',
    ];
  });
  downloadCsv('임대차현황', [head, ...rows]);
});

/* ---------- 계약 만기 캘린더(ICS) 내보내기 ---------- */

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

$('#btnExportIcs').addEventListener('click', () => {
  const leased = visibleProps().filter(p => p.lease && p.lease.end);
  if (!leased.length) { alert('만기일이 입력된 임대차 계약이 없습니다.'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ev = p => {
    const d = p.lease.end.replace(/-/g, '');
    const title = `[임대차 만기] ${propLabel(p)}`;
    const desc = `임차인: ${p.lease.tenantName || '-'} / 보증금 ${fmt(p.lease.deposit)}원` +
      (p.lease.monthlyRent ? ` / 월세 ${fmt(p.lease.monthlyRent)}원` : '') +
      ` / 보증보험 ${p.lease.insurance?.joined ? '가입' : '미가입'}`;
    return [
      'BEGIN:VEVENT',
      `UID:rems-lease-${p.id}-${d}@rems`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      `LOCATION:${icsEscape(p.address + ' ' + (p.unit || ''))}`,
      // 만기 60일·30일 전 알림
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)} 60일 전`, 'TRIGGER:-P60D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)} 30일 전`, 'TRIGGER:-P30D', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  };
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//REMS//부동산관리//KO',
    'X-WR-CALNAME:임대차 만기', ...leased.map(ev), 'END:VCALENDAR'].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `임대차만기_${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  alert(`계약 ${leased.length}건의 만기 일정을 내보냈습니다.\n스마트폰에서 이 파일을 열면 캘린더 앱에 등록되고, 60일·30일 전에 알림을 받습니다.`);
});

$('#fileImport').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  Store.importJson(file, ok => {
    alert(ok ? '백업 데이터를 불러왔습니다.' : '파일 형식이 올바르지 않습니다.');
    if (ok) renderAll();
    e.target.value = '';
  });
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('모든 변경사항이 사라지고 엑셀 기준 초기 데이터로 재설정됩니다. 계속하시겠습니까?')) return;
  Store.reset();
  renderAll();
});

/* =========================================================
 * 클라우드 동기화 설정 (소유자 전용)
 * ========================================================= */

function syncMsg(text, isErr) {
  const m = $('#syncMsg');
  if (!m) return;
  m.textContent = text || '';
  m.style.color = isErr ? 'var(--danger)' : 'var(--ok)';
}

$('#btnSync').addEventListener('click', () => {
  $('#syncToken').value = Store.data.settings?.ghToken || '';
  syncMsg('');
  $('#syncModalBg').classList.remove('hidden');
});
$('#btnSyncClose').addEventListener('click', () => $('#syncModalBg').classList.add('hidden'));
$('#syncModalBg').addEventListener('click', e => {
  if (e.target === $('#syncModalBg')) $('#syncModalBg').classList.add('hidden');
});

$('#btnSaveToken').addEventListener('click', () => {
  Store.data.settings.ghToken = $('#syncToken').value.trim();
  Store.save();
  syncMsg(Store.data.settings.ghToken ? '토큰을 저장했습니다. 이제 수정하면 자동 업로드됩니다.' : '토큰을 삭제했습니다.');
  REMSSync.updateTag();
});

$('#btnSyncPush').addEventListener('click', async () => {
  syncMsg('업로드 중…');
  try {
    await REMSSync.push();
    syncMsg('업로드 완료. 다른 기기에서 로그인하면 이 데이터를 받게 됩니다.');
  } catch (e) { syncMsg(e.message, true); }
});

$('#btnSyncPull').addEventListener('click', async () => {
  const c = REMSSync.creds();
  if (!c) { syncMsg('세션에 로그인 정보가 없습니다. 로그아웃 후 다시 로그인해주세요.', true); return; }
  syncMsg('내려받는 중…');
  try {
    const remote = await REMSSync.pullDecrypt(c.id, c.pw);
    if (!remote || !remote.properties) { syncMsg('클라우드에 저장된 데이터가 아직 없습니다.', true); return; }
    const lu = Store.data.meta?.updatedAt || 0;
    const ru = remote.meta?.updatedAt || 0;
    if (ru <= lu && !confirm('클라우드 데이터가 이 기기 데이터보다 오래되었습니다. 그래도 덮어쓸까요?')) {
      syncMsg('취소했습니다.'); return;
    }
    Store.snapshot('클라우드 내려받기 직전');
    Store.data = remote;
    Store.migrate();
    Store.save(false);
    renderAll();
    syncMsg('클라우드 데이터를 적용했습니다.');
  } catch (e) { syncMsg('내려받기 실패: ' + e.message, true); }
});

/* =========================================================
 * 변경 이력(스냅샷) 복구
 * ========================================================= */

function renderSnapshots() {
  const list = Store.listSnapshots();
  $('#snapTable tbody').innerHTML = list.length
    ? list.map(s => {
        let count = '-';
        try { count = (JSON.parse(s.json).properties || []).length + '건'; } catch (e) {}
        return `
        <tr>
          <td>${new Date(s.t).toLocaleString('ko-KR')}</td>
          <td>${s.label || '자동'}</td>
          <td>${count}</td>
          <td><button class="link-btn" data-restore="${s.t}">이 시점으로 복원</button></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">저장된 스냅샷이 없습니다. 데이터를 수정하면 자동으로 쌓입니다.</td></tr>';
}

$('#btnSnapshots').addEventListener('click', () => {
  renderSnapshots();
  $('#snapModalBg').classList.remove('hidden');
});
$('#btnSnapClose').addEventListener('click', () => $('#snapModalBg').classList.add('hidden'));
$('#snapModalBg').addEventListener('click', e => {
  if (e.target === $('#snapModalBg')) $('#snapModalBg').classList.add('hidden');
});
$('#snapTable').addEventListener('click', e => {
  const t = e.target.dataset.restore;
  if (t == null) return;
  if (!confirm('현재 데이터를 이 스냅샷 시점으로 되돌립니다. 계속할까요?\n(되돌리기 직전 상태도 스냅샷으로 보관됩니다)')) return;
  if (Store.restoreSnapshot(Number(t))) {
    renderAll();
    $('#snapModalBg').classList.add('hidden');
    alert('복원했습니다.');
  } else {
    alert('복원에 실패했습니다.');
  }
});

/* =========================================================
 * 공인중개사 계정 관리 / 배정 / 로그인 파일 생성 (소유자 전용)
 * ========================================================= */

function managerName(id) {
  if (!id) return '';
  const a = (Store.data.accounts || []).find(x => x.id === id);
  return a ? (a.name || a.id) : id;
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/javascript;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function acctMsg(text, isErr) {
  const m = $('#acctMsg');
  if (!m) return;
  m.textContent = text || '';
  m.style.color = isErr ? 'var(--danger)' : 'var(--ok)';
}

function renderAccounts() {
  const accts = Store.data.accounts || [];
  const counts = {};
  Store.data.properties.forEach(p => { if (p.managerId) counts[p.managerId] = (counts[p.managerId] || 0) + 1; });
  $('#acctTable tbody').innerHTML = accts.length
    ? accts.map(a => `
      <tr>
        <td>${a.id}</td>
        <td>${a.name || '-'}</td>
        <td><code>${a.pw || ''}</code></td>
        <td>${counts[a.id] || 0}건</td>
        <td><button class="link-btn" data-delacct="${a.id}">삭제</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">등록된 중개사가 없습니다.</td></tr>';
}

$('#btnAccounts').addEventListener('click', () => {
  renderAccounts(); acctMsg('');
  $('#acctModalBg').classList.remove('hidden');
});
$('#btnAcctClose').addEventListener('click', () => $('#acctModalBg').classList.add('hidden'));
$('#acctModalBg').addEventListener('click', e => {
  if (e.target === $('#acctModalBg')) $('#acctModalBg').classList.add('hidden');
});

$('#btnAddAcct').addEventListener('click', () => {
  const id = $('#acId').value.trim(), name = $('#acName').value.trim(), pw = $('#acPw').value.trim();
  if (!id || !pw) { alert('아이디와 비밀번호는 필수입니다.'); return; }
  if ((Store.data.accounts || []).some(a => a.id === id)) { alert('이미 존재하는 아이디입니다.'); return; }
  Store.data.accounts.push({ id, name, pw });
  Store.save();
  $('#acId').value = ''; $('#acName').value = ''; $('#acPw').value = '';
  renderAccounts();
});

$('#acctTable').addEventListener('click', e => {
  const id = e.target.dataset.delacct;
  if (id == null) return;
  if (!confirm(`중개사 '${id}' 계정을 삭제할까요? 해당 물건의 배정도 해제됩니다.`)) return;
  Store.data.accounts = Store.data.accounts.filter(a => a.id !== id);
  Store.data.properties.forEach(p => { if (p.managerId === id) p.managerId = ''; });
  Store.save();
  renderAccounts(); renderProperties();
});

// 중개사별 "배정 물건만" 암호화한 로그인 파일 생성
$('#btnGenAccounts').addEventListener('click', async () => {
  const accts = Store.data.accounts || [];
  if (!accts.length) { acctMsg('등록된 중개사가 없습니다.', true); return; }
  acctMsg('생성 중…');
  try {
    const entries = await REMSSync.buildAccountEntries(Store.data);
    downloadText('accounts.enc.js',
      '/* 공인중개사 로그인용 암호문 (자동 생성). js/accounts.enc.js 에 덮어쓰고 배포하세요. */\n' +
      'window.__REMS_ACCOUNTS__ = ' + JSON.stringify(entries) + ';\n');
    // 클라우드에도 즉시 올려 중개사 로그인에 바로 반영
    if (REMSSync.token()) {
      try {
        await REMSSync.pushAccounts(Store.data);
        acctMsg(`완료: 파일 다운로드 + 클라우드 배정 반영(${entries.length}명). 중개사는 재로그인하면 최신 배정만 보입니다.`);
      } catch (e2) {
        acctMsg(`파일은 생성됨. 클라우드 업로드 실패: ${e2.message}`, true);
      }
    } else {
      acctMsg(`완료: accounts.enc.js 생성. 클라우드 토큰이 없으면 js/ 에 올려 배포하세요. (☁️ 동기화 토큰 등록 시 자동 반영)`);
    }
  } catch (e) { acctMsg('생성 실패: ' + e.message, true); }
});

// 소유자 마스터(data.enc.js) 재생성 - 배정/계정 변경을 서버에도 반영
$('#btnGenMaster').addEventListener('click', async () => {
  if (!window.__REMS_ENC__) { acctMsg('이 환경에서는 마스터 재생성을 사용할 수 없습니다.', true); return; }
  const id = prompt('소유자 아이디를 입력하세요'); if (!id) return;
  const pw = prompt('소유자 비밀번호를 입력하세요'); if (!pw) return;
  try { await REMSCrypto.decryptToText(id, pw, window.__REMS_ENC__); }
  catch (e) { acctMsg('소유자 계정이 올바르지 않습니다.', true); return; }
  try {
    const entry = await REMSCrypto.encryptJSON(id, pw, Store.data);
    downloadText('data.enc.js',
      '/* 실데이터(AES-GCM 암호화). 아이디+비밀번호로만 복호화됩니다. 평문 개인정보 없음. */\n' +
      'window.__REMS_ENC__ = ' + JSON.stringify(entry) + ';\n');
    acctMsg('완료: data.enc.js 생성. js/ 폴더에 올리면 배정·계정이 서버에도 반영됩니다.');
  } catch (e) { acctMsg('생성 실패: ' + e.message, true); }
});

/* =========================================================
 * 임대소득 신고 (사업장현황신고)
 * ========================================================= */

function incomeRows() {
  const owner = $('#incomeOwner').value;
  return visibleProps()
    .filter(p => p.lease && isHouseType(p) && (!owner || p.owner === owner));
}

function renderIncome() {
  const rows = incomeRows();
  const deemedOn = $('#incomeDeemed').checked;
  const rate = Number($('#drRate').value) || 3.5;

  const leases = rows.map(p => p.lease);
  const sum = Tax.rentalIncome(leases, rate, deemedOn);

  $('#incomeCards').innerHTML = `
    <div class="card"><div class="label">임대 물건(주택)</div><div class="value">${rows.length}건</div></div>
    <div class="card"><div class="label">보증금 합계</div><div class="value" style="font-size:20px">${fmt(sum.depositSum)}</div></div>
    <div class="card"><div class="label">연 월세수입</div><div class="value" style="font-size:20px">${fmt(sum.yearlyRent)}</div><div class="sub">월 ${fmt(sum.monthlySum)}</div></div>
    <div class="card warn"><div class="label">간주임대료(추정)</div><div class="value" style="font-size:20px">${deemedOn ? fmt(Math.round(sum.deemed)) : '제외'}</div></div>
    <div class="card"><div class="label">총 수입금액(추정)</div><div class="value" style="font-size:20px">${fmt(Math.round(sum.total))}</div></div>`;

  $('#incomeTable tbody').innerHTML = rows.map(p => {
    const l = p.lease;
    return `
    <tr>
      <td class="addr"><b>${propLabel(p)}</b></td>
      <td>${p.owner}</td>
      <td>${p.rentalType || '일반'}</td>
      <td>${l.tenantName || '-'}</td>
      <td>${l.start || '?'} ~ ${l.end || '?'}</td>
      <td style="text-align:right">${l.deposit ? fmt(l.deposit) : '-'}</td>
      <td style="text-align:right">${l.monthlyRent ? fmt(l.monthlyRent) : '-'}</td>
      <td style="text-align:right">${l.monthlyRent ? fmt(l.monthlyRent * 12) : '-'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">해당 임대 물건이 없습니다.</td></tr>';

  $('#incomeTable tfoot').innerHTML = rows.length ? `
    <tr style="font-weight:700;background:#f8fafd">
      <td colspan="5" style="text-align:right">합계</td>
      <td style="text-align:right">${fmt(sum.depositSum)}</td>
      <td style="text-align:right">${fmt(sum.monthlySum)}</td>
      <td style="text-align:right">${fmt(sum.yearlyRent)}</td>
    </tr>` : '';
}

['incomeOwner', 'incomeDeemed'].forEach(id =>
  $(`#${id}`).addEventListener('change', renderIncome));

$('#btnDrCalc').addEventListener('click', () => {
  const dep = parseNum($('#drDeposit').value);
  const rate = Number($('#drRate').value) || 3.5;
  const apply = $('#drApply').checked;
  if (!dep) { alert('임대보증금 합계를 입력해주세요.'); return; }
  const r = Tax.deemedRent(dep, rate, apply);
  $('#drResult').innerHTML = `
    <div class="result-box">
      ${apply ? `
      <div class="row"><span>보증금 합계</span><span>${Tax.won(dep)}</span></div>
      <div class="row"><span>기본공제</span><span>- ${Tax.won(300000000)}</span></div>
      <div class="row"><span>과세대상 (60% 적용 전)</span><span>${Tax.won(r.base)}</span></div>
      <div class="row total"><span>간주임대료 (× 60% × ${rate}%)</span><span>${Tax.won(Math.round(r.deemed))}</span></div>
      <div class="note">간주임대료 = (보증금합계 − 3억원) × 60% × 정기예금이자율. 소형주택(전용 40㎡·기준시가 2억 이하) 제외, 금융수익 차감은 미반영한 개략치입니다.</div>`
      : '<div class="row total"><span>간주임대료</span><span>대상 아님 (3주택 미만)</span></div><div class="note">부부합산 3주택 이상이면서 보증금 합계가 3억원을 초과할 때만 간주임대료가 과세됩니다.</div>'}
    </div>`;
});

$('#btnExportIncomeCsv').addEventListener('click', () => {
  const head = ['물건', '소유자', '임대유형', '임차인', '계약시작', '계약만기', '보증금', '월세', '연월세수입'];
  const rows = incomeRows().map(p => {
    const l = p.lease;
    return [propLabel(p), p.owner, p.rentalType, l.tenantName || '', l.start || '', l.end || '',
      l.deposit || '', l.monthlyRent || '', l.monthlyRent ? l.monthlyRent * 12 : 0];
  });
  downloadCsv('임대소득신고자료', [head, ...rows]);
});

/* =========================================================
 * 초기화
 * ========================================================= */

/* 관리자 → 중개사 화면 전환 셀렉트 */
$('#viewAsSelect').addEventListener('change', e => {
  const v = e.target.value;
  try {
    if (v) sessionStorage.setItem(VIEW_AS_KEY, v);
    else sessionStorage.removeItem(VIEW_AS_KEY);
  } catch (err) {}
  renderAll();
  window.scrollTo({ top: 0 });
});

function renderAll() {
  // 관리자: 화면 계정 전환 UI + view-as 상태 적용
  const isOwner = window.__REMS_ROLE__ === 'owner';
  const accts = Store.data.accounts || [];
  const sw = $('#acctSwitch');
  let va = currentViewAs();
  if (va && !accts.some(a => a.id === va)) { // 삭제된 계정이면 해제
    va = '';
    try { sessionStorage.removeItem(VIEW_AS_KEY); } catch (e) {}
  }
  if (sw) {
    sw.classList.toggle('hidden', !(isOwner && accts.length));
    if (isOwner && accts.length) {
      const sel = $('#viewAsSelect');
      sel.innerHTML = '<option value="">👑 관리자 (전체 물건)</option>' +
        accts.map(a => `<option value="${a.id}">${a.name || a.id} 화면</option>`).join('');
      sel.value = va;
    }
  }
  if (isOwner) {
    // 중개사 화면 미리보기 중에는 관리자 전용 UI 숨김 (중개사가 보는 그대로)
    document.body.classList.toggle('role-agent', !!va);
    document.body.classList.toggle('role-owner', !va);
  }

  const roleTag = $('#roleTag');
  if (roleTag) {
    const r = window.__REMS_ROLE__;
    roleTag.textContent = r === 'agent' ? '공인중개사 모드 (배정 물건만 표시)'
      : (r === 'owner'
          ? (va ? `관리자 → ${managerName(va)} 화면 보기 중` : '관리자(소유자) 모드')
          : '');
  }
  renderDashboard();
  renderProperties();
  renderLeases();
  renderTodos();
  populatePropPickers();
  renderIncome();
  if (window.REMSSync) REMSSync.updateTag();
}

/* PWA: 서비스워커 등록 (홈 화면 설치·오프라인 열람) */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/** 관리자 로컬 배정이 클라우드와 다르면 즉시 업로드 (중개사 리스트 불일치 방지) */
async function reconcileAssignmentsToCloud() {
  if (window.__REMS_ROLE__ !== 'owner' || currentViewAs()) return;
  if (!window.REMSSync || !REMSSync.token || !REMSSync.token()) return;
  if (!REMSSync.creds || !REMSSync.creds()) return;
  try {
    const remote = await REMSSync.pullAssignments();
    const local = REMSSync.buildAssignments(Store.data);
    const rMap = (remote && remote.map) || {};
    if (JSON.stringify(rMap) === JSON.stringify(local.map)) {
      REMSSync.updateTag();
      return;
    }
    REMSSync.updateTag('배정 클라우드 반영 중…');
    await REMSSync.push();
    const tip = $('#mgrBulkMsg');
    if (tip) tip.textContent = '✓ 로컬 배정 해제가 클라우드(중개사 로그인)에 반영되었습니다. 중개사는 새로고침·재로그인하세요.';
    REMSSync.updateTag();
  } catch (err) {
    REMSSync.updateTag('배정 반영 실패');
    const tip = $('#mgrBulkMsg');
    if (tip) tip.textContent = '배정 클라우드 반영 실패: ' + (err && err.message ? err.message : err);
  }
}

/* 데스크톱(pywebview)에서는 API 준비 후, 브라우저에서는 즉시 시작 */
let booted = false;
function boot() {
  booted = true;
  Store.load().then(() => {
    renderAll();
    // 소유자: 로컬에서 해제한 배정이 중개사에 남아 있는 경우 자동 교정
    reconcileAssignmentsToCloud();
  });
}

/* 로그인 게이트(auth.js)가 활성화된 웹 환경에서는 인증 성공 후 boot() 호출 */
window.__remsBoot = boot;
window.addEventListener('pywebviewready', () => { if (!window.__REMS_AUTH_GATE__) boot(); });
setTimeout(() => { if (!booted && !window.__REMS_AUTH_GATE__) boot(); }, 250);
