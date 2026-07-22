/* =========================================================
 * data.js - 초기(샘플) 데이터 및 저장소
 * ========================================================= */

const STORAGE_KEY = 'rems_data_v3';
const SNAPSHOT_KEY = 'rems_snapshots_v1';

/* =========================================================
 * ⚠️ 공개 배포(웹 서비스)용 초기 데이터는 모두 "가상 샘플"입니다.
 *    실제 데이터는 좌측 하단 "백업 불러오기"로 본인 PC의 JSON을 불러와
 *    각자의 브라우저(localStorage)에만 저장하여 사용하세요.
 * ========================================================= */

/** 임대사업자 정보 (샘플) */
const SEED_BUSINESS = [
  { owner: '홍길동', regNo: '2020-○○시-임대사업자-0000', bizNo: '000-00-00000' },
];

/**
 * 부동산 물건 초기 데이터
 * type: 아파트 | 오피스텔 | 빌라(다세대) | 오피스 | 토지
 * rentalType: 주택임대사업자(n년) | 임대사업자(일반) | 일반 | ''
 * lease: 현재 임대차 계약 (없으면 null)
 */
const SEED_PROPERTIES = [
  { id: 1, owner: '홍길동', type: '아파트', rentalType: '주택임대사업자(10년)', acquireYear: '2021', regDate: '2021-03-15', acquireDate: '2021-03-15', acquirePrice: 600000000, rentStartDate: '2021-04-01', address: '서울특별시 ○○구 샘플로 100 예시아파트', unit: '101동 1001호', priceHistory: [{ year: 2024, price: 450000000 }, { year: 2025, price: 480000000 }], lease: { start: '2024-04-01', end: '2026-03-31', deposit: 300000000, monthlyRent: 0, tenantName: '임차인A', tenantPhone: '010-0000-0001', insurance: { joined: true, period: '24.04~26.03', fee: 600000, tenantShare: 150000 } }, memo: '샘플 데이터입니다.' },
  { id: 2, owner: '홍길동', type: '오피스텔', rentalType: '주택임대사업자(8년)', acquireYear: '2022', regDate: '2022-06-10', acquireDate: '2022-06-10', acquirePrice: 250000000, rentStartDate: '2022-07-01', address: '경기도 ○○시 예시대로 45 샘플오피스텔', unit: 'A동 502호', priceHistory: [{ year: 2025, price: 180000000 }], lease: { start: '2024-07-01', end: '2026-06-30', deposit: 50000000, monthlyRent: 700000, tenantName: '임차인B', tenantPhone: '010-0000-0002', insurance: { joined: false, period: '', fee: 0, tenantShare: 0 } }, memo: '' },
  { id: 3, owner: '홍길동', type: '빌라(다세대)', rentalType: '일반', acquireYear: '2019', regDate: '', acquireDate: '2019-09-01', acquirePrice: 200000000, rentStartDate: '', address: '서울특별시 ○○구 보기길 12 예시빌라', unit: '301호', priceHistory: [], lease: { start: '2023-09-01', end: '2025-08-31', deposit: 180000000, monthlyRent: 0, tenantName: '임차인C', tenantPhone: '010-0000-0003', insurance: { joined: false, period: '', fee: 0, tenantShare: 0 } }, memo: '계약 만기 임박 예시' },
  { id: 4, owner: '홍길동', type: '오피스텔', rentalType: '주택임대사업자(6년)', acquireYear: '2024', regDate: '2024-02-20', acquireDate: '2024-02-20', acquirePrice: 220000000, rentStartDate: '', address: '인천광역시 ○○구 테스트로 9 데모타워', unit: '1203호', priceHistory: [], lease: null, memo: '공실(임차인 모집 예시)' },
  { id: 5, owner: '홍길동', type: '토지', rentalType: '', acquireYear: '2015', regDate: '', acquireDate: '2015-05-01', acquirePrice: 90000000, rentStartDate: '', address: '충청남도 ○○시 ○○읍 예시리 100-1 전 800㎡', unit: '', priceHistory: [], lease: null, memo: '' },
];

/** 할일(민원처리) 초기 데이터 (샘플) */
const SEED_TODOS = [
  { id: 1, title: '예시아파트 임대차 계약 만기 갱신 통지', note: '만기 6개월 전 통지', due: '2025-10-01', done: false },
  { id: 2, title: '예시빌라 보증보험 가입 검토', note: '미가입 물건 점검', due: '', done: false },
  { id: 3, title: '데모타워 임차인 모집', note: '공실 해소', due: '', done: false },
];

/* ---------- 저장소 ----------
 * 데스크톱 프로그램(pywebview)에서는 exe 옆 JSON 파일에,
 * 브라우저에서는 localStorage에 저장합니다.
 */

