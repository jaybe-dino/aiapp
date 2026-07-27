// 스폰서 대화 미션 — '대화하면 돈 번다'의 핵심 루프.
// 원칙(무보상 행위에 현금 지급 금지와 정합): 대화 '자체'가 아니라, 스폰서가 재원을 대는
// '주제 대화 미션'을 완료했을 때 보상한다. 걷기·대화연장과 동일한 자체 광고망 전환 경로 재사용.
//   - 하루에 미션별 1회, 대화 턴(turnsRequired)을 채우면 완료 → 즉시 사용가능 적립
//   - 연속 대화 스트릭: 3일 연속 대화마다 보너스(하우스 광고 재원) 지급
import { db, tx } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { logEvent } from "../analytics/events.js";
import { ingestConversion } from "../attribution/attribution.js";

export interface ChatMissionDef {
  missionId: string;
  sponsor: string;      // 스폰서(광고주) 표기 — 투명성 필수
  title: string;        // 사용자에게 보이는 미션명
  opening: string;      // 탭하면 AI에게 보낼 시작 질문
  reward: number;       // 완료 보상(P)
  turnsRequired: number;// 채워야 하는 대화 턴 수
  gross: number;        // 스폰서가 지불하는 금액(재원) — 보상보다 커야 마진
}

// 샘플 스폰서 카탈로그(실연동 시 광고주 캠페인 API로 교체 — 어댑터 지점).
export const CHAT_MISSIONS: ChatMissionDef[] = [
  { missionId: "cm_health", sponsor: "○○헬스케어", title: "건강 습관 이야기 나누기", opening: "요즘 나이에 맞는 건강 관리, 뭐부터 하면 좋을까요?", reward: 500, turnsRequired: 3, gross: 900 },
  { missionId: "cm_travel", sponsor: "△△여행", title: "가을 나들이 계획 세우기", opening: "가을에 당일치기로 다녀올 만한 곳 추천해줘요", reward: 300, turnsRequired: 2, gross: 600 },
  { missionId: "cm_saving", sponsor: "□□마트", title: "장보기 절약 요령 배우기", opening: "장볼 때 돈 아끼는 요령 좀 알려줘요", reward: 300, turnsRequired: 2, gross: 600 },
];

const STREAK_BONUS = 50;         // 3일 연속마다 지급
const STREAK_EVERY = 3;

function today(): string { return now().slice(0, 10); }

interface MissionRow {
  id: string; user_id: string; day_key: string; mission_id: string;
  turns: number; state: string; reward: number;
}

/** 오늘 미션 목록 + 각자의 진행 상태. */
export function listChatMissions(userId: string) {
  const day = today();
  const rows = db.prepare("SELECT * FROM chat_missions WHERE user_id = ? AND day_key = ?").all(userId, day) as MissionRow[];
  const byId = new Map(rows.map((r) => [r.mission_id, r]));
  return CHAT_MISSIONS.map((m) => {
    const r = byId.get(m.missionId);
    return {
      missionId: m.missionId, sponsor: m.sponsor, title: m.title, opening: m.opening,
      reward: m.reward, turnsRequired: m.turnsRequired,
      turns: r?.turns ?? 0,
      state: (r?.state ?? "available") as "available" | "active" | "completed",
    };
  });
}

/** 미션 시작(하루 1회). 이미 완료면 거절, 진행 중이면 그대로 반환. */
export function startChatMission(userId: string, missionId: string) {
  const def = CHAT_MISSIONS.find((m) => m.missionId === missionId);
  if (!def) throw Problems.badRequest("없는 미션입니다.");
  const day = today();
  return tx(() => {
    const existing = db.prepare("SELECT * FROM chat_missions WHERE user_id = ? AND day_key = ? AND mission_id = ?").get(userId, day, missionId) as MissionRow | undefined;
    if (existing?.state === "completed") throw Problems.conflict("오늘 이미 완료한 미션이에요.", "내일 다시 참여할 수 있어요");
    if (!existing) {
      // 다른 활성 미션은 종료(동시 1개만 — 사용자 혼란 방지)
      db.prepare("UPDATE chat_missions SET state = 'completed', updated_at = ? WHERE user_id = ? AND day_key = ? AND state = 'active' AND turns >= 999").run(now(), userId, day);
      db.prepare(
        "INSERT INTO chat_missions (id, user_id, day_key, mission_id, turns, state, reward, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'active', ?, ?, ?)"
      ).run(id("cms"), userId, day, missionId, def.reward, now(), now());
      logEvent("chat_mission_start", userId, { mission_id: missionId });
    }
    return { missionId, opening: def.opening, turnsRequired: def.turnsRequired };
  });
}

