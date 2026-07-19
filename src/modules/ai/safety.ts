// 안전·가드레일 엔진(기획안 9장 고도화).
// 범용 AI 어시스턴트로서 입력·출력을 분류·필터한다.
//  - 입력: 위험 카테고리(사기·위기·건강·금융·법률·성인) 감지 + 개인정보(PII) 감지·마스킹.
//  - 출력: 생성된 답변에 위험 내용이 새어 나오지 않도록 최종 스크리닝.
//  - 운영: 카테고리별 활성화·안내문을 DB(guardrail_rules)에서 오버라이드(콘솔 관리).
import { db } from "../../db/index.js";
import { now } from "../../lib/id.js";

export type Decision = "ALLOW" | "ALLOW_WITH_CONSTRAINTS" | "SAFE_COMPLETE" | "BLOCK";
export type SafetyCategory = "scam" | "crisis" | "health" | "finance" | "legal" | "adult" | "none";

export interface SafetyResource { label: string; value: string; }
export interface SafetyNotice {
  level: "info" | "warn" | "critical";
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
  pii: boolean; // 사용자가 개인정보(주민번호·카드·계좌 등)를 입력함
  safetyNotice: SafetyNotice | null;
  guidanceForModel: string | null;
}

const INJECTION = [/이전\s*지시\s*무시/, /시스템\s*프롬프트/, /무시하고\s*답/, /ignore\s+previous/i, /you\s+are\s+now/i, /jailbreak/i];

const SCAM = [
  /원금\s*보장|고수익\s*보장|확정\s*수익|무조건\s*수익|하루\s*\d+%|일\s*\d+%\s*수익/,
  /수수료.*먼저|먼저.*(입금|송금)|보증금.*송금|세금.*먼저\s*(내|입금)/,
  /(인증번호|otp|비밀번호|계좌번호|카드번호|주민등록번호).*(알려|불러|입력|보내)/,
  /(검찰|경찰|금융감독원|금감원|국세청|건강보험).*(계좌|안전계좌|이체|송금|명의)/,
  /(손자|손녀|아들|딸|자녀).*(폰|휴대폰).*(고장|바꿔|급하게).*(돈|송금|입금)/,
  /가상화폐.*리딩|리딩방|코인.*단톡|재택.*고수익|부업.*고수익|정부\s*지원금.*수수료/,
  /낯선\s*사람.*투자|모르는\s*사람.*송금|만난\s*적\s*없.*돈/,
];
const CRISIS = [/자살|극단적\s*선택|죽고\s*싶|살기\s*싫|자해|목숨을\s*끊/];
const HEALTH = [/처방|의약품|약\s*(추천|먹|복용)|병원\s*치료|무슨\s*병|증상|진단|암\b|당뇨|고혈압|통증\s*약/];
const FINANCE = [/대출|사채|투자|코인|주식|펀드|보험\s*가입|연금\s*상품|재테크/];
const LEGAL = [/상속|유언|소송|고소|고발|계약\s*분쟁|사기\s*피해\s*신고/];
const ADULT = [/성인\s*(영상|사이트)|음란|야한\s*사진|성적인\s*(사진|영상)/];

// 개인정보(PII): 주민등록번호·카드번호·계좌·긴 숫자열. 오탐 방지를 위해 형태를 좁게.
const PII = [
  /\b\d{6}\s*[-]\s*\d{7}\b/, // 주민등록번호
  /\b(?:\d[ -]?){15,16}\b/, // 카드번호(15~16자리)
  /계좌\s*번호는?\s*\d{6,}/, // "계좌번호는 12345678"
];

