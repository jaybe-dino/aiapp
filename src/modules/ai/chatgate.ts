// 대화 게이트 — 일상 대화가 핵심이고, '무료 대화 N회' 소진 후에는
// 광고 시청(수익화 미션)으로 대화를 연장한다. 걷기 보상과 동일한 자체 광고망 전환 경로를 재사용.
//   무료 허용 = config.freeChatsPerDay
//   광고 1회 = config.chatAdUnlockCount 회 추가 개방 + config.chatAdReward 포인트
import { db } from "../../db/index.js";
import { now } from "../../lib/id.js";
import { config } from "../../config.js";
import { Problems } from "../../lib/problem.js";
import { logEvent } from "../analytics/events.js";
import { ingestConversion } from "../attribution/attribution.js";
import { adNetwork } from "../monetization/index.js";

export interface ChatStatus {
  used: number;
  allowance: number;
  remaining: number;
  locked: boolean;
  adReward: number;
  perUnlock: number;
}

function today(): string { return now().slice(0, 10); }

// 오늘 사용한 대화 수(확정 답변 기준).
function usedToday(userId: string): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM answers WHERE user_id = ? AND substr(created_at,1,10) = ?").get(userId, today()) as { c: number }).c;
}
// 오늘 광고로 개방한 횟수(chat_ad_unlock 이벤트 기준).
function adUnlocksToday(userId: string): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = 'chat_ad_unlock' AND substr(created_at,1,10) = ?").get(userId, today()) as { c: number }).c;
}

export function chatStatus(userId: string): ChatStatus {
  const used = usedToday(userId);
  const allowance = config.freeChatsPerDay + adUnlocksToday(userId) * config.chatAdUnlockCount;
  const remaining = Math.max(0, allowance - used);
  return { used, allowance, remaining, locked: remaining <= 0, adReward: config.chatAdReward, perUnlock: config.chatAdUnlockCount };
}

// 광고 시청 완료 → 대화 개방 + 포인트 적립(걷기와 동일한 내부 전환 경로).
export function watchChatAd(userId: string, adImpressionId: string): { status: ChatStatus; rewarded: number } {
  const adCheck = adNetwork.verifyImpression(adImpressionId, { userId, milestone: 0 });
  if (!adCheck.ok) throw Problems.badRequest("광고 시청 후 대화를 이어갈 수 있어요.");

  const seq = adUnlocksToday(userId) + 1; // 오늘 n번째 개방(멱등 키 구성용)
  const reward = config.chatAdReward;
  const gross = adNetwork.grossForMilestone(0); // 자체 광고망 CPM 수취액(어댑터)

  ingestConversion(
    {
      supplierId: "sup_chat_adnet",
      externalConversionId: `${userId}:${today()}:chat:${seq}`,
      clickId: null,
      source: "chat_ad",
      grossAmount: gross,
      rawPayload: { user_id: userId, reward_amount: reward, ad_impression_id: adImpressionId, seq },
    },
    "internal" // 서버 내부 경로에서만 즉시지급 허용(사칭 차단)
  );

  logEvent("chat_ad_unlock", userId, { seq, reward });
  return { status: chatStatus(userId), rewarded: reward };
}
