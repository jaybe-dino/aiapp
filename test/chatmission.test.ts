// 스폰서 대화 미션: 시작 → 턴 채움 → 완료 시 스폰서 재원으로 즉시 보상. + 스트릭 보너스.
import { beforeAll, describe, it, expect } from "vitest";
import { applySchema, db } from "../src/db/index.js";
import { listChatMissions, startChatMission, progressChatMission, chatStreak, CHAT_MISSIONS } from "../src/modules/ai/chatmission.js";
import { listRewards } from "../src/modules/reward/reward.js";
import { id, sha256 } from "../src/lib/id.js";

const R = Math.random().toString(36).slice(2, 8);
const U = "usr_cm_" + R;

beforeAll(() => applySchema());

describe("스폰서 대화 미션", () => {
  it("시작 전에는 available, 시작하면 active", () => {
    expect(listChatMissions(U).every((m) => m.state === "available")).toBe(true);
    const def = CHAT_MISSIONS[0]!;
    const r = startChatMission(U, def.missionId);
    expect(r.opening).toBe(def.opening);
    expect(listChatMissions(U).find((m) => m.missionId === def.missionId)!.state).toBe("active");
  });

  it("턴을 채우면 완료되고 보상이 즉시 사용가능으로 적립된다", () => {
    const def = CHAT_MISSIONS[0]!;
    let last: ReturnType<typeof progressChatMission> = null;
    for (let i = 0; i < def.turnsRequired; i++) last = progressChatMission(U);
    expect(last!.completed).toBe(true);
    expect(last!.reward).toBe(def.reward);
    const rw = listRewards(U).find((r) => r.source === "sponsor_chat");
    expect(rw).toBeTruthy();
    expect(rw!.state).toBe("available");
    expect(rw!.approved_amount ?? rw!.expected_amount).toBe(def.reward);
  });

  it("같은 날 같은 미션 재시작은 거부(중복 보상 차단)", () => {
    const def = CHAT_MISSIONS[0]!;
    expect(() => startChatMission(U, def.missionId)).toThrow();
    // 보상도 1건뿐
    expect(listRewards(U).filter((r) => r.source === "sponsor_chat").length).toBe(1);
  });

  it("외부 포스트백의 sponsor_chat 사칭은 차단된다", async () => {
    const { ingestConversion } = await import("../src/modules/attribution/attribution.js");
    const r = ingestConversion(
      { supplierId: "sup_evil", externalConversionId: "spoof_cm_" + R, clickId: null, source: "sponsor_chat", grossAmount: 900, rawPayload: { user_id: U, reward_amount: 999999 } },
      "postback"
    );
    expect(r.status).toBe("rejected");
  });
});

describe("연속 대화 스트릭", () => {
  it("연속 일수를 계산하고 3일마다 보너스를 지급한다(하루 1회)", () => {
    const U2 = "usr_st_" + R;
    // 오늘·어제·그제 답변 기록 → 3일 스트릭
    const mk = (daysAgo: number) => {
      const d = new Date(Date.now() - daysAgo * 86400000).toISOString();
      db.prepare(
        `INSERT INTO answers (answer_snapshot_id, conversation_id, user_id, question, answer_json, content_hash, risk_tier, commercial_allowed, need_level, reward_nudge, finalized_at, created_at)
         VALUES (?, ?, ?, 'q', '{}', ?, 'low', 1, 'none', NULL, ?, ?)`
      ).run(id("ans"), "cnv_st_" + R, U2, sha256("s" + daysAgo), d, d);
    };
    mk(0); mk(1); mk(2);
    const s1 = chatStreak(U2);
    expect(s1.days).toBe(3);
    expect(s1.bonus).toBe(50); // 첫 호출에 지급
    const s2 = chatStreak(U2);
    expect(s2.bonus).toBeNull(); // 같은 날 중복 지급 없음
    const rw = listRewards(U2).find((r) => r.source === "chat_ad");
    expect(rw).toBeTruthy();
  });
});
