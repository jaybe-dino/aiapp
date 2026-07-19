// 안전·가드레일 엔진(기획안 9장 고도화).
// 범용 AI 어시스턴트로서 입력을 분류해 (1) 광고 노출 여부, (2) 사용자에게 보여줄 안전 안내,
// (3) LLM에 줄 안전 지침을 결정한다. 50~70대 사용자를 노리는 사기·건강·금융 위험을 우선한다.
export type Decision = "ALLOW" | "ALLOW_WITH_CONSTRAINTS" | "SAFE_COMPLETE" | "BLOCK";
export type SafetyCategory = "scam" | "crisis" | "health" | "finance" | "legal" | "none";

export interface SafetyResource {
  label: string;
  value: string;
}
export interface SafetyNotice {
  level: "info" | "warn" | "critical"; // 표시 강도(친근한 안내 → 강한 경고)
  title: string;
  body: string;
  resources?: SafetyResource[];
}

export interface PolicyResult {
  decision: Decision;
  riskTier: "low" | "medium" | "high";
  commercialAllowed: boolean;
  reasonCodes: string[];
  category: SafetyCategory;
  safetyNotice: SafetyNotice | null;
  // LLM 시스템 프롬프트에 덧붙일 안전 지침(카테고리별). 답변이 안전하게 나오도록 유도.
  guidanceForModel: string | null;
}

const INJECTION = [/이전\s*지시\s*무시/, /시스템\s*프롬프트/, /무시하고\s*답/, /ignore\s+previous/i, /you\s+are\s+now/i, /jailbreak/i];

// 사기 신호(보이스피싱·투자사기·정부지원금 사칭·로맨스/지인 사칭 등). 시니어 피해 1순위.
const SCAM = [
  /원금\s*보장|고수익\s*보장|확정\s*수익|무조건\s*수익|하루\s*\d+%|일\s*\d+%\s*수익/,
  /수수료.*먼저|먼저.*(입금|송금)|보증금.*송금|세금.*먼저\s*(내|입금)/,
  /(인증번호|otp|비밀번호|계좌번호|카드번호|주민등록번호).*(알려|불러|입력|보내)/,
  /(검찰|경찰|금융감독원|금감원|국세청|건강보험).*(계좌|안전계좌|이체|송금|명의)/,
  /(손자|손녀|아들|딸|자녀).*(폰|휴대폰).*(고장|바꿔|급하게).*(돈|송금|입금)/,
  /가상화폐.*리딩|리딩방|코인.*단톡|재택.*고수익|부업.*고수익|정부\s*지원금.*수수료/,
  /낯선\s*사람.*투자|모르는\s*사람.*송금|만난\s*적\s*없.*돈/,
];
// 자살·자해 등 위기.
const CRISIS = [/자살|극단적\s*선택|죽고\s*싶|살기\s*싫|자해|목숨을\s*끊/];
// 건강·의료(진단·처방·치료).
const HEALTH = [/처방|의약품|약\s*(추천|먹|복용)|병원\s*치료|무슨\s*병|증상|진단|암\b|당뇨|고혈압|통증\s*약/];
// 금융(투자·대출·보험 가입 등). 사기와 겹치면 사기 우선.
const FINANCE = [/대출|사채|투자|코인|주식|펀드|보험\s*가입|연금\s*상품|재테크/];
// 법률(상속·소송·계약분쟁).
const LEGAL = [/상속|유언|소송|고소|고발|계약\s*분쟁|사기\s*피해\s*신고/];

