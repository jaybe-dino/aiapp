// 데모용 시드 데이터. `npm run seed` 또는 서버 첫 기동 시 자동 실행.
import { db, applySchema } from "./index.js";
import { id, now } from "../lib/id.js";

export function seed() {
  applySchema();
  const already = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (already.c > 0) return; // 멱등

  const ts = now();

  // 데모 사용자
  const userId = "usr_demo";
  db.prepare(
    "INSERT INTO users (user_id, display_name, age_band, font_scale, tts_enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)"
  ).run(userId, "김지영", "55-69", 1.2, ts);

  for (const purpose of ["service", "conversation_store", "personalized_ads"]) {
    db.prepare(
      "INSERT INTO consents (user_id, purpose, granted, policy_version, updated_at) VALUES (?, ?, 1, 'v1.0', ?)"
    ).run(userId, purpose, ts);
  }

  // 운영자 계정(역할 분리). 토큰은 데모용 — 운영에선 SSO/MFA.
  const admins = [
    { id: "adm_ops", email: "ops@hyeaek.ai", name: "운영자 오퍼스", role: "ops", token: "admin-ops-token" },
    { id: "adm_review", email: "review@hyeaek.ai", name: "검수자 리뷰", role: "reviewer", token: "admin-review-token" },
    { id: "adm_finance", email: "finance@hyeaek.ai", name: "재무 파이낸스", role: "finance", token: "admin-finance-token" },
    { id: "adm_owner", email: "owner@hyeaek.ai", name: "대표 오너", role: "owner", token: "admin-owner-token" },
  ];
  for (const a of admins) {
    db.prepare("INSERT INTO admin_users (admin_id, email, name, role, token, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.email, a.name, a.role, a.token, ts);
  }

  // 공급사
  const suppliers = [
    { id: "sup_linkprice", name: "LinkPrice", type: "shopping_cps", reward: 1 },
    { id: "sup_offerwall", name: "리워드오퍼월", type: "offerwall_cpa", reward: 1 },
    { id: "sup_walk_adnet", name: "걷기광고망", type: "walk_ad", reward: 1 },
    { id: "sup_coupang", name: "쿠팡파트너스", type: "shopping_cps", reward: 0 }, // 리워드 트래픽 미승인 예시
  ];
  for (const s of suppliers) {
    db.prepare(
      "INSERT INTO suppliers (supplier_id, name, type, reward_traffic_allowed, hmac_secret) VALUES (?, ?, ?, ?, ?)"
    ).run(s.id, s.name, s.type, s.reward, "dev-supplier-secret-change-me");
  }

  // 오퍼 + 조건 스냅샷
  const offers = [
    {
      offer_id: "off_busan_hotel",
      supplier_id: "sup_linkprice",
      category: "travel",
      title: "부산 해운대 호텔 2박",
      advertiser_name: "○○여행",
      landing_domain: "travel.example.com",
      price_band: "high",
      high_risk: 0,
      total_cost: 180000,
      reward_amount: 4000,
      commission_amount: 9000,
      approval_window: "여행 종료 후 7~14일",
      cancel_terms: "체크인 3일 전까지 무료 취소, 이후 적립 취소",
      auto_renewal: 0,
      data_sharing: "없음",
    },
    {
      offer_id: "off_shopping_air",
      supplier_id: "sup_linkprice",
      category: "shopping",
      title: "공기청정기 필터 정기배송",
      advertiser_name: "△△리빙",
      landing_domain: "shop.example.com",
      price_band: "mid",
      high_risk: 0,
      total_cost: 39000,
      reward_amount: 1200,
      commission_amount: 2600,
      approval_window: "구매 확정 후 7일",
      cancel_terms: "반품 시 적립 취소",
      auto_renewal: 1,
      data_sharing: "없음",
    },
    {
      offer_id: "off_survey_life",
      supplier_id: "sup_offerwall",
      category: "survey",
      title: "생활습관 설문(약 3분)",
      advertiser_name: "□□리서치",
      landing_domain: "survey.example.com",
      price_band: "low",
      high_risk: 0,
      total_cost: 0,
      reward_amount: 300,
      commission_amount: 500,
      approval_window: "설문 완료 확인 후 1~2일",
      cancel_terms: "중복/불성실 응답 시 적립 취소",
      auto_renewal: 0,
      data_sharing: "설문 응답(비식별)",
    },
    {
      offer_id: "off_loan_bad",
      supplier_id: "sup_offerwall",
      category: "finance",
      title: "간편 대출 비교",
      advertiser_name: "◇◇파이낸스",
      landing_domain: "loan.example.com",
      price_band: "high",
      high_risk: 1, // 고위험 → 자동추천 제외됨(안전엔진/후보필터)
      total_cost: 0,
      reward_amount: 5000,
      commission_amount: 12000,
      approval_window: "심사 후 14일",
      cancel_terms: "미승인 시 미적립",
      auto_renewal: 0,
      data_sharing: "연락처·소득정보",
    },
  ];

  for (const o of offers) {
    db.prepare(
      `INSERT INTO offers (offer_id, supplier_id, category, title, advertiser_name, landing_domain, region, price_band, status, reward_eligible, high_risk)
       VALUES (?, ?, ?, ?, ?, ?, 'KR', ?, 'active', 1, ?)`
    ).run(o.offer_id, o.supplier_id, o.category, o.title, o.advertiser_name, o.landing_domain, o.price_band, o.high_risk);
    db.prepare(
      `INSERT INTO offer_versions (offer_snapshot_id, offer_id, total_cost, reward_amount, commission_amount, approval_window, cancel_terms, auto_renewal, data_sharing, effective_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id("ofs"),
      o.offer_id,
      o.total_cost,
      o.reward_amount,
      o.commission_amount,
      o.approval_window,
      o.cancel_terms,
      o.auto_renewal,
      o.data_sharing,
      ts
    );
  }

  console.log("[seed] 데모 데이터 생성 완료 (user=usr_demo)");
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}
