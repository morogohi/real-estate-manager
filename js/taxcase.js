/* =========================================================
 * taxcase.js - 세무 소명(해명안내) 대응 모듈
 *
 *  1) 물건별 임대차 이력(leaseHistory) + 현재 계약을 합쳐
 *     귀속연도별 임대수입을 "일할(日割)"로 계산
 *  2) 간주임대료를 보증금 적수 기준으로 계산
 *     (일자별 보증금 합계 − 3억원) × 60% × 1/365 × 정기예금이자율 − 금융수익
 *  3) 세무서 해명안내 건(taxCases) 관리: 세무서 목록 소재지 ↔ 보유 물건 매칭,
 *     증빙 체크리스트, 별첨 내역표 CSV, 해명의견서 초안 생성
 *
 *  데이터 구조 (Store.data에 추가, 개인 데이터는 브라우저에만 저장)
 *   property.leaseHistory = [{ id, start, end, tenantName, deposit, monthlyRent,
 *                              use: '주거'|'업무'|'공실'|'자가',
 *                              evidence: { contract, report }, estimated, note }]
 *   property.disposeDate   = 'YYYY-MM-DD' (양도일)
 *   property.smallHouse    = true  (전용 40㎡ 이하 & 기준시가 2억 이하 → 간주임대료 제외)
 *   property.lease.use     = '주거'|'업무'
 *   Store.data.taxCases    = [{ id, docNo, office, officer, phone, fax, year, due,
 *                              status, memo, submittedAt, items: [...] }]
 *   item = { id, code, address, kind, acquireDate, disposeDate, propIds: [],
 *            manual: { start, end, tenantName, deposit, monthlyRent } | null,
 *            checks: { payment, vacancy, sale, reviewed }, note }
 * ========================================================= */

