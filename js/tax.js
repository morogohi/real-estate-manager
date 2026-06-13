/* =========================================================
 * tax.js - 취득세 / 보유세(재산세·종부세) / 양도소득세 계산
 *
 * ※ 2025년 기준 세율을 반영한 "예상치" 계산기입니다.
 *    실제 신고·납부 시에는 반드시 세무 전문가 확인이 필요합니다.
 * ========================================================= */

const Tax = {};

/* ---------- 공통 유틸 ---------- */

Tax.won = n => Math.round(n).toLocaleString('ko-KR') + '원';

/* =========================================================
 * 1. 취득세
 * ========================================================= */

/**
 * @param {object} p
 *  - kind: 'house' | 'officetel' | 'land' | 'building'  (officetel은 건축물 취득 4%)
 *  - cause: 'buy' | 'new' | 'inherit' | 'gift'
 *  - price: 취득가액(원)
 *  - houseCount: 취득 후 보유 주택 수 (주택 유상취득 시)
 *  - adjusted: 조정대상지역 여부
 *  - over85: 전용면적 85㎡ 초과 여부
 */
Tax.acquisition = function (p) {
  let rate = 0;        // 취득세율 (%)
  let eduRate = 0;     // 지방교육세율 (%)
  let ruralRate = 0;   // 농어촌특별세율 (%)
  let note = '';

  if (p.kind === 'house' && p.cause === 'buy') {
    const heavy12 = (p.adjusted && p.houseCount >= 3) || (!p.adjusted && p.houseCount >= 4);
    const heavy8 = !heavy12 && ((p.adjusted && p.houseCount === 2) || (!p.adjusted && p.houseCount === 3));

    if (heavy12) {
      rate = 12; eduRate = 0.4; ruralRate = p.over85 ? 1.0 : 0;
      note = '다주택 중과세율 12% 적용';
    } else if (heavy8) {
      rate = 8; eduRate = 0.4; ruralRate = p.over85 ? 0.6 : 0;
      note = '다주택 중과세율 8% 적용';
    } else {
      if (p.price <= 600_000_000) rate = 1;
      else if (p.price <= 900_000_000) rate = (p.price * 2 / 300_000_000) - 3; // 6~9억 구간 사잇세율
      else rate = 3;
      eduRate = rate / 10;                 // 표준세율의 1/2 × 20%
      ruralRate = p.over85 ? 0.2 : 0;
      note = '주택 유상취득 표준세율(1~3%)';
    }
  } else if (p.kind === 'house' && p.cause === 'gift') {
    if (p.adjusted && p.price >= 300_000_000) {
      rate = 12; eduRate = 0.4; ruralRate = p.over85 ? 1.0 : 0;
      note = '조정대상지역 공시 3억 이상 주택 증여 중과(12%)';
    } else {
      rate = 3.5; eduRate = 0.3; ruralRate = p.over85 ? 0.2 : 0;
      note = '증여 취득(3.5%)';
    }
  } else if (p.cause === 'new') {
    rate = 2.8; eduRate = 0.16; ruralRate = p.over85 ? 0.2 : 0;
    note = '원시취득(신축, 2.8%)';
  } else if (p.cause === 'inherit') {
    rate = 2.8; eduRate = 0.16; ruralRate = 0.2;
    note = '상속 취득(2.8%)';
  } else {
    // 오피스텔(건축물 취득) / 토지 / 일반 건물 / 주택 외 증여 등
    rate = p.cause === 'gift' ? 3.5 : 4;
    eduRate = rate === 4 ? 0.4 : 0.3;
    ruralRate = 0.2;
    note = p.kind === 'officetel'
      ? '오피스텔은 주택이 아닌 건축물로 보아 4% 적용 (주거용 사용 여부와 무관)'
      : '일반 부동산(토지·건물) 4% 적용';
  }

  const acqTax = p.price * rate / 100;
  const eduTax = p.price * eduRate / 100;
  const ruralTax = p.price * ruralRate / 100;

  return {
    rate, note,
    acqTax, eduTax, ruralTax,
    total: acqTax + eduTax + ruralTax,
  };
};

/* =========================================================
 * 2. 보유세 (재산세 + 종합부동산세)
 * ========================================================= */

