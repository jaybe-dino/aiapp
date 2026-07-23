// Conversation Orchestrator — Answer-First 상태 기계(기획안 6.1).
// 핵심 불변조건: answer.finalized_at 이전에는 오퍼 후보 조회가 절대 일어나지 않는다.
// 이 파일에서 답변을 먼저 '확정'한 뒤에만 commercial 모듈을 호출한다.
import { db } from "../../db/index.js";
import { config } from "../../config.js";
import { id, now, sha256 } from "../../lib/id.js";
import { classifyInput, redactPII, screenOutput, type SafetyNotice } from "./safety.js";
import { generateAnswer, selectRecommendations, type ChatMessage } from "./provider.js";
import { chatCandidateBriefs, cardsFromPicks, type IntentContext, type OfferCard } from "../commercial/commercial.js";
import { logEvent } from "../analytics/events.js";
import { chatStatus, type ChatStatus } from "./chatgate.js";

export interface TurnResult {
  answerSnapshotId: string;
  finalizedAt: string;
  answer: unknown;
  citations: unknown[];
  policy: { riskTier: string; commercialAllowed: boolean; reasonCodes: string[] };
  commercial: OfferCard | null; // 답변 확정 후에만 채워짐. 없으면 null(No Ad Is Valid).
  matched: { benefits: OfferCard[]; missions: OfferCard[] }; // 주요 요인 매칭: 관련 혜택·미션
  needLevel: "none" | "exploring" | "ready"; // 추천 노출 게이팅(none이면 카드 미노출)
  rewardNudge: "walk" | "mission" | null; // 대화 맥락 기반 걷기/미션 유도(선택)
  safetyNotice: SafetyNotice | null; // 사기·건강·금융 등 위험 감지 시 사용자 안전 안내
  followUps: string[]; // 이어서 물어볼 만한 후속 질문(대화 유도)
  gated?: boolean; // 무료 대화 소진 → '광고 보고 이어가기' 필요(answer=null)
  chat?: ChatStatus; // 대화 잔여/개방 상태
}

