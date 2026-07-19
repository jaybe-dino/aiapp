// 서비스 E2E 테스트 하네스(인프로세스).
// AI 에이전트 대화 → 수익화 샘플(오퍼·클릭·전환·보상·쿠폰) → 걷기 보상까지 한 번에 흘려보고 보고서를 출력한다.
// 실행: npm run e2e   (API 키가 있으면 실제 LLM, 없으면 결정형 목업으로 동작)
import { seed } from "../src/db/seed.js";
import { handleTurn } from "../src/modules/ai/orchestrator.js";
import { createClick, listRentalOffers } from "../src/modules/commercial/commercial.js";
import { ingestConversion } from "../src/modules/attribution/attribution.js";
import { approve, makeAvailable, listRewards } from "../src/modules/reward/reward.js";
import { requestPayout } from "../src/modules/payout/payout.js";
import { syncSteps, claimMilestone } from "../src/modules/cashwalk/cashwalk.js";
import { userWallet, assertLedgerBalanced } from "../src/modules/ledger/ledger.js";
import { guestLogin, setConsent } from "../src/modules/auth/auth.js";
import { funnelSummary } from "../src/modules/analytics/events.js";
import { monetizationMode } from "../src/modules/monetization/index.js";

const won = (n: number) => (n ?? 0).toLocaleString("ko-KR") + "원";
const line = (s = "") => console.log(s);
const h = (s: string) => { line(); line(`\x1b[1m\x1b[36m${s}\x1b[0m`); };

async function main() {
  seed();
  const { userId } = guestLogin("e2e-device");
  setConsent(userId, "third_party", true); // 렌탈 리드 진행용
  line(`\x1b[1m혜택AI — 서비스 E2E 테스트\x1b[0m  (수익화 모드: ${monetizationMode})`);
  line(`사용자: ${userId}`);

  // 1) AI 에이전트 대화 — 다양한 상황
  h("① AI 에이전트 대화");
  const conv = "cnv_e2e_" + Math.floor(Date.now());
  const questions = [
    "생활비를 아끼고 싶어요",
    "정수기 렌탈 알아보고 있어요",
    "정수기 렌탈 신청하려고 하는데 뭘 확인해야 해?",
    "낯선 사람이 원금 보장에 고수익 준다는데 수수료 먼저 송금하래",
  ];
  let readyOfferSnapshotId: string | null = null;
  let readyAnswerSnapshotId: string | null = null;
  for (const q of questions) {
    const r = await handleTurn({ conversationId: conv, userId, question: q });
    const a = r.answer as { summary: string };
    line(`\n👤 ${q}`);
    line(`🤖 ${a.summary}`);
    line(`   니즈: ${r.needLevel}${r.rewardNudge ? " · 넛지:" + r.rewardNudge : ""}`);
    if (r.safetyNotice) line(`   🛡️ 안전안내(${r.safetyNotice.level}): ${r.safetyNotice.title}`);
    if (r.matched.benefits.length) line(`   🛍️ 추천 혜택: ${r.matched.benefits.map((b) => `${b.title}(확정시 ${won(b.expectedReward)})`).join(", ")}`);
    if (r.matched.missions.length) line(`   🎯 미션: ${r.matched.missions.map((m) => m.title).join(", ")}`);
    if (r.followUps?.length) line(`   💬 이어서: ${r.followUps.join(" / ")}`);
    if (r.needLevel === "ready" && r.matched.benefits[0]) {
      readyOfferSnapshotId = r.matched.benefits[0].offerSnapshotId;
      readyAnswerSnapshotId = r.answerSnapshotId;
    }
  }

  // 2) 수익화 루프: 추천 → 클릭 → 전환 → 보상 → 쿠폰
  h("② 수익화 루프 (샘플 제휴 전환 → 보상 → 쿠폰)");
  const offerSnap = readyOfferSnapshotId ?? listRentalOffers()[0]!.offerSnapshotId;
  const click = createClick({ userId, offerSnapshotId: offerSnap, answerSnapshotId: readyAnswerSnapshotId });
  line(`클릭 생성: ${click!.clickId} → ${click!.redirectUrl}`);

  const convRes = ingestConversion(
    { supplierId: "sup_rental", externalConversionId: "e2e_" + Math.floor(Date.now()), clickId: click!.clickId, source: "rental_cpa", grossAmount: 90000, rawPayload: {} },
    "postback"
  );
  line(`전환 수신: 상태=${convRes.status} (샘플 공급사 포스트백)`);
  line(`지갑(전환 직후): 확인중 ${won(userWallet(userId).pending)} / 사용가능 ${won(userWallet(userId).available)}`);

  if (convRes.rewardTransactionId) {
    approve(convRes.rewardTransactionId);
    makeAvailable(convRes.rewardTransactionId);
    line(`공급사 승인 → 사용가능 처리`);
  }
  line(`지갑(승인 후): 확인중 ${won(userWallet(userId).pending)} / 사용가능 ${won(userWallet(userId).available)}`);

  // 3) 걷기 보상(샘플 광고망)
  h("③ 걷기 보상 (샘플 광고망 CPM)");
  const day = "2026-07-19";
  syncSteps({ userId, dayKey: day, steps: 5000, deviceIntegrityOk: true });
  let earned = 0;
  for (let m = 1; m <= 3; m++) { const c = claimMilestone({ userId, dayKey: day, milestone: m, adImpressionId: `imp_${m}` }); earned += c.rewardAmount; }
  line(`5,000보 → 마일스톤 3개 광고 시청 → +${won(earned)} 즉시 사용가능`);
  line(`지갑: 사용가능 ${won(userWallet(userId).available)}`);

  // 4) 쿠폰 교환(지급 Saga)
  h("④ 쿠폰 교환 (지급 Saga)");
  const pay = await requestPayout({ userId, amount: 3000, productId: "coupon_3000", idempotencyKey: "e2e-pay-" + Math.floor(Date.now()) });
  line(`3,000원 교환: 상태=${pay.status}${pay.coupon_code ? " · 쿠폰번호 " + pay.coupon_code : ""}`);
  line(`지갑(교환 후): 사용가능 ${won(userWallet(userId).available)} / 사용 ${won((userWallet(userId) as any).used ?? 0)}`);

  // 5) 정합성 + 지표
  h("⑤ 정합성 · 지표");
  assertLedgerBalanced();
  line(`✅ 원장 균형 검증 통과`);
  line(`보상 내역 ${listRewards(userId).length}건`);
  line(`KPI 퍼널: ${funnelSummary().map((f) => `${f.name}=${f.count}`).join(", ")}`);

  h("완료 — AI 대화 + 수익화 샘플 루프가 정상 동작합니다.");
}

main().catch((e) => { console.error("E2E 실패:", e); process.exit(1); });