export interface MissionProgress {
  missionId: string; title: string; sponsor: string;
  turns: number; turnsRequired: number; completed: boolean; reward: number;
}

/**
 * 대화 1턴 진행 시 호출(orchestrator). 활성 미션의 턴을 올리고, 채우면 완료 처리 + 보상.
 * 보상은 스폰서 재원 전환(sponsor_chat, 내부 경로 전용)으로 원장에 즉시 사용가능 적립.
 */
export function progressChatMission(userId: string): MissionProgress | null {
  const day = today();
  return tx(() => {
    const r = db.prepare("SELECT * FROM chat_missions WHERE user_id = ? AND day_key = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1").get(userId, day) as MissionRow | undefined;
    if (!r) return null;
    const def = CHAT_MISSIONS.find((m) => m.missionId === r.mission_id);
    if (!def) return null;
    const turns = r.turns + 1;
    const completed = turns >= def.turnsRequired;
    db.prepare("UPDATE chat_missions SET turns = ?, state = ?, updated_at = ? WHERE id = ?").run(turns, completed ? "completed" : "active", now(), r.id);
    if (completed) {
      ingestConversion(
        {
          supplierId: "sup_sponsor_chat",
          externalConversionId: `${userId}:${day}:${def.missionId}`,
          clickId: null,
          source: "sponsor_chat",
          grossAmount: def.gross,
          rawPayload: { user_id: userId, reward_amount: def.reward, mission_id: def.missionId },
        },
        "internal" // 서버 내부 경로에서만 즉시지급(사칭 차단)
      );
      logEvent("chat_mission_complete", userId, { mission_id: def.missionId, reward: def.reward });
    }
    return { missionId: def.missionId, title: def.title, sponsor: def.sponsor, turns, turnsRequired: def.turnsRequired, completed, reward: def.reward };
  });
}

export interface StreakInfo { days: number; bonus: number | null }

/**
 * 연속 대화 스트릭(오늘 포함 몇 일 연속 대화했는지). 3일마다 보너스 1회(하루 중복 방지).
 * 보너스 재원은 하우스 광고(대화 연장 광고와 동일 광고망) — 무재원 지급 금지 원칙 유지.
 */
export function chatStreak(userId: string): StreakInfo {
  const days = (db.prepare(
    "SELECT DISTINCT substr(created_at,1,10) AS d FROM answers WHERE user_id = ? ORDER BY d DESC LIMIT 30"
  ).all(userId) as { d: string }[]).map((r) => r.d);
  let streak = 0;
  const t = new Date(today() + "T00:00:00Z").getTime();
  for (let i = 0; ; i++) {
    const dayStr = new Date(t - i * 86400000).toISOString().slice(0, 10);
    if (days.includes(dayStr)) streak++;
    else break;
  }
  let bonus: number | null = null;
  if (streak > 0 && streak % STREAK_EVERY === 0) {
    const day = today();
    const given = db.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = 'chat_streak_bonus' AND substr(created_at,1,10) = ?"
    ).get(userId, day) as { c: number };
    if (given.c === 0) {
      ingestConversion(
        {
          supplierId: "sup_chat_adnet",
          externalConversionId: `${userId}:${day}:streak${streak}`,
          clickId: null,
          source: "chat_ad",
          grossAmount: STREAK_BONUS * 2,
          rawPayload: { user_id: userId, reward_amount: STREAK_BONUS, streak },
        },
        "internal"
      );
      logEvent("chat_streak_bonus", userId, { streak, reward: STREAK_BONUS });
      bonus = STREAK_BONUS;
    }
  }
  return { days: streak, bonus };
}