/** 주택 재산세 (물건별 과세) */
Tax.propertyTax = function (officialPrice, isOneHouseSpecial) {
  // 공정시장가액비율: 일반 60%, 1주택 특례(공시 9억 이하) 43~45%
  let ratio = 0.60;
  if (isOneHouseSpecial) {
    if (officialPrice <= 300_000_000) ratio = 0.43;
    else if (officialPrice <= 600_000_000) ratio = 0.44;
    else ratio = 0.45;
  }
  const base = officialPrice * ratio;

  // 누진세율 (주택)
  let tax;
  if (base <= 60_000_000) tax = base * 0.001;
  else if (base <= 150_000_000) tax = 60_000 + (base - 60_000_000) * 0.0015;
  else if (base <= 300_000_000) tax = 195_000 + (base - 150_000_000) * 0.0025;
  else tax = 570_000 + (base - 300_000_000) * 0.004;

  const urbanTax = base * 0.0014;   // 도시지역분
  const eduTax = tax * 0.20;        // 지방교육세

  return { base, ratio, tax, urbanTax, eduTax, total: tax + urbanTax + eduTax };
};

/** 종합부동산세 (인별 합산) */
Tax.jongbuTax = function (sumOfficialPrice, isOneHouse, houseCount, excludedPrice) {
  // 합산배제(등록임대주택 등) 공시가격 제외
  const taxableSum = Math.max(0, sumOfficialPrice - (excludedPrice || 0));
  const deduction = isOneHouse ? 1_200_000_000 : 900_000_000;
  const base = Math.max(0, (taxableSum - deduction)) * 0.60; // 공정시장가액비율 60%

  if (base <= 0) {
    return { base: 0, tax: 0, ruralTax: 0, total: 0, taxableSum, deduction };
  }

  // 세율표 [상한, 세율] - 2주택 이하 / 3주택 이상(과표 12억 초과분 중과)
  const normal = [
    [300_000_000, 0.005], [600_000_000, 0.007], [1_200_000_000, 0.010],
    [2_500_000_000, 0.013], [5_000_000_000, 0.015], [9_400_000_000, 0.020],
    [Infinity, 0.027],
  ];
  const heavy = [
    [300_000_000, 0.005], [600_000_000, 0.007], [1_200_000_000, 0.010],
    [2_500_000_000, 0.020], [5_000_000_000, 0.030], [9_400_000_000, 0.040],
    [Infinity, 0.050],
  ];
  const table = houseCount >= 3 ? heavy : normal;

  let tax = 0, prev = 0;
  for (const [cap, r] of table) {
    if (base > cap) { tax += (cap - prev) * r; prev = cap; }
    else { tax += (base - prev) * r; break; }
  }

  const ruralTax = tax * 0.20; // 농어촌특별세
  return { base, tax, ruralTax, total: tax + ruralTax, taxableSum, deduction };
};

/* =========================================================
 * 3. 양도소득세
 * ========================================================= */

/** 종합소득세 기본세율 (2023~) */
Tax.basicRate = function (base) {
  const table = [
    [14_000_000, 0.06, 0],
    [50_000_000, 0.15, 1_260_000],
    [88_000_000, 0.24, 5_760_000],
    [150_000_000, 0.35, 15_440_000],
    [300_000_000, 0.38, 19_940_000],
    [500_000_000, 0.40, 25_940_000],
    [1_000_000_000, 0.42, 35_940_000],
    [Infinity, 0.45, 65_940_000],
  ];
  for (const [cap, rate, deduct] of table) {
    if (base <= cap) return { rate, deduct };
  }
};

/**
 * @param {object} p
 *  - salePrice, buyPrice, expense: 양도가액 / 취득가액 / 필요경비(원)
 *  - buyDate, saleDate: 'YYYY-MM-DD'
 *  - isHouse: 주택(입주권 포함) 여부
 *  - oneHouseExempt: 1세대1주택 비과세 적용 여부 (12억 초과분만 과세)
 *  - residenceYears: 거주기간(년, 1주택 장특공제용)
 *  - heavySurcharge: 0 | 20 | 30  (다주택 중과 %p, 현재 중과 유예시 0)
 */