/** 대화 이력(멀티턴 기억): 이 대화의 이전 턴들을 user/assistant 메시지로 복원(최근 N턴). */
export function conversationHistory(conversationId: string, maxTurns = 6): ChatMessage[] {
  const rows = db
    .prepare("SELECT question, answer_json FROM answers WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as { question: string; answer_json: string }[];
  const recent = rows.slice(-maxTurns);
  const msgs: ChatMessage[] = [];
  for (const r of recent) {
    msgs.push({ role: "user", content: r.question });
    try {
      const a = JSON.parse(r.answer_json) as { summary?: string; sections?: { body: string }[] };
      const body = [a.summary ?? "", ...(a.sections ?? []).map((s) => s.body)].join(" ").slice(0, 600);
      msgs.push({ role: "assistant", content: body || "(이전 답변)" });
    } catch {
      msgs.push({ role: "assistant", content: "(이전 답변)" });
    }
  }
  return msgs;
}

/** 일일 대화 수(비용·어뷰징 방어용). */
function dailyChatCount(userId: string): number {
  const today = now().slice(0, 10);
  return (db.prepare("SELECT COUNT(*) AS c FROM answers WHERE user_id = ? AND substr(created_at,1,10) = ?").get(userId, today) as { c: number }).c;
}

export async function handleTurn(p: { conversationId: string; userId: string; question: string }): Promise<TurnResult> {
  // 0) 일일 대화 상한(비용/어뷰징 방어). 초과 시 LLM 호출 없이 안내.
  if (dailyChatCount(p.userId) >= config.dailyChatCap) {
    return cappedResult(p);
  }

  // 1) 입력 안전 판정 + 개인정보 마스킹(원문 대신 마스킹본을 LLM 전송·저장에 사용).
  const policy = classifyInput(p.question);
  const safeQuestion = policy.pii ? redactPII(p.question) : p.question;

  // 0-1) 무료 대화 게이트: 소진 시 '광고 보고 이어가기'. 단, 위기·사기(critical) 대화는
  //      절대 막지 않는다(안전이 수익화보다 우선). 게이트 상태는 답변 없이 반환.
  const gate = chatStatus(p.userId);
  if (gate.locked && policy.safetyNotice?.level !== "critical") {
    logEvent("chat_gated", p.userId, { used: gate.used, allowance: gate.allowance });
    return gatedResult(p, gate);
  }

  // 2) 답변 생성 (공급자에게 광고 정보 미전달). 위험 감지 시 안전 지침·대화 이력을 함께 전달.
  //    3) 출력은 provider가 구조화 스키마로 반환.
  const history = conversationHistory(p.conversationId);
  const answer = await generateAnswer(safeQuestion, config.aiModelTier, policy.guidanceForModel, history);

  // [비용 실측] 이번 턴 토큰·추정비용을 KPI 이벤트로. answer_json 오염 방지 위해 분리·삭제.
  const usage = (answer as { usage?: any }).usage;
  delete (answer as { usage?: any }).usage;
  if (usage) {
    // Haiku 4.5 단가: 입력 $1 · 출력 $5 · 캐시쓰기 1.25배 · 캐시읽기 0.1배 (per 1M) + 검색 $0.01/회
    const costUsd =
      (usage.input * 1 + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1 + usage.output * 5) / 1_000_000 +
      (usage.searched ? 0.01 : 0);
    logEvent("llm_usage", p.userId, {
      input: usage.input, output: usage.output, cache_read: usage.cacheRead, cache_write: usage.cacheWrite,
      searched: usage.searched, cost_usd: Number(costUsd.toFixed(6)), cost_krw: Math.round(costUsd * 1400),
    });
  }

  // 3-1) 출력 스크리닝(심층 방어): 위험 내용이 새어 나오면 안전 문구로 대체.
  if (!screenOutput(answer.summary, answer.sections).safe) {
    answer.summary = "죄송해요, 그 내용은 안전을 위해 자세히 안내하기 어려워요. 다른 방식으로 도와드릴게요.";
    answer.sections = [];
    answer.need_level = "none";
  }

  // 4) 답변 확정 — 시각과 해시를 기록. 이 시점 이전에 오퍼 조회 없음.
  const answerSnapshotId = id("ans");
  const finalizedAt = now();
  const answerJson = JSON.stringify(answer);
  const contentHash = sha256(answerJson);
  db.prepare(
    `INSERT INTO answers (answer_snapshot_id, conversation_id, user_id, question, answer_json, content_hash, risk_tier, commercial_allowed, need_level, reward_nudge, finalized_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    answerSnapshotId,
    p.conversationId,
    p.userId,
    safeQuestion, // 개인정보 마스킹본 저장(원문 평문 보관 금지)
    answerJson,
    contentHash,
    policy.riskTier,
    policy.commercialAllowed ? 1 : 0,
    answer.need_level,
    answer.reward_nudge,
    finalizedAt,
    finalizedAt
  );
  // KPI: 니즈 게이팅 결과·카테고리를 이벤트로(큐레이션 오탐 튜닝의 근거).
  logEvent("answer_finalized", p.userId, {
    need_level: answer.need_level,
    reward_nudge: answer.reward_nudge,
    category: answer.suggested_category,
    risk_tier: policy.riskTier,
  });
  // 안전: 위험 카테고리·개인정보 감지 시 별도 이벤트로 관측(가드레일 튜닝·관리).
  if (policy.category !== "none" || policy.pii) {
    logEvent("safety_flag", p.userId, { category: policy.category, pii: policy.pii, level: policy.safetyNotice?.level });
  }

  // 5) 답변 확정 '후'에만 제한된 의도 문맥 생성.
  //    원문/민감정보는 넘기지 않고 카테고리·지역·허용여부만 전달(기획안 12.2).
  const intent: IntentContext = {
    category: answer.suggested_category === "null" ? null : answer.suggested_category,
    priceBand: "mid",
    region: "KR",
    commercialAllowed: policy.commercialAllowed,
  };

  // 6) 니즈가 있을 때만(none이면 광고 미노출) 2단계 LLM 큐레이션.
  //    후보 풀만 뽑아 LLM에 넘기고, LLM이 '판단'해서 고른 것만 카드로 복원한다.
  let matched: { benefits: OfferCard[]; missions: OfferCard[] } = { benefits: [], missions: [] };
  if (answer.need_level !== "none" && policy.commercialAllowed) {
    const briefs = chatCandidateBriefs(intent);
    const picks = await selectRecommendations(
      { category: intent.category, needLevel: answer.need_level, needSummary: answer.need_summary },
      briefs
    );
    matched = cardsFromPicks(picks);
  }
  const commercial = matched.benefits[0] ?? null; // 하위호환: 단일 오퍼 필드

  // KPI: 실제로 추천이 노출됐는지(큐레이터가 고른 개수). 니즈는 있었는데 0개면 커버리지 부족 신호.
  if (answer.need_level !== "none") {
    logEvent("reco_shown", p.userId, {
      need_level: answer.need_level,
      benefits: matched.benefits.length,
      missions: matched.missions.length,
    });
  }

  return {
    answerSnapshotId,
    finalizedAt,
    answer,
    citations: [], // MVP: RAG 인용 생략(구조만 유지)
    policy,
    commercial,
    matched,
    needLevel: answer.need_level,
    rewardNudge: answer.reward_nudge,
    safetyNotice: policy.safetyNotice,
    // 위기·사기 등 강한 안전 상황에서는 후속 질문을 노출하지 않는다.
    followUps: policy.safetyNotice?.level === "critical" ? [] : answer.follow_ups,
    gated: false,
    chat: chatStatus(p.userId), // 이번 답변 반영 후 잔여 상태
  };
}

/** 무료 대화 소진 → 답변 없이 '광고 보고 이어가기' 게이트를 반환. */
function gatedResult(p: { conversationId: string; userId: string; question: string }, gate: ChatStatus): TurnResult {
  return {
    answerSnapshotId: id("ans"),
    finalizedAt: now(),
    answer: null, // 답변하지 않음(광고 시청 후 재요청)
    citations: [],
    policy: { riskTier: "low", commercialAllowed: false, reasonCodes: ["chat_gate"] },
    commercial: null,
    matched: { benefits: [], missions: [] },
    needLevel: "none",
    rewardNudge: null,
    safetyNotice: null,
    followUps: [],
    gated: true,
    chat: gate,
  };
}

/** 일일 대화 상한 초과 시 LLM 호출 없이 반환하는 안내(비용/어뷰징 방어). */
function cappedResult(p: { conversationId: string; userId: string; question: string }): TurnResult {
  logEvent("chat_capped", p.userId, {});
  return {
    answerSnapshotId: id("ans"),
    finalizedAt: now(),
    answer: {
      summary: "오늘 대화 이용량이 많아, 잠시 후 다시 도와드릴게요.",
      sections: [{ title: "안내", body: "무리한 사용을 막기 위한 하루 한도예요. 내일 다시 편하게 물어보실 수 있어요." }],
      uncertainty: { level: "low", message: "" },
      suggested_category: null,
      need_level: "none",
      reward_nudge: null,
      need_summary: "",
      follow_ups: [],
    },
    citations: [],
    policy: { riskTier: "low", commercialAllowed: false, reasonCodes: ["daily_cap"] },
    commercial: null,
    matched: { benefits: [], missions: [] },
    needLevel: "none",
    rewardNudge: null,
    safetyNotice: null,
    followUps: [],
  };
}
