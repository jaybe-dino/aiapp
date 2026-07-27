// 전환 귀속 파이프라인(기획안 5.3, 13~14장).
// 수신 → 영속화 → 정규화 → 귀속 → 사기검사 → 원장 pending. 순서 역전/재시도 안전.
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { scoreConversion, fraudDecision } from "./fraud.js";
import { createPendingFromConversion, approve, makeAvailable } from "../reward/reward.js";
import { logEvent } from "../analytics/events.js";

export interface NormalizedConversion {
  supplierId: string;
  externalConversionId: string;
  clickId: string | null;
  source: string; // shopping_cps | offerwall_cpa | cashwalk_ad
  grossAmount: number;
  rawPayload: unknown;
}

interface ClickRow {
  user_id: string;
  offer_id: string;
  offer_snapshot_id: string;
  supplier_id: string;
  attribution_expires_at: string;
}

interface SnapshotRow {
  reward_amount: number;
  commission_amount: number;
}

/**
 * 정규화된 전환 1건을 처리한다. 멱등: (supplier, external_conversion_id) 유일 제약으로
 * 재수신은 자동 무시(중복 200). 반환값은 처리 결과 요약.
 */
// origin: 전환의 진입 경로. "internal"은 서버 내부(예: 걷기 claimMilestone)에서만,
// "postback"은 외부 공급사 서명 포스트백. cashwalk_ad 즉시지급은 internal에서만 허용한다.
export function ingestConversion(
  n: NormalizedConversion,
  origin: "internal" | "postback" = "postback"
): {
  conversionId: string;
  status: string;
  duplicate: boolean;
  rewardTransactionId?: string;
} {
  // 중복 수신 방어
  const dup = db
    .prepare("SELECT conversion_id, status FROM conversions WHERE supplier_id = ? AND external_conversion_id = ?")
    .get(n.supplierId, n.externalConversionId) as { conversion_id: string; status: string } | undefined;
  if (dup) return { conversionId: dup.conversion_id, status: dup.status, duplicate: true };

  // [보안] 자체 광고망 즉시지급 보상(걷기·대화연장·스폰서대화)은 서버 내부 경로에서만 생성 가능.
  // 외부 포스트백이 이 source 로 임의 사용자/금액을 즉시지급하는 사칭을 차단.
  const internalAdSource = n.source === "cashwalk_ad" || n.source === "chat_ad" || n.source === "sponsor_chat";
  const cashwalkSpoof = internalAdSource && origin !== "internal";

  // 귀속: click_id로 사용자/오퍼 스냅샷 확인
  let click: ClickRow | undefined;
  if (n.clickId) {
    click = db.prepare("SELECT * FROM clicks WHERE click_id = ?").get(n.clickId) as ClickRow | undefined;
    // [보안] 귀속 검증: 만료된 클릭·타 공급사 클릭은 귀속 근거로 인정하지 않는다.
    if (click) {
      const expired = new Date(click.attribution_expires_at).getTime() < Date.now();
      const supplierMismatch = click.supplier_id !== n.supplierId;
      if (expired || supplierMismatch) click = undefined;
    }
  }

  // 보상/수수료 금액 결정
  let userId = click?.user_id ?? null;
  let rewardAmount = 0;
  let commissionAmount = 0;
  let title = "제휴 전환 보상";

  if (internalAdSource) {
    // 자체 광고망 보상은 payload에 사용자/금액이 담겨온다(걷기·대화연장)
    const p = n.rawPayload as { user_id?: string; reward_amount?: number };
    userId = p.user_id ?? userId;
    rewardAmount = p.reward_amount ?? 0;
    commissionAmount = Math.max(0, n.grossAmount - rewardAmount);
    title = n.source === "chat_ad" ? "대화 연장 광고 보상" : n.source === "sponsor_chat" ? "대화 미션 보상" : "걷기 광고 보상";
  } else if (click) {
    const snap = db
      .prepare("SELECT reward_amount, commission_amount FROM offer_versions WHERE offer_snapshot_id = ?")
      .get(click.offer_snapshot_id) as SnapshotRow | undefined;
    rewardAmount = snap?.reward_amount ?? 0;
    commissionAmount = snap?.commission_amount ?? Math.max(0, n.grossAmount - rewardAmount);
    title = n.source === "shopping_cps" ? "쇼핑 적립" : n.source === "rental_cpa" ? "렌탈 보상" : "미션 보상";
  }

  const fraud = scoreConversion({
    userId,
    supplierId: n.supplierId,
    externalConversionId: n.externalConversionId,
    clickId: n.clickId,
    grossAmount: n.grossAmount,
    source: n.source,
  });
  // 사칭 시도는 사기점수와 무관하게 귀속 거부(기록은 남겨 감사 가능).
  const decision = cashwalkSpoof ? "rejected" : fraudDecision(fraud.score);

  const conversionId = id("cnv");
  db.prepare(
    `INSERT INTO conversions (conversion_id, supplier_id, external_conversion_id, click_id, user_id, source, gross_amount, reward_amount, commission_amount, fraud_score, status, raw_payload, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    conversionId,
    n.supplierId,
    n.externalConversionId,
    n.clickId,
    userId,
    n.source,
    n.grossAmount,
    rewardAmount,
    commissionAmount,
    fraud.score,
    decision,
    JSON.stringify(n.rawPayload),
    now()
  );

  // 귀속 성공 + 사용자/보상 존재 시에만 원장 pending 생성(불명확하면 review 큐에 남김)
  let rewardTransactionId: string | undefined;
  if (decision === "attributed" && userId && rewardAmount > 0) {
    const rw = createPendingFromConversion({
      conversionId,
      userId,
      source: n.source,
      rewardAmount,
      commissionAmount,
      title,
    });
    rewardTransactionId = rw.reward_transaction_id;

    // 자체광고 보상(걷기·대화연장)은 즉시 확정(광고 CPM은 이미 수취) → 사용가능까지 진행.
    // 내부 경로에서만. 외부 포스트백은 위에서 이미 rejected 처리됨.
    if (internalAdSource && origin === "internal") {
      approve(rewardTransactionId);
      makeAvailable(rewardTransactionId);
    }
  }

  // KPI: 전환 결과(귀속/리뷰/거부)와 금액. 퍼널의 최종 단계이자 정산 관측점.
  logEvent("conversion", userId, { source: n.source, status: decision, reward: rewardAmount, origin });

  return { conversionId, status: decision, duplicate: false, rewardTransactionId };
}