Tax.transfer = function (p) {
  const buy = new Date(p.buyDate);
  const sale = new Date(p.saleDate);
  const holdYears = Math.floor((sale - buy) / (365.25 * 24 * 3600 * 1000));

  let gain = p.salePrice - p.buyPrice - p.expense;
  if (gain <= 0) {
    return { holdYears, gain, taxable: 0, tax: 0, localTax: 0, total: 0, note: '양도차익이 없어 납부세액이 없습니다.' };
  }

  let note = [];

  // 1세대1주택 비과세 (12억 이하 전액 비과세, 초과분 안분)
  if (p.oneHouseExempt) {
    if (p.salePrice <= 1_200_000_000) {
      return { holdYears, gain, taxable: 0, tax: 0, localTax: 0, total: 0, note: '1세대1주택 비과세 (양도가액 12억 이하)' };
    }
    gain = gain * (p.salePrice - 1_200_000_000) / p.salePrice;
    note.push('1세대1주택 고가주택: 12억 초과분만 과세');
  }

  // 장기보유특별공제
  let ltDeductRate = 0;
  if (holdYears >= 3 && p.heavySurcharge === 0) {
    if (p.oneHouseExempt) {
      const holdRate = Math.min(holdYears, 10) * 0.04;
      const resRate = Math.min(p.residenceYears || 0, 10) * 0.04;
      ltDeductRate = Math.min(holdRate + resRate, 0.80);
      note.push(`장특공제(1주택 보유+거주) ${(ltDeductRate * 100).toFixed(0)}%`);
    } else {
      ltDeductRate = Math.min(holdYears, 15) * 0.02;
      note.push(`장특공제(일반) ${(ltDeductRate * 100).toFixed(0)}%`);
    }
  }
  const ltDeduct = gain * ltDeductRate;

  const taxable = Math.max(0, gain - ltDeduct - 2_500_000); // 기본공제 250만원

  // 세율 결정
  let tax;
  if (p.isHouse && holdYears < 1) {
    tax = taxable * 0.70; note.push('주택 1년 미만 보유: 70% 단일세율');
  } else if (p.isHouse && holdYears < 2) {
    tax = taxable * 0.60; note.push('주택 1~2년 보유: 60% 단일세율');
  } else if (!p.isHouse && holdYears < 1) {
    tax = taxable * 0.50; note.push('1년 미만 보유: 50% 단일세율');
  } else if (!p.isHouse && holdYears < 2) {
    tax = taxable * 0.40; note.push('1~2년 보유: 40% 단일세율');
  } else {
    const { rate, deduct } = Tax.basicRate(taxable);
    const surcharge = (p.heavySurcharge || 0) / 100;
    tax = taxable * (rate + surcharge) - deduct;
    note.push(`기본세율 ${(rate * 100).toFixed(0)}%${surcharge ? ` + 중과 ${p.heavySurcharge}%p` : ''} (누진공제 ${Tax.won(deduct)})`);
  }
  tax = Math.max(0, tax);

  const localTax = tax * 0.10; // 지방소득세

  return {
    holdYears, gain, ltDeduct, ltDeductRate, taxable,
    tax, localTax, total: tax + localTax,
    note: note.join(' / '),
  };
};

/* =========================================================
 * 4. 임대료 5% 증액 상한 계산 (등록임대주택)
 * ========================================================= */

Tax.rentIncrease = function (deposit, monthlyRent, ratePct) {
  const r = (ratePct == null ? 5 : ratePct) / 100;
  return {
    maxDeposit: deposit * (1 + r),
    maxMonthly: monthlyRent * (1 + r),
    addDeposit: deposit * r,
    addMonthly: monthlyRent * r,
  };
};

/* =========================================================
 * 5. 주택임대소득 (소득현황·사업장현황 신고용)
 *  - 월세 연수입 + 보증금 간주임대료 = 총 수입금액(추정)
 * ========================================================= */

/**
 * 간주임대료 (보증금 등에 대한 추정 임대수입)
 * 적용대상: 부부합산 3주택 이상 보유자의 보증금 합계 3억원 초과분
 *   간주임대료 = (보증금 합계 - 3억원) × 60% × 정기예금이자율
 * (소형주택 제외·금융수익 차감 등은 미반영한 개략 계산)
 *
 * @param {number} depositSum 임대보증금 합계(원)
 * @param {number} ratePct    정기예금이자율(%)  (2024 귀속 3.5%)
 * @param {boolean} apply     3주택 이상 등 적용 대상 여부
 */
Tax.deemedRent = function (depositSum, ratePct, apply) {
  if (!apply) return { applied: false, base: 0, deemed: 0 };
  const base = Math.max(0, depositSum - 300_000_000);
  const deemed = base * 0.60 * ((ratePct == null ? 3.5 : ratePct) / 100);
  return { applied: true, base, deemed };
};

/**
 * 임대수입 요약
 * @param {Array} leases [{deposit, monthlyRent}]
 * @param {number} ratePct 간주임대료 이자율(%)
 * @param {boolean} deemedApply 간주임대료 적용 여부(3주택 이상)
 */
Tax.rentalIncome = function (leases, ratePct, deemedApply) {
  const depositSum = leases.reduce((s, l) => s + (l.deposit || 0), 0);
  const monthlySum = leases.reduce((s, l) => s + (l.monthlyRent || 0), 0);
  const yearlyRent = monthlySum * 12;
  const d = Tax.deemedRent(depositSum, ratePct, deemedApply);
  return {
    depositSum, monthlySum, yearlyRent,
    deemed: d.deemed, deemedApplied: d.applied,
    total: yearlyRent + d.deemed,
  };
};
