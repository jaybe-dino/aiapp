// Conversation Orchestrator — Answer-First 상태 기계(기획안 6.1).
// 핵심 불변조건: answer.finalized_at 이전에는 오퍼 후보 조회가 절대 일어나지 않는다.
// 이 파일에서 답변을 먼저 '확정'한 뒤에만 commercial 모듈을 호출한다.
import { db } from "../../db/index.js";
import { id, now, sha256 } from "../../lib/id.js";
import { classifyInput } from "./safety.js";
import { generateAnswer, selectRecommendations } from "./provider.js";
import { chatCandidateBriefs, cardsFromPicks, type IntentContext, type OfferCard } from "../commercial/commercial.js";
import { logEvent } from "../analytics/events.js";

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
}

export async function handleTurn(p: { conversationId: string; userId: string; question: string }): Promise<TurnResult> {
  // 1) 입력 안전 판정
  const policy = classifyInput(p.question);

  // 2) 답변 생성 (공급자에게 광고 정보 미전달). 3) 출력은 provider가 구조화 스키마로 반환.
  const answer = await generateAnswer(p.question);

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
    p.question,
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
  };
}
