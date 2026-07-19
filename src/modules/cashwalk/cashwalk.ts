// 캐시워크(걷기 리워드) — 기획안에 없던 신규 도메인.
// 설계 원칙(자료의 "무보상 행위에 현금 지급 금지"와 정합):
//   걸음 '자체'에 현금을 주지 않는다. 걸음 마일스톤(예:1000보)마다 '광고 시청'을 완료해야
//   보상이 발생한다. 보상 재원은 잠금화면/리워드 광고의 CPM(자체 광고망 전환)이다.
// 어뷰징 방지: 일일 상한, 걸음 증가 타당성, 기기 무결성 플래그, 마일스톤별 멱등 청구.
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { ingestConversion } from "../attribution/attribution.js";
import { adNetwork } from "../monetization/index.js";
export { STEP_PER_MILESTONE, DAILY_STEP_CAP, REWARD_PER_MILESTONE, MAX_MILESTONES_PER_DAY } from "./constants.js";
import { STEP_PER_MILESTONE, DAILY_STEP_CAP, REWARD_PER_MILESTONE, MAX_MILESTONES_PER_DAY } from "./constants.js";

interface DayRow {
  user_id: string;
  day_key: string;
  steps: number;
  integrity_ok: number;
}

/** 걸음수 동기화. 기기가 누적 걸음을 올리면 상한/타당성 검사 후 저장. */
export function syncSteps(p: {
  userId: string;
  dayKey: string;
  steps: number;
  deviceIntegrityOk?: boolean;
}): { steps: number; unlockedMilestones: number; claimable: number[] } {
  if (p.steps < 0 || p.steps > 100000) throw Problems.badRequest("걸음수 값이 올바르지 않습니다.");

  const prev = db
    .prepare("SELECT * FROM cashwalk_days WHERE user_id = ? AND day_key = ?")
    .get(p.userId, p.dayKey) as DayRow | undefined;

  // 걸음은 하루 동안 단조 증가해야 한다(감소 요청은 무시하고 최대값 유지).
  const steps = Math.min(Math.max(p.steps, prev?.steps ?? 0), DAILY_STEP_CAP + STEP_PER_MILESTONE);
  const integrityOk = (p.deviceIntegrityOk ?? true) ? 1 : 0;

  db.prepare(
    `INSERT INTO cashwalk_days (user_id, day_key, steps, integrity_ok, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day_key) DO UPDATE SET steps = excluded.steps, integrity_ok = excluded.integrity_ok, updated_at = excluded.updated_at`
  ).run(p.userId, p.dayKey, steps, integrityOk, now());

  const unlocked = Math.min(Math.floor(steps / STEP_PER_MILESTONE), MAX_MILESTONES_PER_DAY);
  const claimed = claimedMilestones(p.userId, p.dayKey);
  const claimable: number[] = [];
  for (let m = 1; m <= unlocked; m++) if (!claimed.has(m)) claimable.push(m);

  return { steps, unlockedMilestones: unlocked, claimable };
}

function claimedMilestones(userId: string, dayKey: string): Set<number> {
  const rows = db
    .prepare("SELECT milestone FROM cashwalk_claims WHERE user_id = ? AND day_key = ?")
    .all(userId, dayKey) as { milestone: number }[];
  return new Set(rows.map((r) => r.milestone));
}

/**
 * 마일스톤 보상 청구. 반드시 광고 시청 증적(adImpressionId)이 있어야 한다.
 * 멱등: (user, day, milestone) 유일 → 재청구는 기존 결과 반환.
 * 처리: 자체 광고망 전환(cashwalk_ad)을 생성 → attribution → pending → 즉시 available.
 */
export function claimMilestone(p: {
  userId: string;
  dayKey: string;
  milestone: number;
  adImpressionId: string;
}): { claimId: string; rewardAmount: number; duplicate: boolean } {
  const day = db
    .prepare("SELECT * FROM cashwalk_days WHERE user_id = ? AND day_key = ?")
    .get(p.userId, p.dayKey) as DayRow | undefined;
  if (!day) throw Problems.badRequest("먼저 걸음수를 동기화하세요.");
  if (!day.integrity_ok) throw Problems.conflict("기기 무결성 확인이 필요합니다.", "루팅/에뮬레이터/센서 조작 의심");
  // 광고 시청 증적 검증(수익화 어댑터). 샘플 광고망은 impression id 존재만 확인, 실연동은 SSV.
  const adCheck = adNetwork.verifyImpression(p.adImpressionId, { userId: p.userId, milestone: p.milestone });
  if (!adCheck.ok) throw Problems.badRequest("광고 시청 후 보상을 받을 수 있어요.");

  if (p.milestone < 1 || p.milestone > MAX_MILESTONES_PER_DAY) throw Problems.badRequest("유효하지 않은 마일스톤입니다.");
  const unlocked = Math.floor(day.steps / STEP_PER_MILESTONE);
  if (p.milestone > unlocked) throw Problems.conflict("아직 도달하지 않은 마일스톤입니다.", `현재 ${day.steps}보`);

  const existing = db
    .prepare("SELECT claim_id, reward_amount FROM cashwalk_claims WHERE user_id = ? AND day_key = ? AND milestone = ?")
    .get(p.userId, p.dayKey, p.milestone) as { claim_id: string; reward_amount: number } | undefined;
  if (existing) return { claimId: existing.claim_id, rewardAmount: existing.reward_amount, duplicate: true };

  const claimId = id("cwc");
  const externalConversionId = `${p.userId}:${p.dayKey}:${p.milestone}`;
  const reward = REWARD_PER_MILESTONE;
  const grossFromAd = adNetwork.grossForMilestone(p.milestone); // 광고망 CPM 수취액(어댑터)

  // 자체 광고망 전환으로 원장에 연결(수익 - 보상 = 마진)
  const conv = ingestConversion(
    {
      supplierId: "sup_walk_adnet",
      externalConversionId,
      clickId: null,
      source: "cashwalk_ad",
      grossAmount: grossFromAd,
      rawPayload: { user_id: p.userId, reward_amount: reward, ad_impression_id: p.adImpressionId, milestone: p.milestone },
    },
    "internal" // 서버 내부 경로: cashwalk_ad 즉시지급 허용
  );

  db.prepare(
    `INSERT INTO cashwalk_claims (claim_id, user_id, day_key, milestone, ad_impression_id, reward_amount, conversion_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(claimId, p.userId, p.dayKey, p.milestone, p.adImpressionId, reward, conv.conversionId, now());

  return { claimId, rewardAmount: reward, duplicate: false };
}

export function todayStatus(userId: string, dayKey: string) {
  const day = db.prepare("SELECT * FROM cashwalk_days WHERE user_id = ? AND day_key = ?").get(userId, dayKey) as
    | DayRow
    | undefined;
  const steps = day?.steps ?? 0;
  const unlocked = Math.min(Math.floor(steps / STEP_PER_MILESTONE), MAX_MILESTONES_PER_DAY);
  const claimed = claimedMilestones(userId, dayKey);
  const claimable: number[] = [];
  for (let m = 1; m <= unlocked; m++) if (!claimed.has(m)) claimable.push(m);
  return {
    dayKey,
    steps,
    dailyCap: DAILY_STEP_CAP,
    stepPerMilestone: STEP_PER_MILESTONE,
    rewardPerMilestone: REWARD_PER_MILESTONE,
    unlockedMilestones: unlocked,
    claimedMilestones: [...claimed].sort((a, b) => a - b),
    claimable,
    earnedToday: claimed.size * REWARD_PER_MILESTONE,
  };
}