const NOTICES: Record<Exclude<SafetyCategory, "none">, SafetyNotice> = {
  scam: {
    level: "critical",
    title: "혹시 사기일 수 있어요. 잠시 멈추세요.",
    body: "‘원금 보장·고수익’, ‘수수료를 먼저 보내라’, ‘인증번호·계좌를 알려달라’, 기관·가족 사칭은 대표적인 사기 수법이에요. 절대 송금하거나 개인정보를 알려주지 마세요. 가족·지인에게 먼저 확인하세요.",
    resources: [
      { label: "경찰(신고)", value: "112" },
      { label: "보이스피싱·금융사기", value: "1332" },
    ],
  },
  crisis: {
    level: "critical",
    title: "많이 힘드셨을 것 같아요. 혼자 견디지 마세요.",
    body: "지금 마음이 많이 힘들다면 도움을 받을 수 있어요. 아래로 연락하면 전문 상담사와 바로 이야기할 수 있어요.",
    resources: [
      { label: "자살예방상담", value: "1393" },
      { label: "정신건강상담", value: "1577-0199" },
    ],
  },
  health: {
    level: "warn",
    title: "건강 문제는 전문의 상담이 가장 안전해요",
    body: "일반적인 정보만 알려드릴 수 있어요. 증상·약·치료는 개인차가 크니, 진단과 처방은 꼭 의사·약사와 상의하세요.",
  },
  finance: {
    level: "warn",
    title: "돈이 오가는 결정은 천천히, 공식 창구에서",
    body: "투자·대출·보험은 원금 손실이나 불리한 조건의 위험이 있어요. ‘보장·고수익’ 같은 말은 특히 조심하세요. 진행 전 금융회사 공식 창구나 가족과 확인하세요.",
    resources: [{ label: "금융 사기 의심 시", value: "1332" }],
  },
  legal: {
    level: "info",
    title: "법률 사안은 전문가 상담을 권해요",
    body: "일반 정보만 안내해 드려요. 상속·계약·소송은 사안마다 달라, 변호사나 대한법률구조공단(국번없이 132) 상담이 안전해요.",
  },
};

const GUIDANCE: Record<Exclude<SafetyCategory, "none">, string> = {
  scam: "사용자가 사기(보이스피싱·투자사기·기관/가족 사칭)에 노출된 정황이다. 절대 송금·개인정보 제공을 부추기지 말고, 멈추고 확인하도록 단호하고 따뜻하게 안내하라. 특정 상품·업체를 권하지 마라.",
  crisis: "정서적 위기 신호다. 판단·조언보다 공감과 즉각적 도움 연결을 우선하라. 위험한 방법을 절대 설명하지 마라. 전문 상담 연락을 안내하라.",
  health: "의료 조언 요청이다. 진단·처방을 단정하지 말고 일반 정보와 함께 전문의 상담을 권하라.",
  finance: "금융 의사결정 요청이다. 특정 상품 추천·수익 보장을 하지 말고, 위험과 공식 확인 절차를 함께 안내하라.",
  legal: "법률 사안이다. 단정적 법률 자문을 피하고 일반 정보와 전문가 상담을 권하라.",
};

function detectCategory(text: string): SafetyCategory {
  if (SCAM.some((re) => re.test(text))) return "scam"; // 사기 최우선
  if (CRISIS.some((re) => re.test(text))) return "crisis";
  if (HEALTH.some((re) => re.test(text))) return "health";
  if (FINANCE.some((re) => re.test(text))) return "finance";
  if (LEGAL.some((re) => re.test(text))) return "legal";
  return "none";
}

export function classifyInput(text: string): PolicyResult {
  const reasonCodes: string[] = [];
  if (INJECTION.some((re) => re.test(text))) reasonCodes.push("prompt_injection", "injection_ignored");

  const category = detectCategory(text);
  if (category === "none") {
    return {
      decision: "ALLOW",
      riskTier: "low",
      commercialAllowed: true,
      reasonCodes,
      category,
      safetyNotice: null,
      guidanceForModel: null,
    };
  }

  // 위험 카테고리: 광고 미노출(불변조건 2) + 안전 안내 + 모델 지침.
  const critical = category === "scam" || category === "crisis";
  return {
    decision: critical ? "SAFE_COMPLETE" : "ALLOW_WITH_CONSTRAINTS",
    riskTier: critical ? "high" : "medium",
    commercialAllowed: false,
    reasonCodes: [...reasonCodes, `risk_${category}`, "commercial_blocked", "safety_notice"],
    category,
    safetyNotice: NOTICES[category],
    guidanceForModel: GUIDANCE[category],
  };
}