const Store = {
  data: null,

  isDesktop() {
    return !!(window.pywebview && window.pywebview.api);
  },

  seedData() {
    return {
      business: SEED_BUSINESS,
      properties: SEED_PROPERTIES,
      todos: SEED_TODOS,
      accounts: [], // 공인중개사 계정 [{ id, name, pw }]
      settings: { kakaoKey: '', deemedRate: 3.5 },
    };
  },

  /** 구버전 데이터에 신규 필드(취득가액·공시가격 이력 등)를 채워 호환성 유지 */
  migrate() {
    const d = this.data;
    if (!d.settings) d.settings = {};
    if (d.settings.deemedRate == null) d.settings.deemedRate = 3.5;
    if (d.settings.kakaoKey == null) d.settings.kakaoKey = '';
    if (!Array.isArray(d.accounts)) d.accounts = []; // 공인중개사 계정
    if (!d.meta) d.meta = { updatedAt: 0 };          // 동기화 비교용 수정 시각
    if (d.settings.ghToken == null) d.settings.ghToken = ''; // 클라우드 동기화 토큰
    (d.properties || []).forEach(p => {
      if (p.acquirePrice == null) p.acquirePrice = 0;       // 취득가액
      if (p.acquireDate == null) p.acquireDate = '';         // 취득일(정확한 날짜)
      if (!Array.isArray(p.priceHistory)) p.priceHistory = []; // 연도별 공시가격 [{year, price}]
      if (p.managerId == null) p.managerId = '';             // 관리 공인중개사 계정 id
      if (p.lease && p.lease.insurance) {
        const ins = p.lease.insurance;
        if (ins.coverage == null) ins.coverage = ins.joined ? 'full' : '';
        if (ins.company == null) ins.company = '';
        if (ins.reason == null) ins.reason = '';
        if (ins.note == null) ins.note = '';
      }
    });
  },

  async load() {
    if (this.isDesktop()) {
      let raw = null;
      try { raw = await window.pywebview.api.load_data(); } catch (e) {}
      let loaded = null;
      if (raw) { try { loaded = JSON.parse(raw); } catch (e) {} }
      this.data = loaded || this.seedData();
      this.migrate();
      this.save(false);
      return;
    }

    // 브라우저: localStorage와 내장 DB(IndexedDB) 중 더 최신 데이터 사용
    let fromLocal = null;
    try { fromLocal = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
    if (!fromLocal || !fromLocal.properties) {
      // 과거 저장 키 폴백 (키가 바뀌어도 데이터 유실 방지)
      for (const k of ['rems_data_v2', 'rems_data_v1']) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          if (v && v.properties) { fromLocal = v; break; }
        } catch (e) {}
      }
    }
    let fromDb = null;
    if (window.REMSDB) fromDb = await REMSDB.get(REMSDB.dataKey());

    const up = d => (d && d.meta && d.meta.updatedAt) || 0;
    let pick = (fromLocal && fromLocal.properties) ? fromLocal : null;
    // 동률이면 localStorage 우선(로그인 직후 auth.js가 기록한 최신 선택본)
    if (fromDb && fromDb.properties && (!pick || up(fromDb) > up(pick))) pick = fromDb;

    this.data = pick || this.seedData();
    this.migrate();

    // 스냅샷도 DB 사본으로 복원 (localStorage가 비워진 경우)
    try {
      if (!localStorage.getItem(SNAPSHOT_KEY) && window.REMSDB) {
        const snaps = await REMSDB.get(REMSDB.snapKey());
        if (Array.isArray(snaps) && snaps.length) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snaps));
      }
    } catch (e) {}

    this.save(false); // 선택된 데이터를 양쪽 저장소에 다시 기록
  },

  /**
   * @param touch true(기본)면 사용자 수정으로 간주:
   *              수정시각 갱신 + 자동 스냅샷 + 클라우드 업로드 예약
   */
  save(touch = true) {
    if (touch && this.data) {
      if (!this.data.meta) this.data.meta = {};
      this.data.meta.updatedAt = Date.now();
      this.autoSnapshot();
    }
    const json = JSON.stringify(this.data);
    if (this.isDesktop()) {
      window.pywebview.api.save_data(JSON.stringify(this.data, null, 2));
    } else {
      localStorage.setItem(STORAGE_KEY, json);
      // 내장 DB(IndexedDB)에도 이중 저장: 앱이 바뀌어도 데이터 유지
      if (window.REMSDB) REMSDB.set(REMSDB.dataKey(), JSON.parse(json));
    }
    if (touch && window.REMSSync) REMSSync.schedulePush();
  },

  /* ---------- 자동 스냅샷 (실수 복구용, 브라우저 전용) ---------- */

  listSnapshots() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]'); }
    catch (e) { return []; }
  },

  /** 현재 데이터를 스냅샷으로 보관 (최대 10개) */
  snapshot(label) {
    if (this.isDesktop() || !this.data) return;
    try {
      const list = this.listSnapshots();
      list.unshift({ t: Date.now(), label: label || '자동', json: JSON.stringify(this.data) });
      const trimmed = list.slice(0, 10);
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(trimmed));
      if (window.REMSDB) REMSDB.set(REMSDB.snapKey(), trimmed); // DB에도 사본 보관
    } catch (e) { /* 저장소 부족 시 무시 */ }
  },

  /** 30분에 1개꼴로만 자동 스냅샷을 남김 */
  autoSnapshot() {
    const list = this.listSnapshots();
    if (list.length && Date.now() - list[0].t < 30 * 60 * 1000) return;
    this.snapshot('자동');
  },

  restoreSnapshot(t) {
    const s = this.listSnapshots().find(x => x.t === t);
    if (!s) return false;
    this.snapshot('복원 직전');
    this.data = JSON.parse(s.json);
    this.migrate();
    this.save();
    return true;
  },

  nextId(list) {
    return list.length ? Math.max(...list.map(x => x.id)) + 1 : 1;
  },

  exportJson() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `부동산관리_백업_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importJson(file, onDone) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.properties) throw new Error('형식 오류');
        this.data = parsed;
        this.migrate();
        this.save();
        onDone(true);
      } catch (e) {
        onDone(false);
      }
    };
    reader.readAsText(file);
  },

  reset() {
    this.snapshot('재설정 직전'); // 실수 복구용
    if (!this.isDesktop()) localStorage.removeItem(STORAGE_KEY);
    this.data = this.seedData();
    this.migrate();
    this.save();
  },
};
