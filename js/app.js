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

/* ---------- 탭 전환 ---------- */

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach(t => t.classList.add('hidden'));
    $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
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
  const props = Store.data.properties;
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
  const props = Store.data.properties;
  const fill = (sel, values) => {
    const cur = sel.value;
    sel.innerHTML = sel.options[0].outerHTML +
      [...new Set(values)].filter(Boolean).map(v => `<option>${v}</option>`).join('');
    sel.value = cur;
  };
  fill($('#filterType'), props.map(p => p.type));
  fill($('#filterOwner'), props.map(p => p.owner));
  fill($('#filterRental'), props.map(p => p.rentalType));
}

function renderProperties() {
  buildFilters();
  const ft = $('#filterType').value, fo = $('#filterOwner').value,
        fr = $('#filterRental').value, fs = $('#filterSearch').value.trim();

  const rows = Store.data.properties.filter(p =>
    (!ft || p.type === ft) &&
    (!fo || p.owner === fo) &&
    (!fr || p.rentalType === fr) &&
    (!fs || (p.address + ' ' + p.unit).includes(fs))
  );

  $('#propTable tbody').innerHTML = rows.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.owner}</td>
      <td>${typeBadge(p.type)}</td>
      <td>${p.rentalType || '-'}</td>
      <td>${p.acquireYear ? p.acquireYear + '년' : '-'}</td>
      <td class="addr">${p.address}<span class="map-mini" data-mapid="${p.id}">지도</span></td>
      <td>${p.unit || '-'}</td>
      <td>${p.lease ? p.lease.end : '-'}</td>
      <td>${ddayBadge(p.lease ? ddayOf(p.lease.end) : null)}</td>
      <td><button class="link-btn" onclick="openModal(${p.id})">상세</button></td>
    </tr>`).join('') ||
    '<tr><td colspan="10" class="empty">조건에 맞는 물건이 없습니다.</td></tr>';
}

// 목록의 '지도' 빠른 링크 (카카오맵)
$('#propTable').addEventListener('click', e => {
  const id = e.target.dataset.mapid;
  if (id == null) return;
  const p = Store.data.properties.find(x => x.id === Number(id));
  if (p) openExternal(mapServices(p.address, p.unit)[0].url);
});

['filterType', 'filterOwner', 'filterRental'].forEach(id =>
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

function renderKakaoPreview(addr) {
  const box = $('#mMapBox');
  const key = Store.data.settings?.kakaoKey;
  if (!key || !addr) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  const draw = () => {
    if (!(window.kakao && window.kakao.maps && window.kakao.maps.services)) {
      box.innerHTML = '<div class="empty" style="padding:14px">지도를 불러오지 못했습니다. 키 또는 네트워크를 확인하세요.</div>';
      return;
    }
    kakao.maps.load(() => {
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
  sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
  sc.onload = draw;
  sc.onerror = () => { box.innerHTML = '<div class="empty" style="padding:14px">카카오맵 SDK 로드 실패 (키/도메인 등록 확인).</div>'; };
  document.head.appendChild(sc);
}

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

function openModal(id) {
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
  $('#mKakaoKey').value = Store.data.settings?.kakaoKey || '';
  renderKakaoPreview(addr);

  const l = p?.lease;
  $('#mHasLease').checked = !!l;
  $('#mLeaseFields').style.display = l ? '' : 'none';
  $('#mLeaseStart').value = l?.start || '';
  $('#mLeaseEnd').value = l?.end || '';
  $('#mDeposit').value = l?.deposit ? fmt(l.deposit) : '';
  $('#mMonthly').value = l?.monthlyRent ? fmt(l.monthlyRent) : '';
  $('#mTenant').value = l?.tenantName || '';
  $('#mTenantPhone').value = l?.tenantPhone || '';
  $('#mInsJoined').checked = !!l?.insurance?.joined;
  $('#mInsPeriod').value = l?.insurance?.period || '';
  $('#mInsFee').value = l?.insurance?.fee ? fmt(l.insurance.fee) : '';
  $('#mInsTenantShare').value = l?.insurance?.tenantShare ? fmt(l.insurance.tenantShare) : '';

  $('#btnModalDelete').classList.toggle('hidden', !p);
  $('#modalBg').classList.remove('hidden');
}

$('#mHasLease').addEventListener('change', e => {
  $('#mLeaseFields').style.display = e.target.checked ? '' : 'none';
});

$('#btnModalCancel').addEventListener('click', () => $('#modalBg').classList.add('hidden'));
$('#modalBg').addEventListener('click', e => {
  if (e.target === $('#modalBg')) $('#modalBg').classList.add('hidden');
});

$('#btnModalSave').addEventListener('click', () => {
  const id = $('#mId').value ? Number($('#mId').value) : null;
  const lease = $('#mHasLease').checked ? {
    start: $('#mLeaseStart').value,
    end: $('#mLeaseEnd').value,
    deposit: parseNum($('#mDeposit').value),
    monthlyRent: parseNum($('#mMonthly').value),
    tenantName: $('#mTenant').value.trim(),
    tenantPhone: $('#mTenantPhone').value.trim(),
    insurance: {
      joined: $('#mInsJoined').checked,
      period: $('#mInsPeriod').value.trim(),
      fee: parseNum($('#mInsFee').value),
      tenantShare: parseNum($('#mInsTenantShare').value),
    },
  } : null;

  const obj = {
    owner: $('#mOwner').value.trim(),
    type: $('#mType').value,
    rentalType: $('#mRentalType').value.trim(),
    acquireYear: $('#mAcquireYear').value.trim(),
    acquireDate: $('#mAcquireDate').value,
    acquirePrice: parseNum($('#mAcquirePrice').value),
    regDate: $('#mRegDate').value,
    address: $('#mAddress').value.trim(),
    unit: $('#mUnit').value.trim(),
    memo: $('#mMemo').value.trim(),
    priceHistory: modalPriceHistory.map(r => ({ year: Number(r.year), price: Number(r.price) })),
    lease,
  };

  if (!obj.address) { alert('주소를 입력해주세요.'); return; }

  if (id) {
    const idx = Store.data.properties.findIndex(x => x.id === id);
    Store.data.properties[idx] = { ...Store.data.properties[idx], ...obj };
  } else {
    obj.id = Store.nextId(Store.data.properties);
    obj.rentStartDate = '';
    Store.data.properties.push(obj);
  }
  Store.save();
  $('#modalBg').classList.add('hidden');
  renderAll();
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
  const rows = Store.data.properties
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
  const opts = Store.data.properties
    .filter(p => isHouseType(p))
    .map(p => `<option value="${p.id}">${propLabel(p)} (${p.owner})</option>`).join('');
  ['holdPropPick', 'trPropPick'].forEach(id => {
    const sel = $(`#${id}`);
    if (sel) sel.innerHTML = '<option value="">— 직접 입력 —</option>' + opts;
  });
  // 임대소득 소유자 필터
  const owners = [...new Set(Store.data.properties.map(p => p.owner))].filter(Boolean);
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
  const houses = Store.data.properties.filter(p => isHouseType(p));
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
  const rows = Store.data.properties.map(p => {
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
  const rows = Store.data.properties.filter(p => p.lease).map(p => {
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
 * 임대소득 신고 (사업장현황신고)
 * ========================================================= */

function incomeRows() {
  const owner = $('#incomeOwner').value;
  return Store.data.properties
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

function renderAll() {
  renderDashboard();
  renderProperties();
  renderLeases();
  renderTodos();
  populatePropPickers();
  renderIncome();
}

/* 데스크톱(pywebview)에서는 API 준비 후, 브라우저에서는 즉시 시작 */
let booted = false;
function boot() {
  booted = true;
  Store.load().then(renderAll);
}

/* 로그인 게이트(auth.js)가 활성화된 웹 환경에서는 인증 성공 후 boot() 호출 */
window.__remsBoot = boot;
window.addEventListener('pywebviewready', () => { if (!window.__REMS_AUTH_GATE__) boot(); });
setTimeout(() => { if (!booted && !window.__REMS_AUTH_GATE__) boot(); }, 250);
