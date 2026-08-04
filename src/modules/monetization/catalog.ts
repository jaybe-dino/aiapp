// 수익화 카탈로그 어댑터.
// 지금은 '샘플' 소스(sampleOfferSource)로 동작하고, 나중에 실제 제휴 API(LinkPrice·쿠팡파트너스·
// 오퍼월 SDK·렌탈 제휴망 등)를 같은 OfferSource 인터페이스로 구현해 갈아끼우면 된다.
// syncCatalog(source)가 소스의 공급사·오퍼를 DB에 멱등 upsert 하므로 커머셜 엔진은 그대로 동작.
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";

export interface SampleSupplier {
  id: string;
  name: string;
  type: "shopping_cps" | "offerwall_cpa" | "walk_ad" | "rental_cpa";
  rewardTrafficAllowed: boolean; // false면 사용자에게 리워드 노출 안 함(예: 쿠팡파트너스 정책)
  hmacSecret: string; // 포스트백 서명 검증용(공급사별 분리 권장)
}
export interface SampleOffer {
  offerId: string;
  supplierId: string;
  category: "travel" | "shopping" | "survey" | "finance" | "rental";
  title: string;
  advertiserName: string;
  landingDomain: string;
  priceBand: "low" | "mid" | "high";
  highRisk: boolean;
  totalCost: number;
  rewardAmount: number; // 유효 전환 시 사용자 보상(원)
  commissionAmount: number; // 플랫폼 수수료(원) — 유닛이코노믹스 = 수수료 - 보상
  approvalWindow: string;
  cancelTerms: string;
  autoRenewal: boolean;
  dataSharing: string;
  monthlyFee?: number;
  contractMonths?: number;
  mandatoryMonths?: number;
}
export interface OfferSource {
  name: string;
  suppliers(): SampleSupplier[];
  offers(): SampleOffer[];
}

const SECRET = "dev-supplier-secret-change-me"; // 샘플 공통. 운영에선 공급사별 환경변수.

const SAMPLE_SUPPLIERS: SampleSupplier[] = [
  { id: "sup_linkprice", name: "LinkPrice", type: "shopping_cps", rewardTrafficAllowed: true, hmacSecret: SECRET },
  { id: "sup_offerwall", name: "리워드오퍼월", type: "offerwall_cpa", rewardTrafficAllowed: true, hmacSecret: SECRET },
  { id: "sup_walk_adnet", name: "걷기광고망", type: "walk_ad", rewardTrafficAllowed: true, hmacSecret: SECRET },
  { id: "sup_rental", name: "렌탈제휴망", type: "rental_cpa", rewardTrafficAllowed: true, hmacSecret: SECRET },
  { id: "sup_coupang", name: "쿠팡파트너스", type: "shopping_cps", rewardTrafficAllowed: false, hmacSecret: SECRET },
  // 토스쇼핑 쉐어링크(클릭 후 24시간 내 결제 시 결제액 10% 수익) — sharelink.ts 어댑터로 실연동.
  { id: "sup_toss_sharelink", name: "토스쇼핑 쉐어링크", type: "shopping_cps", rewardTrafficAllowed: true, hmacSecret: SECRET },
];

