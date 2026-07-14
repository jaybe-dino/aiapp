// 안전·정책 엔진(기획안 9장)의 MVP 버전.
// 입력/출력/상업화 지점에서 판정. 고위험이면 광고 차단(commercial_allowed=false).
export type Decision = "ALLOW" | "ALLOW_WITH_CONSTRAINTS" | "SAFE_COMPLETE" | "BLOCK";

export interface PolicyResult {
  decision: Decision;
  riskTier: "low" | "medium" | "high";
  commercialAllowed: boolean;
  reasonCodes: string[];
}

const HIGH_RISK = [
  /대출|사채|투자|코인|주식|보험\s*가입/,
  /처방|의약품|약\s*추천|병원\s*치료/,
  /도박|베팅|토토|카지노/,
  /자살|자해|극단적/,
  /상속|장례|유언/,
];

const INJECTION = [/이전\s*지시\s*무시/, /시스템\s*프롬프트/, /ignore\s+previous/i, /you\s+are\s+now/i];

export function classifyInput(text: string): PolicyResult {
  const reasonCodes: string[] = [];
  if (INJECTION.some((re) => re.test(text))) reasonCodes.push("prompt_injection");
  const highRisk = HIGH_RISK.some((re) => re.test(text));

  if (reasonCodes.includes("prompt_injection")) {
    // 인젝션 시도는 무시하고 일반 답변 경로로. 도구/비밀 접근은 애초에 차단됨.
    reasonCodes.push("injection_ignored");
  }

  if (highRisk) {
    return {
      decision: "ALLOW_WITH_CONSTRAINTS",
      riskTier: "high",
      commercialAllowed: false, // 고위험엔 광고 미노출(불변조건 2)
      reasonCodes: [...reasonCodes, "high_risk_category", "commercial_blocked", "expert_referral"],
    };
  }

  return { decision: "ALLOW", riskTier: "low", commercialAllowed: true, reasonCodes };
}