(function () {
  'use strict';

  /** 귀속연도별 정기예금이자율(%) — 소득세법 시행규칙 제23조 */
  const DEEMED_RATE_BY_YEAR = { 2022: 1.2, 2023: 2.9, 2024: 3.5, 2025: 3.1, 2026: 3.1 };
  const DEEMED_BASE = 300000000;
  const USES = ['주거', '업무', '공실', '자가'];
  const CASE_STATUS = ['접수(안내문 수령)', '자료 수집중', '제출 완료', '추가 요청', '종결'];

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const won = n => (n == null || isNaN(n)) ? '-' : Math.round(n).toLocaleString('ko-KR');
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = s => { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; };
  const dayMs = 86400000;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function rateFor(year) {
    const s = Store.data.settings || {};
    if (s.deemedRates && s.deemedRates[year] != null) return Number(s.deemedRates[year]);
    return DEEMED_RATE_BY_YEAR[year] != null ? DEEMED_RATE_BY_YEAR[year] : (s.deemedRate || 3.1);
  }

  /* ---------- 마이그레이션 ---------- */

  function migrate(d) {
    if (!d) return;
    if (!Array.isArray(d.taxCases)) d.taxCases = [];
    (d.properties || []).forEach(p => {
      if (!Array.isArray(p.leaseHistory)) p.leaseHistory = [];
      if (p.disposeDate == null) p.disposeDate = '';
      if (p.smallHouse == null) p.smallHouse = false;
      p.leaseHistory.forEach(h => {
        if (!h.id) h.id = uid();
        if (!h.use) h.use = '주거';
        if (!h.evidence) h.evidence = { contract: false, report: false };
      });
    });
    d.taxCases.forEach(c => (c.items || []).forEach(it => {
      if (!it.id) it.id = uid();
      if (!Array.isArray(it.propIds)) it.propIds = [];
      if (!it.checks) it.checks = {};
    }));
  }

  /* ---------- 임대차 구간 ---------- */

  /** 이력 + 현재 계약을 하나의 구간 목록으로 (시작일 순) */
  function propPeriods(p) {
    const list = (p.leaseHistory || []).map(h => ({ ...h, current: false }));
    if (p.lease && p.lease.start) {
      const l = p.lease;
      const dup = list.some(h => h.start === l.start && (h.tenantName || '') === (l.tenantName || ''));
      if (!dup) {
        list.push({
          id: 'current', start: l.start, end: l.end, tenantName: l.tenantName,
          deposit: l.deposit, monthlyRent: l.monthlyRent, use: l.use || '주거',
          evidence: l.evidence || { contract: true, report: false }, current: true,
        });
      }
    }
    return list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }

  /**
   * 귀속연도 계산 (물건 1건 또는 수기 구간)
   * @param periods  구간 목록
   * @param year     귀속연도
   * @param own      { from, to } 보유기간(취득일·양도일)
   * @param depositDays 포트폴리오 일자별 보증금 누적 배열(옵션, 간주임대료용)
   * @param includeDeposit 간주임대료 합산 여부(소형주택 제외 시 false)
   */
  function yearCalc(periods, year, own, depositDays, includeDeposit) {
    const y0 = new Date(year, 0, 1);
    const y1 = new Date(year, 11, 31);
    const daysInYear = Math.round((y1 - y0) / dayMs) + 1;
    let from = y0, to = y1;
    const of = dateOf(own && own.from), ot = dateOf(own && own.to);
    if (of && of > from) from = of;
    if (ot && ot < to) to = ot;

    const r = {
      year, daysInYear, ownedDays: 0, coveredDays: 0, vacantDays: 0,
      rent: 0, rentBiz: 0, depositDaySum: 0, gaps: [], used: [], ownFrom: ymd(from), ownTo: ymd(to),
    };
    if (to < from) return r; // 해당 연도 미보유

    const ps = periods.map(p => ({
      ...p, s: dateOf(p.start), e: dateOf(p.end) || (p.current ? y1 : null),
    })).filter(p => p.s);

    const usedIds = new Set();
    let gapStart = null;
    let i = Math.round((from - y0) / dayMs) - 1;
    for (let d = new Date(from); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      i++;
      const prevDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      r.ownedDays++;
      // 같은 날 겹치면 늦게 시작한 계약 우선(갱신·재계약)
      let hit = null;
      for (const p of ps) if (p.s <= d && (!p.e || p.e >= d)) hit = p;
      if (!hit) {
        if (!gapStart) gapStart = d;
        continue;
      }
      if (gapStart) { r.gaps.push([ymd(gapStart), ymd(prevDay)]); gapStart = null; }
      r.coveredDays++;
      usedIds.add(hit.id);
      const use = hit.use || '주거';
      if (use === '공실' || use === '자가') { r.vacantDays++; continue; }
      const daily = (Number(hit.monthlyRent) || 0) * 12 / daysInYear;
      if (use === '업무') { r.rentBiz += daily; continue; }
      r.rent += daily;
      const dep = Number(hit.deposit) || 0;
      r.depositDaySum += dep;
      if (depositDays && includeDeposit) depositDays[i] += dep;
    }
    if (gapStart) r.gaps.push([ymd(gapStart), ymd(to)]);
    r.used = ps.filter(p => usedIds.has(p.id));
    r.avgDeposit = r.ownedDays ? r.depositDaySum / daysInYear : 0;
    return r;
  }

  /** 일자별 보증금 합계 → 간주임대료 */
  function deemedFromDays(depositDays, ratePct, finIncome) {
    let excessDaySum = 0;
    depositDays.forEach(v => { if (v > DEEMED_BASE) excessDaySum += v - DEEMED_BASE; });
    const gross = excessDaySum * 0.6 / 365 * (ratePct / 100);
    return { excessDaySum, gross, deemed: Math.max(0, gross - (Number(finIncome) || 0)) };
  }

  function statusOf(r) {
    if (!r.ownedDays) return { label: '미보유', cls: 'gray', level: 0 };
    if (r.gaps.length) return { label: '공백 있음', cls: 'red', level: 3 };
    const noContract = r.used.some(p => (p.use === '주거' || p.use === '업무' || !p.use) && !(p.evidence && p.evidence.contract));
    const est = r.used.some(p => p.estimated);
    if (noContract || est) return { label: est ? '추정 구간 포함' : '계약서 미확보', cls: 'amber', level: 2 };
    return { label: '증빙 완료', cls: 'green', level: 1 };
  }

  /** 물건 1건 귀속연도 결과 */
  function propYear(p, year, depositDays) {
    const own = { from: p.acquireDate || (p.acquireYear ? `${p.acquireYear}-01-01` : ''), to: p.disposeDate || '' };
    return yearCalc(propPeriods(p), year, own, depositDays, isHouseType(p) && !p.smallHouse);
  }

  /** 포트폴리오 집계 */
  function portfolio(year, ownerFilter) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = new Array(leap ? 366 : 365).fill(0);
    const rows = visibleProps()
      .filter(p => p.type !== '토지')
      .filter(p => !ownerFilter || (p.owner || '').includes(ownerFilter))
      .map(p => ({ p, r: propYear(p, year, days) }))
      .filter(x => x.r.ownedDays > 0);
    const rent = rows.reduce((s, x) => s + (isHouseType(x.p) ? x.r.rent : 0), 0);
    const rentBiz = rows.reduce((s, x) => s + x.r.rentBiz + (isHouseType(x.p) ? 0 : x.r.rent), 0);
    const houses = rows.filter(x => isHouseType(x.p) && !x.p.smallHouse).length;
    return { rows, days, rent, rentBiz, houses };
  }

  /* ---------- 해명 건 항목 계산 ---------- */

  function itemYear(it, year) {
    const props = (it.propIds || []).map(id => Store.data.properties.find(p => p.id === id)).filter(Boolean);
    if (props.length) {
      const rs = props.map(p => ({ p, r: propYear(p, year, null) }));
      const worst = rs.map(x => statusOf(x.r)).sort((a, b) => b.level - a.level)[0];
      return {
        props, rs, rent: rs.reduce((s, x) => s + x.r.rent, 0), rentBiz: rs.reduce((s, x) => s + x.r.rentBiz, 0),
        avgDeposit: rs.reduce((s, x) => s + x.r.avgDeposit, 0),
        gaps: rs.reduce((s, x) => s + x.r.gaps.length, 0), status: worst,
      };
    }
    const m = it.manual;
    if (m && m.start) {
      const r = yearCalc([{ id: 'm', start: m.start, end: m.end, deposit: m.deposit, monthlyRent: m.monthlyRent,
        use: m.use || '주거', evidence: { contract: !!(it.checks && it.checks.contract) } }],
        year, { from: it.acquireDate, to: it.disposeDate }, null, true);
      return { props: [], rs: [], rent: r.rent, rentBiz: r.rentBiz, avgDeposit: r.avgDeposit, gaps: r.gaps.length, status: statusOf(r), manual: r };
    }
    return { props: [], rs: [], rent: 0, rentBiz: 0, avgDeposit: 0, gaps: 0, status: { label: '물건 미연결', cls: 'gray', level: 4 } };
  }

  /* =========================================================
   * 화면: 세무 소명 탭
   * ========================================================= */

  function curYear() { return Number($('#tcYear').value) || (new Date().getFullYear() - 1); }

  function render() {
    if (!$('#tab-taxcase') || !Store.data) return;
    const yearSel = $('#tcYear');
    if (!yearSel.options.length) {
      const now = new Date().getFullYear();
      for (let y = now; y >= now - 5; y--) yearSel.insertAdjacentHTML('beforeend', `<option value="${y}">${y}년 귀속</option>`);
      yearSel.value = String(now - 1);
      $('#tcRate').value = rateFor(now - 1);
    }
    const ownerSel = $('#tcOwner');
    const owners = [...new Set(Store.data.properties.flatMap(p => String(p.owner || '').split('/').map(s => s.trim())).filter(Boolean))];
    const prevOwner = ownerSel.value;
    ownerSel.innerHTML = '<option value="">전체 소유자</option>' + owners.map(o => `<option>${esc(o)}</option>`).join('');
    ownerSel.value = owners.includes(prevOwner) ? prevOwner : '';

    renderCoverage();
    renderCases();
  }

  function renderCoverage() {
    const year = curYear();
    const pf = portfolio(year, $('#tcOwner').value);
    const rate = Number($('#tcRate').value) || rateFor(year);
    const fin = Number(String($('#tcFin').value || '').replace(/[^\d]/g, '')) || 0;
    const applyDeemed = $('#tcDeemed').checked;
    const dm = deemedFromDays(pf.days, rate, fin);
    const deemed = applyDeemed ? dm.deemed : 0;
    const issues = pf.rows.filter(x => statusOf(x.r).level >= 2).length;
    const gapsN = pf.rows.filter(x => x.r.gaps.length).length;

    $('#tcCards').innerHTML = `
      <div class="card"><div class="label">${year}년 보유 물건</div><div class="value">${pf.rows.length}건</div>
        <div class="sub">간주임대료 대상 주택 ${pf.houses}채</div></div>
      <div class="card"><div class="label">주택 월세수입(일할)</div><div class="value" style="font-size:20px">${won(pf.rent)}</div></div>
      <div class="card warn"><div class="label">간주임대료(적수)</div><div class="value" style="font-size:20px">${applyDeemed ? won(deemed) : '제외'}</div>
        <div class="sub">이자율 ${rate}%${fin ? ` · 금융수익 ${won(fin)} 차감` : ''}</div></div>
      <div class="card"><div class="label">주택임대 총수입금액</div><div class="value" style="font-size:20px">${won(pf.rent + deemed)}</div></div>
      <div class="card"><div class="label">업무용·비주택 임대수입</div><div class="value" style="font-size:20px">${won(pf.rentBiz)}</div>
        <div class="sub">사업소득·부가세 신고분</div></div>
      <div class="card ${gapsN ? 'alert' : (issues ? 'warn' : '')}"><div class="label">소명 보완 필요</div><div class="value">${issues}건</div>
        <div class="sub">계약 공백 ${gapsN}건</div></div>`;

    const flt = $('#tcFilter').value;
    const rows = pf.rows
      .map(x => ({ ...x, st: statusOf(x.r) }))
      .filter(x => !flt || (flt === 'issue' ? x.st.level >= 2 : x.st.level === 1))
      .sort((a, b) => b.st.level - a.st.level || a.p.id - b.p.id);

    $('#tcTable tbody').innerHTML = rows.map(({ p, r, st }) => {
      const pct = r.ownedDays ? Math.round(r.coveredDays / r.ownedDays * 100) : 0;
      const chips = r.used.map(u => `<span class="tc-chip ${u.estimated ? 'est' : ''}" title="${esc(u.note || '')}">${esc(u.tenantName || u.use)} ${esc((u.start || '').slice(2))}~${esc((u.end || '').slice(2))}${u.evidence && u.evidence.contract ? ' 📄' : ''}${u.evidence && u.evidence.report ? ' 🏛️' : ''}</span>`).join(' ');
      return `<tr>
        <td class="addr"><b>#${p.id} ${esc(propLabel(p))}</b><div class="sub">${esc(p.owner)} · ${esc(p.type)}${p.smallHouse ? ' · 소형' : ''}${p.disposeDate ? ` · 양도 ${esc(p.disposeDate)}` : ''}</div></td>
        <td style="white-space:nowrap">${esc(r.ownFrom.slice(5))}~${esc(r.ownTo.slice(5))}<div class="sub">${r.ownedDays}일</div></td>
        <td>${chips || '<span class="hint">계약 없음</span>'}</td>
        <td style="min-width:110px"><div class="tc-bar"><span style="width:${pct}%"></span></div><div class="sub">${pct}%${r.vacantDays ? ` (공실 ${r.vacantDays}일)` : ''}</div>
          ${r.gaps.map(g => `<div class="sub" style="color:var(--danger)">공백 ${esc(g[0].slice(5))}~${esc(g[1].slice(5))}</div>`).join('')}</td>
        <td style="text-align:right">${won(r.rent)}${r.rentBiz ? `<div class="sub">업무 ${won(r.rentBiz)}</div>` : ''}</td>
        <td style="text-align:right">${won(r.avgDeposit)}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td><button class="link-btn" data-tcedit="${p.id}">이력 편집</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">해당 연도에 보유한 물건이 없습니다.</td></tr>';
  }

  /* ---------- 해명 건 ---------- */

  function caseDue(c) { return ddayOf(c.due); }

  function renderCases() {
    const year = curYear();
    const cases = Store.data.taxCases || [];
    const box = $('#tcCases');
    if (!cases.length) {
      box.innerHTML = '<div class="empty">등록된 해명안내 건이 없습니다. 「+ 해명안내 건 등록」 또는 「건 파일 불러오기」를 사용하세요.</div>';
      return;
    }
    const propOptions = Store.data.properties
      .map(p => `<option value="${p.id}">#${p.id} ${esc(propLabel(p))}</option>`).join('');

    box.innerHTML = cases.map(c => {
      const cy = Number(c.year) || year;
      const its = (c.items || []).map(it => ({ it, y: itemYear(it, cy) }));
      const tot = its.reduce((s, x) => s + x.y.rent, 0);
      const done = its.filter(x => x.it.checks.reviewed).length;
      const dday = caseDue(c);
      return `<div class="panel tc-case" data-case="${c.id}">
        <div class="tc-case-head">
          <div>
            <h2 style="margin:0">📨 ${esc(c.office || '세무서')} · ${esc(c.docNo || '문서번호 미입력')}</h2>
            <div class="sub">${cy}년 귀속 · 담당 ${esc(c.officer || '-')} ${esc(c.phone || '')}${c.fax ? ` · FAX ${esc(c.fax)}` : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${c.due ? `<span>기한 ${esc(c.due)}</span> ${c.status === '제출 완료' || c.status === '종결' ? '<span class="badge green">제출</span>' : ddayBadge(dday)}` : ''}
            <select data-casefield="status">${CASE_STATUS.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row tc-case-meta">
          <label>문서번호 <input data-casefield="docNo" value="${esc(c.docNo)}"></label>
          <label>세무서 <input data-casefield="office" value="${esc(c.office)}"></label>
          <label>담당 조사관 <input data-casefield="officer" value="${esc(c.officer)}"></label>
          <label>전화 <input data-casefield="phone" value="${esc(c.phone)}"></label>
          <label>제출기한 <input type="date" data-casefield="due" value="${esc(c.due)}"></label>
          <label>귀속연도 <input type="number" data-casefield="year" value="${esc(c.year)}" style="width:90px"></label>
        </div>
        <div class="sub" style="margin:6px 0 10px">항목 ${its.length}건 · 검토완료 ${done}건 · 연결 물건 월세수입 합계 ${won(tot)}원</div>
        <div class="table-wrap"><table class="table tc-items">
          <thead><tr><th>코드</th><th>세무서 안내 소재지</th><th>연결 물건 / 수기 구간</th><th>월세수입</th><th>평균보증금</th><th>상태</th><th>증빙 체크</th><th>비고</th><th></th></tr></thead>
          <tbody>${its.map(({ it, y }) => `
            <tr data-item="${it.id}">
              <td><input class="tc-in" data-itemfield="code" value="${esc(it.code)}" style="width:52px"></td>
              <td><input class="tc-in" data-itemfield="address" value="${esc(it.address)}" style="min-width:220px">
                <div class="sub">${esc(it.kind || '')}${it.acquireDate ? ` · 취득 ${esc(it.acquireDate)}` : ''}${it.disposeDate ? ` · 양도 ${esc(it.disposeDate)}` : ''}</div></td>
              <td>${y.props.map(p => `<span class="tc-chip">#${p.id} ${esc(p.unit || propLabel(p))} <button class="link-btn" data-unlink="${p.id}" title="연결 해제">×</button></span>`).join(' ')}
                <select class="tc-in" data-link><option value="">+ 물건 연결</option>${propOptions}</select>
                ${!y.props.length ? `<div class="tc-manual">수기: <input type="date" data-manual="start" value="${esc(it.manual?.start)}"> ~ <input type="date" data-manual="end" value="${esc(it.manual?.end)}">
                  보증금 <input class="num" data-manual="deposit" value="${it.manual?.deposit ? won(it.manual.deposit) : ''}" style="width:110px">
                  월세 <input class="num" data-manual="monthlyRent" value="${it.manual?.monthlyRent ? won(it.manual.monthlyRent) : ''}" style="width:80px"></div>` : ''}</td>
              <td style="text-align:right">${won(y.rent)}</td>
              <td style="text-align:right">${won(y.avgDeposit)}</td>
              <td><span class="badge ${y.status.cls}">${y.status.label}</span></td>
              <td class="tc-checks">
                ${[['contract', '계약서'], ['payment', '입금내역'], ['report', '신고필증'], ['vacancy', '공실증빙'], ['sale', '양도서류'], ['reviewed', '검토완료']]
                  .map(([k, l]) => `<label><input type="checkbox" data-check="${k}" ${it.checks[k] ? 'checked' : ''}> ${l}</label>`).join('')}
              </td>
              <td><input class="tc-in" data-itemfield="note" value="${esc(it.note)}" style="min-width:160px"></td>
              <td><button class="link-btn" data-delitem style="color:var(--danger)">삭제</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="form-row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-caseact="additem">+ 항목 추가</button>
          <button class="btn btn-ghost btn-sm" data-caseact="csv">별첨 내역표 CSV</button>
          <button class="btn btn-ghost btn-sm" data-caseact="opinion">해명의견서 초안</button>
          <button class="btn btn-ghost btn-sm" data-caseact="todos">미비 항목 → 할일 등록</button>
          <button class="btn btn-ghost btn-sm" data-caseact="export">건 파일 저장(JSON)</button>
          <button class="btn btn-ghost btn-sm danger" data-caseact="delete">건 삭제</button>
        </div>
        <label class="wide" style="display:block;margin-top:8px;font-size:12px;color:var(--muted)">메모
          <textarea data-casefield="memo" rows="2" style="width:100%">${esc(c.memo)}</textarea></label>
      </div>`;
    }).join('');
  }

  function findCase(el) {
    const id = el.closest('[data-case]')?.dataset.case;
    return (Store.data.taxCases || []).find(c => c.id === id);
  }
  function findItem(c, el) {
    const id = el.closest('[data-item]')?.dataset.item;
    return c && (c.items || []).find(i => i.id === id);
  }
  function persist(rerender = true) {
    Store.save();
    if (rerender) { renderCases(); if (typeof renderDashboard === 'function') renderDashboard(); }
  }

  /* ---------- 산출물 ---------- */

  function caseCsv(c) {
    const year = Number(c.year) || curYear();
    const head = ['코드', '세무서 안내 소재지', '종류', '연결 물건', '임차인(귀속연도 계약)', '계약 구간', '보증금(원)', '월세(원)',
      '보유일수', '계약 커버일수', '공백 구간', `${year} 월세수입(일할,원)`, '평균보증금(원)', '상태', '비고'];
    const rows = [];
    (c.items || []).forEach(it => {
      const y = itemYear(it, year);
      if (y.rs.length) {
        y.rs.forEach(({ p, r }) => {
          const u = r.used;
          rows.push([it.code, it.address, it.kind || p.type, `#${p.id} ${propLabel(p)}`,
            u.map(x => x.tenantName || x.use).join(' / '),
            u.map(x => `${x.start}~${x.end || ''}`).join(' / '),
            u.map(x => x.deposit || 0).join(' / '), u.map(x => x.monthlyRent || 0).join(' / '),
            r.ownedDays, r.coveredDays, r.gaps.map(g => g.join('~')).join(' / '),
            Math.round(r.rent), Math.round(r.avgDeposit), statusOf(r).label, it.note || '']);
        });
      } else {
        const m = it.manual || {};
        rows.push([it.code, it.address, it.kind || '', '(수기)', m.tenantName || '', m.start ? `${m.start}~${m.end || ''}` : '',
          m.deposit || 0, m.monthlyRent || 0, y.manual ? y.manual.ownedDays : '', y.manual ? y.manual.coveredDays : '', '',
          Math.round(y.rent), Math.round(y.avgDeposit), y.status.label, it.note || '']);
      }
    });
    downloadCsv(`별첨_물건별내역표_${(c.docNo || 'case').replace(/[^\w가-힣-]/g, '')}_${year}`, [head, ...rows]);
  }

  function opinionText(c) {
    const year = Number(c.year) || curYear();
    const its = (c.items || []).map(it => ({ it, y: itemYear(it, year) }));
    const pf = portfolio(year, '');
    const rate = rateFor(year);
    const dm = deemedFromDays(pf.days, rate, 0);
    const rentSum = its.reduce((s, x) => s + x.y.rent, 0);
    const leased = its.filter(x => x.y.rent > 0 || x.y.avgDeposit > 0);
    const jeonse = its.filter(x => x.y.rent === 0 && x.y.avgDeposit > 0);
    const disposed = its.filter(x => x.it.disposeDate || x.y.props.some(p => p.disposeDate));
    const vacant = its.filter(x => x.y.rs.some(({ r }) => r.vacantDays > 0));
    const gaps = its.filter(x => x.y.gaps > 0);
    const biz = its.filter(x => x.y.rentBiz > 0);
    const L = [];
    L.push(`[납세자 해명 의견] 문서번호 ${c.docNo || '(미입력)'} / ${year}년 귀속 주택임대수입금액`);
    L.push('');
    L.push(`본인은 귀 서의 해명안내(문서번호 ${c.docNo || ''})에 따라 ${year}년 귀속 주택임대소득에 대하여 아래와 같이 해명합니다.`);
    L.push('');
    let no = 0;
    const N = () => `${++no}.`;
    L.push(`${N()} 임대 현황: 안내받은 ${its.length}개 소재지 중 ${leased.length}개 소재지는 임대차계약에 따라 임대하였으며, 물건별 계약기간·보증금·월세는 별첨 내역표와 같습니다.`);
    L.push(`   - ${year}년 월세 수입금액(일할 계산) 합계: ${won(rentSum)}원`);
    if (jeonse.length) L.push(`   - 월세 없이 보증금만 받은 주택(전세) ${jeonse.length}개 소재지: ${jeonse.map(x => x.it.code).join(', ')}`);
    L.push(`${N()} 간주임대료: 보증금 적수 기준 (일자별 보증금 합계 − 3억원) × 60% × 1/365 × ${rate}% 로 계산한 금액은 ${won(dm.deemed)}원이며, 금융수익 차감 전 금액입니다. 전용 40㎡ 이하·기준시가 2억원 이하 소형주택은 제외하였습니다.`);
    if (biz.length) L.push(`${N()} 업무용 임대: ${biz.map(x => x.it.code).join(', ')}는 업무시설로 임대하여 부가가치세 신고 및 사업소득으로 신고하였습니다.`);
    if (vacant.length) L.push(`${N()} 공실·자가사용: ${vacant.map(x => x.it.code).join(', ')}는 일부 기간 공실(또는 자가사용)이었으며, 관리비·공과금 내역을 첨부합니다.`);
    if (disposed.length) L.push(`${N()} 양도 주택: ${disposed.map(x => `${x.it.code}(${x.it.disposeDate || x.y.props.map(p => p.disposeDate).join(',')})`).join(', ')}는 양도일까지 받은 임대료만 수입금액에 포함하였습니다.`);
    L.push('');
    L.push('이상과 같이 해명하오니 제출한 증빙서류를 검토하여 주시기 바랍니다.');
    L.push('');
    L.push('[첨부] 1. 물건별 내역표  2. 임대차계약서 사본  3. 임대료 수취 금융거래내역  4. 임대사업자등록증  5. 임대차계약 신고필증(렌트홈)  6. 공실 증빙  7. 양도물건 매매계약서/등기부');
    if (gaps.length) {
      L.push('');
      L.push(`※ (제출 전 확인) 계약 공백이 남은 항목: ${gaps.map(x => x.it.code).join(', ')} — 이력 입력 또는 공실 증빙 후 다시 생성하세요.`);
    }
    return L.join('\n');
  }

  function addTodos(c) {
    const year = Number(c.year) || curYear();
    let n = 0;
    (c.items || []).forEach(it => {
      if (it.checks.reviewed) return;
      const y = itemYear(it, year);
      if (y.status.level < 2) return;
      const title = `[세무소명 ${c.docNo || ''}] ${it.code} ${it.address} — ${y.status.label}`;
      if (Store.data.todos.some(t => t.title === title && !t.done)) return;
      Store.data.todos.push({ id: Store.nextId(Store.data.todos), title, note: it.note || '계약서·입금내역 확보', due: c.due || '', done: false });
      n++;
    });
    Store.save();
    if (typeof renderTodos === 'function') renderTodos();
    if (typeof renderDashboard === 'function') renderDashboard();
    alert(n ? `할일 ${n}건을 등록했습니다.` : '새로 등록할 미비 항목이 없습니다.');
  }

  /* ---------- 건 파일 가져오기 ----------
   * { type: 'rems-taxcase', case: {...}, leaseHistory: [{ propId, start, end, ... }],
   *   propertyPatch: [{ propId, disposeDate, smallHouse, leaseUse }] }
   */
  function importCaseFile(obj) {
    if (!obj || obj.type !== 'rems-taxcase' || !obj.case) throw new Error('세무 소명 건 파일 형식이 아닙니다.');
    migrate(Store.data);
    const c = JSON.parse(JSON.stringify(obj.case));
    const existing = Store.data.taxCases.find(x => x.docNo && x.docNo === c.docNo);
    if (existing && !confirm(`같은 문서번호(${c.docNo}) 건이 있습니다. 덮어쓸까요?`)) return null;
    if (!c.id) c.id = uid();
    (c.items || []).forEach(it => { it.id = it.id || uid(); it.propIds = (it.propIds || []).filter(id => Store.data.properties.some(p => p.id === id)); it.checks = it.checks || {}; });
    if (existing) Object.assign(existing, c, { id: existing.id });
    else Store.data.taxCases.push(c);

    let added = 0;
    (obj.leaseHistory || []).forEach(h => {
      const p = Store.data.properties.find(x => x.id === h.propId);
      if (!p) return;
      const dup = p.leaseHistory.some(x => x.start === h.start && (x.tenantName || '') === (h.tenantName || ''));
      if (dup) return;
      const { propId, ...rest } = h;
      p.leaseHistory.push({ id: uid(), use: '주거', evidence: { contract: false, report: false }, ...rest });
      added++;
    });
    (obj.propertyPatch || []).forEach(pt => {
      const p = Store.data.properties.find(x => x.id === pt.propId);
      if (!p) return;
      if (pt.disposeDate) p.disposeDate = pt.disposeDate;
      if (pt.smallHouse != null) p.smallHouse = !!pt.smallHouse;
      if (pt.leaseUse && p.lease) p.lease.use = pt.leaseUse;
    });
    Store.save();
    return { items: (c.items || []).length, history: added };
  }

  function newCase() {
    const y = new Date().getFullYear() - 1;
    Store.data.taxCases.push({
      id: uid(), docNo: '', office: '', officer: '', phone: '', fax: '', year: y,
      due: '', status: CASE_STATUS[0], memo: '', items: [],
    });
    persist();
  }

  /* ---------- 이벤트 ---------- */

  function bind() {
    if (!$('#tab-taxcase')) return;
    ['tcYear'].forEach(id => $(`#${id}`).addEventListener('change', () => { $('#tcRate').value = rateFor(curYear()); render(); }));
    ['tcOwner', 'tcDeemed', 'tcFilter'].forEach(id => $(`#${id}`).addEventListener('change', renderCoverage));
    ['tcRate', 'tcFin'].forEach(id => $(`#${id}`).addEventListener('input', renderCoverage));

    $('#tcTable').addEventListener('click', e => {
      const id = e.target.dataset.tcedit;
      if (id) { openModal(Number(id)); setTimeout(() => $('#mHistorySection')?.scrollIntoView({ behavior: 'smooth' }), 100); }
    });

    $('#btnTcCsv').addEventListener('click', () => {
      const year = curYear();
      const pf = portfolio(year, $('#tcOwner').value);
      const head = ['#', '물건', '소유자', '유형', '보유 시작', '보유 종료', '보유일수', '커버일수', '공실일수', '공백 구간', '계약 구간',
        `${year} 주택 월세수입(일할)`, '업무용 임대수입', '평균보증금(적수/365)', '소형주택', '상태'];
      const rows = pf.rows.map(({ p, r }) => [p.id, propLabel(p), p.owner, p.type, r.ownFrom, r.ownTo, r.ownedDays, r.coveredDays, r.vacantDays,
        r.gaps.map(g => g.join('~')).join(' / '),
        r.used.map(u => `${u.tenantName || u.use} ${u.start}~${u.end || ''} ${u.deposit || 0}/${u.monthlyRent || 0}`).join(' / '),
        Math.round(r.rent), Math.round(r.rentBiz), Math.round(r.avgDeposit), p.smallHouse ? 'Y' : '', statusOf(r).label]);
      downloadCsv(`귀속연도_임대수입_${year}`, [head, ...rows]);
    });

    $('#btnTcNewCase').addEventListener('click', newCase);
    $('#tcImport').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const res = importCaseFile(JSON.parse(rd.result));
          if (res) { alert(`불러오기 완료: 항목 ${res.items}건, 임대차 이력 ${res.history}건 추가`); renderAll(); }
        } catch (err) { alert('불러오기 실패: ' + err.message); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });

    const box = $('#tcCases');
    box.addEventListener('change', e => {
      const c = findCase(e.target);
      if (!c) return;
      const t = e.target;
      if (t.dataset.casefield) {
        c[t.dataset.casefield] = t.dataset.casefield === 'year' ? Number(t.value) : t.value;
        if (t.dataset.casefield === 'status' && t.value === '제출 완료' && !c.submittedAt) c.submittedAt = ymd(new Date());
        return persist(t.dataset.casefield !== 'memo');
      }
      const it = findItem(c, t);
      if (!it) return;
      if (t.dataset.itemfield) { it[t.dataset.itemfield] = t.value; return persist(false); }
      if (t.dataset.check) { it.checks[t.dataset.check] = t.checked; return persist(); }
      if (t.dataset.manual) {
        it.manual = it.manual || {};
        it.manual[t.dataset.manual] = ['deposit', 'monthlyRent'].includes(t.dataset.manual) ? parseNum(t.value) : t.value;
        return persist();
      }
      if (t.hasAttribute('data-link') && t.value) {
        const pid = Number(t.value);
        if (!it.propIds.includes(pid)) it.propIds.push(pid);
        return persist();
      }
    });
    box.addEventListener('click', e => {
      const t = e.target;
      const c = findCase(t);
      if (!c) return;
      if (t.dataset.unlink) {
        const it = findItem(c, t);
        it.propIds = it.propIds.filter(id => id !== Number(t.dataset.unlink));
        return persist();
      }
      if (t.hasAttribute('data-delitem')) {
        if (!confirm('이 항목을 삭제할까요?')) return;
        const it = findItem(c, t);
        c.items = c.items.filter(x => x !== it);
        return persist();
      }
      const act = t.dataset.caseact;
      if (!act) return;
      if (act === 'additem') {
        c.items.push({ id: uid(), code: `A${String(c.items.length + 1).padStart(2, '0')}`, address: '', kind: '', propIds: [], manual: null, checks: {}, note: '' });
        persist();
      } else if (act === 'csv') caseCsv(c);
      else if (act === 'opinion') {
        const txt = opinionText(c);
        $('#tcOpinionText').value = txt;
        $('#tcOpinionBg').classList.remove('hidden');
      } else if (act === 'todos') addTodos(c);
      else if (act === 'export') {
        const blob = new Blob([JSON.stringify({ type: 'rems-taxcase', version: 1, case: c }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `세무소명_${(c.docNo || 'case').replace(/[^\w가-힣-]/g, '')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (act === 'delete') {
        if (!confirm('이 해명안내 건을 삭제할까요? (물건·임대차 이력은 유지됩니다)')) return;
        Store.data.taxCases = Store.data.taxCases.filter(x => x !== c);
        persist();
      }
    });

    $('#btnTcOpinionCopy').addEventListener('click', async () => {
      const v = $('#tcOpinionText').value;
      try { await navigator.clipboard.writeText(v); alert('복사했습니다.'); }
      catch (e) { $('#tcOpinionText').select(); document.execCommand('copy'); }
    });
    $('#btnTcOpinionTxt').addEventListener('click', () => downloadText('해명의견서_초안.txt', $('#tcOpinionText').value));
    $('#btnTcOpinionClose').addEventListener('click', () => $('#tcOpinionBg').classList.add('hidden'));
  }

  /* =========================================================
   * 물건 상세 모달: 임대차 이력 편집
   * ========================================================= */

  let modalHistory = [];

  function renderModalHistory() {
    const tb = $('#mHistoryTable tbody');
    if (!tb) return;
    tb.innerHTML = modalHistory.map((h, i) => `
      <tr data-hidx="${i}">
        <td><input type="date" data-h="start" value="${esc(h.start)}"></td>
        <td><input type="date" data-h="end" value="${esc(h.end)}"></td>
        <td><input data-h="tenantName" value="${esc(h.tenantName)}" style="width:80px"></td>
        <td><input class="num" data-h="deposit" value="${h.deposit ? won(h.deposit) : ''}" style="width:110px"></td>
        <td><input class="num" data-h="monthlyRent" value="${h.monthlyRent ? won(h.monthlyRent) : ''}" style="width:80px"></td>
        <td><select data-h="use">${USES.map(u => `<option ${u === h.use ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
        <td style="white-space:nowrap"><label title="계약서 확보"><input type="checkbox" data-hev="contract" ${h.evidence?.contract ? 'checked' : ''}>📄</label>
          <label title="임대차 신고필증"><input type="checkbox" data-hev="report" ${h.evidence?.report ? 'checked' : ''}>🏛️</label>
          <label title="추정 구간(원본 미확인)"><input type="checkbox" data-h="estimated" ${h.estimated ? 'checked' : ''}>추정</label></td>
        <td><input data-h="note" value="${esc(h.note)}" style="width:120px"></td>
        <td><button type="button" class="link-btn" data-hdel style="color:var(--danger)">×</button></td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty">이력이 없습니다. 종료된 과거 계약·공실 기간을 추가하세요.</td></tr>';
  }

  function onModalOpen(p) {
    modalHistory = p ? (p.leaseHistory || []).map(h => ({ ...h, evidence: { ...(h.evidence || {}) } })) : [];
    if ($('#mDisposeDate')) $('#mDisposeDate').value = p?.disposeDate || '';
    if ($('#mSmallHouse')) $('#mSmallHouse').checked = !!p?.smallHouse;
    if ($('#mLeaseUse')) $('#mLeaseUse').value = p?.lease?.use || '주거';
    if ($('#mLeaseContract')) $('#mLeaseContract').checked = p?.lease ? (p.lease.evidence ? !!p.lease.evidence.contract : true) : true;
    if ($('#mLeaseReport')) $('#mLeaseReport').checked = !!p?.lease?.evidence?.report;
    renderModalHistory();
  }

  /** 저장 시 모달 값 반영 (app.js 저장 로직 이후 호출) */
  function onModalSave(prop) {
    if (!prop) return;
    if ($('#mDisposeDate')) prop.disposeDate = $('#mDisposeDate').value || '';
    if ($('#mSmallHouse')) prop.smallHouse = !!$('#mSmallHouse').checked;
    if (prop.lease) {
      if ($('#mLeaseUse')) prop.lease.use = $('#mLeaseUse').value || '주거';
      prop.lease.evidence = { contract: !!$('#mLeaseContract')?.checked, report: !!$('#mLeaseReport')?.checked };
    }
    if (window.__REMS_ROLE__ !== 'agent') {
      prop.leaseHistory = modalHistory
        .filter(h => h.start)
        .map(h => ({ ...h, id: h.id || uid() }))
        .sort((a, b) => a.start.localeCompare(b.start));
    }
  }

  function bindModal() {
    const tb = $('#mHistoryTable');
    if (!tb) return;
    tb.addEventListener('change', e => {
      const tr = e.target.closest('[data-hidx]');
      if (!tr) return;
      const h = modalHistory[Number(tr.dataset.hidx)];
      const t = e.target;
      if (t.dataset.hev) { h.evidence = h.evidence || {}; h.evidence[t.dataset.hev] = t.checked; return; }
      const k = t.dataset.h;
      if (!k) return;
      if (k === 'estimated') h.estimated = t.checked;
      else if (k === 'deposit' || k === 'monthlyRent') h[k] = parseNum(t.value);
      else h[k] = t.value;
    });
    tb.addEventListener('click', e => {
      if (!e.target.hasAttribute('data-hdel')) return;
      modalHistory.splice(Number(e.target.closest('[data-hidx]').dataset.hidx), 1);
      renderModalHistory();
    });
    $('#btnAddHistory').addEventListener('click', () => {
      modalHistory.push({ id: uid(), start: '', end: '', tenantName: '', deposit: 0, monthlyRent: 0, use: '주거', evidence: { contract: false, report: false }, note: '' });
      renderModalHistory();
    });
    $('#btnLeaseToHistory').addEventListener('click', () => {
      if (!$('#mHasLease').checked || !$('#mLeaseStart').value) { alert('이력으로 보낼 현재 계약이 없습니다.'); return; }
      modalHistory.push({
        id: uid(), start: $('#mLeaseStart').value, end: $('#mLeaseEnd').value,
        tenantName: $('#mTenant').value.trim(), deposit: parseNum($('#mDeposit').value), monthlyRent: parseNum($('#mMonthly').value),
        use: $('#mLeaseUse')?.value || '주거',
        evidence: { contract: !!$('#mLeaseContract')?.checked, report: !!$('#mLeaseReport')?.checked }, note: '종료 계약',
      });
      ['mLeaseStart', 'mLeaseEnd', 'mDeposit', 'mMonthly', 'mTenant', 'mTenantPhone'].forEach(id => { $('#' + id).value = ''; });
      if ($('#mLeaseReport')) $('#mLeaseReport').checked = false;
      renderModalHistory();
      $('#mLeaseStart').focus();
    });
  }

  /* ---------- 대시보드용 ---------- */

  function openCases() {
    return (Store.data.taxCases || []).filter(c => !['제출 완료', '종결'].includes(c.status));
  }

  window.TaxCase = {
    migrate, propPeriods, yearCalc, deemedFromDays, propYear, portfolio, itemYear, statusOf,
    render, renderCoverage, onModalOpen, onModalSave, importCaseFile, opinionText, openCases, rateFor,
  };

  bind();
  bindModal();
})();