const SAMPLE_OFFERS: SampleOffer[] = [
  // 여행
  { offerId: "off_busan_hotel", supplierId: "sup_linkprice", category: "travel", title: "부산 해운대 호텔 2박", advertiserName: "○○여행", landingDomain: "travel.example.com", priceBand: "high", highRisk: false, totalCost: 180000, rewardAmount: 4000, commissionAmount: 9000, approvalWindow: "여행 종료 후 7~14일", cancelTerms: "체크인 3일 전까지 무료 취소, 이후 적립 취소", autoRenewal: false, dataSharing: "없음" },
  { offerId: "off_jeju_air", supplierId: "sup_linkprice", category: "travel", title: "제주 왕복 항공권 특가", advertiserName: "◎◎항공", landingDomain: "travel.example.com", priceBand: "mid", highRisk: false, totalCost: 98000, rewardAmount: 2500, commissionAmount: 6000, approvalWindow: "탑승 후 7~14일", cancelTerms: "출발 7일 전까지 무료 취소", autoRenewal: false, dataSharing: "없음" },
  // 쇼핑
  { offerId: "off_shopping_air", supplierId: "sup_linkprice", category: "shopping", title: "공기청정기 필터 정기배송", advertiserName: "△△리빙", landingDomain: "shop.example.com", priceBand: "mid", highRisk: false, totalCost: 39000, rewardAmount: 1200, commissionAmount: 2600, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: true, dataSharing: "없음" },
  { offerId: "off_health_food", supplierId: "sup_linkprice", category: "shopping", title: "홍삼정 선물세트", advertiserName: "▽▽헬스", landingDomain: "shop.example.com", priceBand: "mid", highRisk: false, totalCost: 59000, rewardAmount: 1800, commissionAmount: 4000, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  // 토스쇼핑 쉐어링크 상품(시니어 인기 카테고리) — 보상 ≈ 결제액 5%(수익 10%의 절반 환원)
  { offerId: "off_toss_redginseng", supplierId: "sup_toss_sharelink", category: "shopping", title: "홍삼스틱 30포", advertiserName: "토스쇼핑", landingDomain: "link.tossshop.example", priceBand: "low", highRisk: false, totalCost: 29900, rewardAmount: 1490, commissionAmount: 2990, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  { offerId: "off_toss_kneeguard", supplierId: "sup_toss_sharelink", category: "shopping", title: "무릎 보호대 (2개입)", advertiserName: "토스쇼핑", landingDomain: "link.tossshop.example", priceBand: "low", highRisk: false, totalCost: 19800, rewardAmount: 990, commissionAmount: 1980, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  { offerId: "off_toss_walkshoes", supplierId: "sup_toss_sharelink", category: "shopping", title: "초경량 워킹화", advertiserName: "토스쇼핑", landingDomain: "link.tossshop.example", priceBand: "mid", highRisk: false, totalCost: 49000, rewardAmount: 2450, commissionAmount: 4900, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  { offerId: "off_toss_pillow", supplierId: "sup_toss_sharelink", category: "shopping", title: "목편한 메모리폼 베개", advertiserName: "토스쇼핑", landingDomain: "link.tossshop.example", priceBand: "mid", highRisk: false, totalCost: 35900, rewardAmount: 1790, commissionAmount: 3590, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  // 오퍼월 미션
  { offerId: "off_survey_life", supplierId: "sup_offerwall", category: "survey", title: "생활습관 설문(약 3분)", advertiserName: "□□리서치", landingDomain: "survey.example.com", priceBand: "low", highRisk: false, totalCost: 0, rewardAmount: 300, commissionAmount: 500, approvalWindow: "설문 완료 확인 후 1~2일", cancelTerms: "중복/불성실 응답 시 적립 취소", autoRenewal: false, dataSharing: "설문 응답(비식별)" },
  { offerId: "off_app_install", supplierId: "sup_offerwall", category: "survey", title: "가계부 앱 설치·실행", advertiserName: "☆☆앱", landingDomain: "survey.example.com", priceBand: "low", highRisk: false, totalCost: 0, rewardAmount: 500, commissionAmount: 900, approvalWindow: "설치 확인 후 1~2일", cancelTerms: "즉시 삭제 시 적립 취소", autoRenewal: false, dataSharing: "없음" },
  // 금융(고위험 → 자동추천 제외)
  { offerId: "off_loan_bad", supplierId: "sup_offerwall", category: "finance", title: "간편 대출 비교", advertiserName: "◇◇파이낸스", landingDomain: "loan.example.com", priceBand: "high", highRisk: true, totalCost: 0, rewardAmount: 5000, commissionAmount: 12000, approvalWindow: "심사 후 14일", cancelTerms: "미승인 시 미적립", autoRenewal: false, dataSharing: "연락처·소득정보" },
  // 렌탈(구독형)
  { offerId: "off_rental_water", supplierId: "sup_rental", category: "rental", title: "정수기 렌탈 (냉·온·정)", advertiserName: "○○웰스", landingDomain: "rental.example.com", priceBand: "mid", highRisk: false, totalCost: 466200, rewardAmount: 40000, commissionAmount: 90000, approvalWindow: "설치 완료 후 30~45일", cancelTerms: "의무사용기간 내 해지 시 위약금 발생, 보상 취소", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", monthlyFee: 25900, contractMonths: 36, mandatoryMonths: 18 },
  { offerId: "off_rental_bidet", supplierId: "sup_rental", category: "rental", title: "비데 렌탈 (온수 세정)", advertiserName: "△△매직", landingDomain: "rental.example.com", priceBand: "low", highRisk: false, totalCost: 190800, rewardAmount: 25000, commissionAmount: 55000, approvalWindow: "설치 완료 후 30일", cancelTerms: "의무사용기간 내 해지 시 위약금, 보상 취소", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", monthlyFee: 10600, contractMonths: 36, mandatoryMonths: 12 },
  { offerId: "off_rental_air", supplierId: "sup_rental", category: "rental", title: "공기청정기 렌탈", advertiserName: "○○웰스", landingDomain: "rental.example.com", priceBand: "mid", highRisk: false, totalCost: 356400, rewardAmount: 33000, commissionAmount: 72000, approvalWindow: "설치 완료 후 30~45일", cancelTerms: "의무사용기간 내 해지 시 위약금, 보상 취소", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", monthlyFee: 16500, contractMonths: 36, mandatoryMonths: 18 },
];

/** 샘플 수익화 소스. 나중에 realOfferSource(제휴 API)로 교체 가능. */
export const sampleOfferSource: OfferSource = {
  name: "sample",
  suppliers: () => SAMPLE_SUPPLIERS,
  offers: () => SAMPLE_OFFERS,
};

/** 소스의 공급사·오퍼를 DB에 멱등 upsert. 새 오퍼만 스냅샷 버전 추가. */
export function syncCatalog(source: OfferSource): { suppliers: number; offers: number; addedOffers: number } {
  const ts = now();
  let addedOffers = 0;
  for (const s of source.suppliers()) {
    db.prepare(
      `INSERT INTO suppliers (supplier_id, name, type, reward_traffic_allowed, hmac_secret) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(supplier_id) DO UPDATE SET name = excluded.name, type = excluded.type, reward_traffic_allowed = excluded.reward_traffic_allowed`
    ).run(s.id, s.name, s.type, s.rewardTrafficAllowed ? 1 : 0, s.hmacSecret);
  }
  for (const o of source.offers()) {
    const exists = db.prepare("SELECT 1 FROM offers WHERE offer_id = ?").get(o.offerId);
    if (!exists) {
      db.prepare(
        `INSERT INTO offers (offer_id, supplier_id, category, title, advertiser_name, landing_domain, region, price_band, status, reward_eligible, high_risk)
         VALUES (?, ?, ?, ?, ?, ?, 'KR', ?, 'active', 1, ?)`
      ).run(o.offerId, o.supplierId, o.category, o.title, o.advertiserName, o.landingDomain, o.priceBand, o.highRisk ? 1 : 0);
      db.prepare(
        `INSERT INTO offer_versions (offer_snapshot_id, offer_id, total_cost, reward_amount, commission_amount, approval_window, cancel_terms, auto_renewal, data_sharing, monthly_fee, contract_months, mandatory_months, effective_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id("ofs"), o.offerId, o.totalCost, o.rewardAmount, o.commissionAmount, o.approvalWindow, o.cancelTerms, o.autoRenewal ? 1 : 0, o.dataSharing, o.monthlyFee ?? null, o.contractMonths ?? null, o.mandatoryMonths ?? null, ts);
      addedOffers++;
    }
  }
  return { suppliers: source.suppliers().length, offers: source.offers().length, addedOffers };
}
