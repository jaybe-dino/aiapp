// 데모용 시드 데이터. `npm run seed` 또는 서버 첫 기동 시 자동 실행.
// 공급사·오퍼(수익화 카탈로그)는 monetization 샘플 소스에서 가져온다(추후 실연동 시 교체 지점 일원화).
import { db, applySchema } from "./index.js";
import { now } from "../lib/id.js";
import { sampleOfferSource, syncCatalog } from "../modules/monetization/catalog.js";

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

  // 공급사·오퍼(수익화 샘플 카탈로그) — 실연동 시 monetization/catalog.ts 의 소스만 교체.
  const cat = syncCatalog(sampleOfferSource);

  console.log(`[seed] 데모 데이터 생성 완료 (user=usr_demo, 공급사 ${cat.suppliers}, 오퍼 ${cat.addedOffers})`);
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}
