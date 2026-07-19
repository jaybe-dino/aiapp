// 멀티턴 대화 기억 + 일일 대화 상한 테스트.
import { beforeAll, describe, it, expect, vi } from "vitest";
import { applySchema, db } from "../src/db/index.js";
import { id, now, sha256 } from "../src/lib/id.js";
import { conversationHistory } from "../src/modules/ai/orchestrator.js";

const R = Math.random().toString(36).slice(2, 8);
const CONV = "cnv_mem_" + R;
const U = "usr_mem_" + R;

function insertAnswer(conv: string, user: string, q: string, summary: string) {
  db.prepare(
    `INSERT INTO answers (answer_snapshot_id, conversation_id, user_id, question, answer_json, content_hash, risk_tier, commercial_allowed, need_level, reward_nudge, finalized_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'low', 1, 'none', NULL, ?, ?)`
  ).run(id("ans"), conv, user, q, JSON.stringify({ summary, sections: [] }), sha256(summary), now(), now());
}

beforeAll(() => applySchema());

describe("멀티턴 대화 기억", () => {
  it("이전 턴을 user/assistant 메시지로 복원한다", () => {
    insertAnswer(CONV, U, "정수기 렌탈 알아봐", "정수기 렌탈 핵심을 정리해 드릴게요");
    insertAnswer(CONV, U, "비데는?", "비데 렌탈도 정리해 드릴게요");
    const h = conversationHistory(CONV);
    expect(h.length).toBe(4);
    expect(h[0]).toEqual({ role: "user", content: "정수기 렌탈 알아봐" });
    expect(h[1]!.role).toBe("assistant");
    expect(h[1]!.content).toContain("정수기 렌탈");
    expect(h[2]).toEqual({ role: "user", content: "비데는?" });
  });

  it("최근 N턴으로 제한한다(토큰 방어)", () => {
    const c2 = "cnv_mem2_" + R;
    for (let i = 0; i < 10; i++) insertAnswer(c2, U, "질문" + i, "답변" + i);
    expect(conversationHistory(c2, 3).length).toBe(6); // 3턴 × (user+assistant)
  });
});

describe("일일 대화 상한", () => {
  it("상한 초과 시 LLM 호출 없이 안내를 반환한다", async () => {
    process.env.DAILY_CHAT_CAP = "1";
    vi.resetModules();
    const { handleTurn } = await import("../src/modules/ai/orchestrator.js");
    const cu = "usr_cap_" + R;
    insertAnswer("cnv_cap_" + R, cu, "이전 질문", "이전 답변"); // 오늘 1건 → cap 1 도달
    const r = await handleTurn({ conversationId: "cnv_cap_" + R, userId: cu, question: "하나 더 물어봐도 돼?" });
    expect((r.answer as { summary: string }).summary).toContain("이용량");
    expect(r.needLevel).toBe("none");
    process.env.DAILY_CHAT_CAP = "";
  });
});
