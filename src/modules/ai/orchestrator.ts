// Conversation Orchestrator — Answer-First 상태 기계(기획안 6.1).
// 핵심 불변조건: answer.finalized_at 이전에는 오퍼 후보 조회가 절대 일어나지 않는다.
// 이 파일에서 답변을 먼저 '확정'한 뒤에만 commercial 모듈을 호출한다.
import { db } from "../../db/index.js";
import { id, now, sha256 } from "../../lib/id.js";
import { classifyInput } from "./safety.js";
import { generateAnswer } from "./provider.js";
import { selectOfferForAnswer, type IntentContext, type OfferCard } from "../commercial/commercial.js";

export interface TurnResult {
  answerSnapshotId: string;
  finalizedAt: string;
  answer: unknown;
  citations: unknown[];
  policy: { riskTier: string; commercialAllowed: boolean; reasonCodes: string[] };
  commercial: OfferCard | null; // 답변 확정 후에만 채워짐. 없으면 null(No Ad Is Valid).
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
    `INSERT INTO answers (answer_snapshot_id, conversation_id, user_id, question, answer_json, content_hash, risk_tier, commercial_allowed, finalized_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    answerSnapshotId,
    p.conversationId,
    p.userId,
    p.question,
    answerJson,
    contentHash,
    policy.riskTier,
    policy.commercialAllowed ? 1 : 0,
    finalizedAt,
    finalizedAt
  );

  // 5) 답변 확정 '후'에만 제한된 의도 문맥 생성 → 커머셜 호출.
  //    원문/민감정보는 넘기지 않고 카테고리·지역·허용여부만 전달(기획안 12.2).
  const intent: IntentContext = {
    category: answer.suggested_category === "null" ? null : answer.suggested_category,
    priceBand: "mid",
    region: "KR",
    commercialAllowed: policy.commercialAllowed,
  };
  const commercial = selectOfferForAnswer(intent);

  return {
    answerSnapshotId,
    finalizedAt,
    answer,
    citations: [], // MVP: RAG 인용 생략(구조만 유지)
    policy,
    commercial,
  };
}
