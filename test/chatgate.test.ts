// 대화 게이트: 무료 대화 소진 → 광고 시청으로 개방 + 포인트 적립.
import { beforeAll, describe, it, expect } from "vitest";
import { applySchema, db } from "../src/db/index.js";
import { id, now, sha256 } from "../src/lib/id.js";
import { config } from "../src/config.js";
import { chatStatus, watchChatAd } from "../src/modules/ai/chatgate.js";
import { listRewards } from "../src/modules/reward/reward.js";

const R = Math.random().toString(36).slice(2, 8);
const U = "usr_gate_" + R;

function insertAnswer(user: string) {
  db.prepare(
    `INSERT INTO answers (answer_snapshot_id, conversation_id, user_id, question, answer_json, content_hash, risk_tier, commercial_allowed, need_level, reward_nudge, finalized_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'low', 1, 'none', NULL, ?, ?)`
  ).run(id("ans"), "cnv_" + R, user, "q", JSON.stringify({ summary: "s", sections: [] }), sha256("s"), now(), now());
}

beforeAll(() => applySchema());

describe("대화 게이트(무료 대화 + 광고 이어가기)", () => {
  it("무료 한도까지는 잠기지 않고, 소진하면 잠긴다", () => {
    const free = config.freeChatsPerDay;
    expect(chatStatus(U).locked).toBe(false);
    expect(chatStatus(U).remaining).toBe(free);
    for (let i = 0; i < free; i++) insertAnswer(U);
    const st = chatStatus(U);
    expect(st.used).toBe(free);
    expect(st.remaining).toBe(0);
    expect(st.locked).toBe(true);
  });

  it("광고 시청 시 대화가 개방되고 포인트가 즉시 적립된다", () => {
    const before = chatStatus(U);
    expect(before.locked).toBe(true);
    const res = watchChatAd(U, "imp_" + R);
    expect(res.rewarded).toBe(config.chatAdReward);
    // 개방량만큼 remaining 회복
    expect(res.status.locked).toBe(false);
    expect(res.status.allowance).toBe(before.allowance + config.chatAdUnlockCount);
    // 보상이 원장에 즉시 사용가능(available)으로 적립
    const rewards = listRewards(U);
    const chatAd = rewards.find((r) => r.source === "chat_ad");
    expect(chatAd).toBeTruthy();
    expect(chatAd!.state).toBe("available"); // 즉시 사용 가능
    expect(chatAd!.approved_amount ?? chatAd!.expected_amount).toBe(config.chatAdReward);
  });

  it("외부 포스트백으로 chat_ad 사칭 즉시지급은 차단된다", async () => {
    const { ingestConversion } = await import("../src/modules/attribution/attribution.js");
    const r = ingestConversion(
      {
        supplierId: "sup_evil",
        externalConversionId: "spoof_" + R,
        clickId: null,
        source: "chat_ad",
        grossAmount: 100,
        rawPayload: { user_id: U, reward_amount: 999999 },
      },
      "postback" // 외부 경로 → 사칭
    );
    expect(r.status).toBe("rejected");
  });
});
