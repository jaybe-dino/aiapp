// 규칙 기반 사기 점수(기획안 14장). 0(정상)~1(차단). MVP는 결정형 규칙.
import { db } from "../../db/index.js";

export function scoreConversion(p: {
  userId: string | null;
  supplierId: string;
  externalConversionId: string;
  clickId: string | null;
  grossAmount: number;
  source: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1) 클릭 없는 전환(귀속 불명확). 자체 광고망 즉시보상(걷기·대화연장·스폰서대화)은 클릭이 없는 게 정상.
  const selfAdNet = p.source === "cashwalk_ad" || p.source === "chat_ad" || p.source === "sponsor_chat";
  if (!p.clickId && !selfAdNet) {
    score += 0.4;
    reasons.push("클릭 없는 전환");
  }

  // 2) 비정상적으로 큰 금액
  if (p.grossAmount > 200000) {
    score += 0.3;
    reasons.push("비정상 고액");
  }

  // 3) 짧은 시간 다수 전환(속도) — 최근 10분 내 동일 사용자 전환 수.
  //    자체 광고망 소액 보상(서버 내부 경로·일일 상한 있음)은 걷기 연속 청구 등으로 잦을 수 있어 임계 완화.
  if (p.userId) {
    const recent = db
      .prepare(
        "SELECT COUNT(*) AS c FROM conversions WHERE user_id = ? AND received_at > datetime('now','-10 minutes')"
      )
      .get(p.userId) as { c: number };
    if (recent.c >= (selfAdNet ? 12 : 5)) {
      score += 0.4;
      reasons.push("단시간 다수 전환");
    }
  }

  return { score: Math.min(score, 1), reasons };
}

// 점수 구간별 의사결정(14.2)
export function fraudDecision(score: number): "attributed" | "review" | "rejected" {
  if (score >= 0.7) return "rejected";
  if (score >= 0.4) return "review";
  return "attributed";
}