const DEFAULT_NOTICES: Record<Exclude<SafetyCategory, "none">, SafetyNotice> = {
  scam: {
    level: "critical",
    title: "혹시 사기일 수 있어요. 잠시 멈추세요.",
    body: "‘원금 보장·고수익’, ‘수수료를 먼저 보내라’, ‘인증번호·계좌를 알려달라’, 기관·가족 사칭은 대표적인 사기 수법이에요. 절대 송금하거나 개인정보를 알려주지 마세요. 가족·지인에게 먼저 확인하세요.",
    resources: [{ label: "경찰(신고)", value: "112" }, { label: "보이스피싱·금융사기", value: "1332" }],
  },
  crisis: {
    level: "critical",
    title: "많이 힘드셨을 것 같아요. 혼자 견디지 마세요.",
    body: "지금 마음이 많이 힘들다면 도움을 받을 수 있어요. 아래로 연락하면 전문 상담사와 바로 이야기할 수 있어요.",
    resources: [{ label: "자살예방상담", value: "1393" }, { label: "정신건강상담", value: "1577-0199" }],
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
  adult: {
    level: "warn",
    title: "이 주제는 도와드리기 어려워요",
    body: "성인·선정적 콘텐츠는 안내하지 않아요. 생활·건강·쇼핑 등 다른 궁금한 점을 도와드릴게요.",
  },
};

const PII_NOTICE: SafetyNotice = {
  level: "warn",
  title: "개인정보는 입력하지 않으셔도 돼요",
  body: "주민등록번호·카드번호·계좌번호 같은 정보는 채팅에 적지 마세요. 저희는 이런 정보가 필요하지 않고, 어디에도 요구하지 않아요. 입력하신 내용은 안전을 위해 가려서 처리했어요.",
};

const GUIDANCE: Record<Exclude<SafetyCategory, "none">, string> = {
  scam: "사용자가 사기(보이스피싱·투자사기·기관/가족 사칭)에 노출된 정황이다. 절대 송금·개인정보 제공을 부추기지 말고, 멈추고 확인하도록 단호하고 따뜻하게 안내하라. 특정 상품·업체를 권하지 마라.",
  crisis: "정서적 위기 신호다. 판단·조언보다 공감과 즉각적 도움 연결을 우선하라. 위험한 방법을 절대 설명하지 마라. 전문 상담 연락을 안내하라.",
  health: "의료 조언 요청이다. 진단·처방을 단정하지 말고 일반 정보와 함께 전문의 상담을 권하라.",
  finance: "금융 의사결정 요청이다. 특정 상품 추천·수익 보장을 하지 말고, 위험과 공식 확인 절차를 함께 안내하라.",
  legal: "법률 사안이다. 단정적 법률 자문을 피하고 일반 정보와 전문가 상담을 권하라.",
  adult: "성인·선정적 콘텐츠 요청이다. 정중히 거절하고 다른 도움을 제안하라.",
};

function detectCategory(text: string): SafetyCategory {
  if (SCAM.some((re) => re.test(text))) return "scam";
  if (CRISIS.some((re) => re.test(text))) return "crisis";
  if (ADULT.some((re) => re.test(text))) return "adult";
  if (HEALTH.some((re) => re.test(text))) return "health";
  if (FINANCE.some((re) => re.test(text))) return "finance";
  if (LEGAL.some((re) => re.test(text))) return "legal";
  return "none";
}

export function containsPII(text: string): boolean {
  return PII.some((re) => re.test(text));
}
/** 저장·전송 전에 개인정보를 마스킹. 원문 대신 마스킹본을 보관한다. */
export function redactPII(text: string): string {
  return text
    .replace(/\b\d{6}\s*[-]\s*\d{7}\b/g, "[개인정보 가림]")
    .replace(/\b(?:\d[ -]?){15,16}\b/g, "[개인정보 가림]")
    .replace(/(계좌\s*번호는?\s*)\d{6,}/g, "$1[개인정보 가림]");
}

// ── 운영 오버라이드(guardrail_rules) ─────────────────────────────────
interface RuleRow { category: string; enabled: number; notice_title: string | null; notice_body: string | null; }
function ruleFor(category: string): RuleRow | undefined {
  try {
    return db.prepare("SELECT category, enabled, notice_title, notice_body FROM guardrail_rules WHERE category = ?").get(category) as RuleRow | undefined;
  } catch {
    return undefined; // 스키마 이전/테스트 등에서 안전 폴백
  }
}
function resolveNotice(category: Exclude<SafetyCategory, "none">): SafetyNotice {
  const base = DEFAULT_NOTICES[category];
  const rule = ruleFor(category);
  if (!rule) return base;
  return { ...base, title: rule.notice_title ?? base.title, body: rule.notice_body ?? base.body };
}
function isEnabled(category: string): boolean {
  const rule = ruleFor(category);
  return rule ? rule.enabled === 1 : true; // 기본 활성
}

export function classifyInput(text: string): PolicyResult {
  const reasonCodes: string[] = [];
  if (INJECTION.some((re) => re.test(text))) reasonCodes.push("prompt_injection", "injection_ignored");

  const pii = containsPII(text);
  let category = detectCategory(text);
  if (category !== "none" && !isEnabled(category)) category = "none"; // 운영자가 끈 카테고리

  if (category === "none") {
    // 위험 카테고리는 아니지만 개인정보 입력 시 안내(광고는 그대로 허용).
    if (pii) {
      return {
        decision: "ALLOW", riskTier: "low", commercialAllowed: true,
        reasonCodes: [...reasonCodes, "pii_detected", "pii_redacted"],
        category: "none", pii: true, safetyNotice: PII_NOTICE, guidanceForModel: null,
      };
    }
    return { decision: "ALLOW", riskTier: "low", commercialAllowed: true, reasonCodes, category: "none", pii: false, safetyNotice: null, guidanceForModel: null };
  }

  const critical = category === "scam" || category === "crisis";
  return {
    decision: critical ? "SAFE_COMPLETE" : "ALLOW_WITH_CONSTRAINTS",
    riskTier: critical ? "high" : "medium",
    commercialAllowed: false,
    reasonCodes: [...reasonCodes, `risk_${category}`, "commercial_blocked", "safety_notice", ...(pii ? ["pii_detected", "pii_redacted"] : [])],
    category,
    pii,
    safetyNotice: resolveNotice(category),
    guidanceForModel: GUIDANCE[category],
  };
}

// ── 출력 스크리닝 ────────────────────────────────────────────────────
// 생성된 답변에 위험 내용이 새어 나오면 방어(심층 방어). 매칭 시 안전 문구로 대체.
const OUTPUT_BLOCK = [
  /여기로?\s*(송금|입금|이체)하세요/,
  /계좌\s*번호는?\s*\d{6,}/,
  /(자살|자해)\s*(방법|하는\s*법)/,
];
export function screenOutput(summary: string, sections: { title: string; body: string }[]): { safe: boolean } {
  const blob = summary + " " + sections.map((s) => s.body).join(" ");
  return { safe: !OUTPUT_BLOCK.some((re) => re.test(blob)) };
}

// ── 운영 콘솔용 헬퍼 ─────────────────────────────────────────────────
export const GUARDRAIL_CATEGORIES: Exclude<SafetyCategory, "none">[] = ["scam", "crisis", "health", "finance", "legal", "adult"];
export function guardrailConfig(): { category: string; enabled: boolean; title: string; body: string; level: string; customized: boolean }[] {
  return GUARDRAIL_CATEGORIES.map((c) => {
    const rule = ruleFor(c);
    const base = DEFAULT_NOTICES[c];
    return {
      category: c,
      enabled: rule ? rule.enabled === 1 : true,
      title: rule?.notice_title ?? base.title,
      body: rule?.notice_body ?? base.body,
      level: base.level,
      customized: !!(rule && (rule.notice_title || rule.notice_body)),
    };
  });
}
export function updateGuardrail(category: string, patch: { enabled?: boolean; title?: string | null; body?: string | null }, by: string): void {
  if (!GUARDRAIL_CATEGORIES.includes(category as any)) throw new Error("알 수 없는 가드레일 카테고리");
  const existing = ruleFor(category);
  const enabled = patch.enabled === undefined ? (existing ? existing.enabled : 1) : patch.enabled ? 1 : 0;
  const title = patch.title === undefined ? existing?.notice_title ?? null : patch.title;
  const body = patch.body === undefined ? existing?.notice_body ?? null : patch.body;
  db.prepare(
    `INSERT INTO guardrail_rules (category, enabled, notice_title, notice_body, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(category) DO UPDATE SET enabled = excluded.enabled, notice_title = excluded.notice_title, notice_body = excluded.notice_body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(category, enabled, title, body, now(), by);
}
