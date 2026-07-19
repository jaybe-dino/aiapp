// Model Gateway(기획안 7.2). 공급자 이름을 제품 로직에 노출하지 않고 능력 등급으로 추상화.
// ANTHROPIC_API_KEY 가 있으면 최신 Claude 모델을 호출하고, 없으면 결정형 mock 으로 폴백(키 없이 실행 가능).
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";

// 능력 등급 → 실제 모델 매핑.
// fast=Claude Haiku 4.5 — 현재 가장 저렴한 Claude 모델($1/$5 per 1M). 기본값.
const TIER_MODEL: Record<string, string> = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  reasoning: "claude-opus-4-8",
};

export type NeedLevel = "none" | "exploring" | "ready";
export type RewardNudge = "walk" | "mission" | null;

export interface StructuredAnswer {
  summary: string;
  sections: { title: string; body: string; importance: "high" | "medium" | "low" }[];
  next_actions: { label: string; action_type: string }[];
  uncertainty: { level: "low" | "medium" | "high"; message: string };
  suggested_category: string | null; // 광고 의도 문맥용 카테고리 힌트(원문 아님)
  // 대화 맥락에서 상업적 도움을 '지금' 얼마나 원하는지. 이 값으로 추천 노출을 게이팅한다.
  //  none=니즈 없음(카드 미노출) · exploring=관심/불편 드러남(부드러운 제안) · ready=구매·신청 의사(전체 카드)
  need_level: NeedLevel;
  // 대화 맥락에 맞을 때만 얹는 리워드 유도. 걷기/미션 포인트를 자연스럽게 연결.
  reward_nudge: RewardNudge;
  // 2단계 추천 큐레이터에 넘길 '중립적 니즈 요약'(원문 아님). 예: "정수기 렌탈 조건 비교를 원함".
  need_summary: string;
  // 이어서 물어볼 만한 짧은 후속 질문(사용자 입장). 대화를 자연스럽게 이어가도록 유도.
  follow_ups: string[];
}

// 2단계(추천 큐레이션)용 후보 요약. 커머셜 모듈이 답변 확정 '후'에 채워 넘긴다(수수료 정보 없음).
export interface OfferBrief {
  offerSnapshotId: string;
  kind: "benefit" | "mission";
  category: string;
  advertiserName: string;
  title: string;
  isRental: boolean;
  monthlyFee: number | null;
  totalCost: number;
  expectedReward: number;
  autoRenewal: boolean;
  mandatoryMonths: number | null;
  dataSharing: string;
}

export interface RecoPick {
  offerSnapshotId: string;
  kind: "benefit" | "mission";
  reason: string; // LLM(또는 폴백)이 이 니즈에 맞춰 쓴 추천 이유
}

const SYSTEM_POLICY = `당신은 한국 55~69세 사용자를 돕는 생활비서 AI입니다.
원칙:
- 광고/수수료 정보는 당신에게 주어지지 않습니다. 답변은 광고와 무관하게 완결하세요.
- 큰 흐름은 '한 줄 결론 → 근거/비교 → 다음 행동' 순으로.
- 가격·정책처럼 변동 가능한 정보는 불확실성과 확인 시점을 함께 알리세요.
- 건강·금융·법률 등 고위험은 단정하지 말고 전문기관 확인을 안내하세요.

[추천 게이팅 — 매우 중요]
사용자가 '지금' 상업적 도움을 원하는 정도를 need_level 로 판정하세요. 광고는 필요할 때만 붙습니다.
- "ready": 특정 상품·서비스를 지금 사거나 신청·예약·가입·계약하려는 명확한 의사. 예) "정수기 렌탈 신청하려고", "부산 호텔 예약할래", "이 설문 할래".
- "exploring": 대화 속에 불편·니즈·비교 관심이 드러나지만 행동 의사는 약함. 예) "요즘 물값이 부담돼", "정수기 있으면 좋을까?", "여행 가고 싶다".
- "none": 정보 질문·잡담·감정·인사·고위험 등 상업 니즈가 없음. 예) "오늘 날씨", "손주 이름 뭐가 좋을까", "무릎이 아파".
확신이 없으면 낮은 쪽(none)으로. 광고를 억지로 붙이지 마세요.

reward_nudge: 대화가 건강·산책·운동·소일거리·용돈·절약과 닿아 있고 need_level 이 none/exploring 이면 "walk"(걷기 포인트),
설문·짧은 미션으로 포인트 모으기가 자연스러우면 "mission", 아니면 null.

반드시 아래 JSON 스키마로만 답하세요:
{"summary": string, "sections": [{"title": string, "body": string, "importance": "high|medium|low"}],
 "next_actions": [{"label": string, "action_type": string}],
 "uncertainty": {"level": "low|medium|high", "message": string},
 "suggested_category": "travel|shopping|rental|survey|life|null 중 하나(정수기·비데·공기청정기 렌탈/구독 문의는 rental)",
 "need_level": "none|exploring|ready",
 "reward_nudge": "walk|mission|null",
 "need_summary": "상업적 니즈를 한 문장으로 중립 요약(광고 판단 금지, 없으면 빈 문자열)",
 "follow_ups": ["이어서 물어볼 만한 짧은 질문 2~3개(사용자 입장 1인칭, 각 20자 내외). 위험 주제면 빈 배열."]}`;

// ── 2단계: 추천 큐레이터 ──────────────────────────────────────────────
// 답변 확정 '후'에만 호출된다. LLM이 후보 오퍼 중 이 니즈에 정말 맞는 것만 고르고 이유를 쓴다.
// 정해진 DB 랭킹 프레임이 아니라 LLM 판단으로 추천(정합성 없으면 빈 배열).
const CURATOR_POLICY = `당신은 한국 시니어 사용자를 위한 '혜택 큐레이터'입니다.
사용자의 니즈와 검수된 후보 목록을 보고, 지금 이 사람에게 정말 도움이 되는 것만 고르세요.
규칙:
- 수수료·광고주 이익이 아니라 사용자 이득(보상 포인트, 조건의 유리함) 기준으로 판단.
- 억지로 채우지 마세요. 맞는 게 없으면 picks 를 빈 배열로.
- need_level=ready 면 가장 잘 맞는 benefit 1개(필요시 mission 1개까지). exploring 이면 최대 1개만 부드럽게.
- 자동결제·의무약정·연락처 전달 같은 부담은 이유에 솔직히 반영.
- reason 은 40자 내외로, 왜 이 사람에게 맞는지 따뜻하고 구체적으로.
반드시 JSON 으로만: {"picks":[{"offerSnapshotId": string, "kind": "benefit|mission", "reason": string}]}`;

export async function selectRecommendations(
  input: { category: string | null; needLevel: NeedLevel; needSummary: string },
  briefs: OfferBrief[]
): Promise<RecoPick[]> {
  if (input.needLevel === "none" || !briefs.length) return [];
  if (!config.anthropicApiKey) return mockCurate(input, briefs);

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const model = TIER_MODEL[config.aiModelTier] ?? TIER_MODEL.fast!;
    const payload = {
      user_need: { category: input.category, need_level: input.needLevel, summary: input.needSummary },
      candidates: briefs.map((b) => ({
        offerSnapshotId: b.offerSnapshotId, kind: b.kind, category: b.category, title: b.title,
        advertiser: b.advertiserName, isRental: b.isRental, monthlyFee: b.monthlyFee, totalCost: b.totalCost,
        rewardPoint: b.expectedReward, autoRenewal: b.autoRenewal, mandatoryMonths: b.mandatoryMonths, dataSharing: b.dataSharing,
      })),
    };
    const resp = await client.messages.create({
      model,
      max_tokens: 700,
      system: CURATOR_POLICY,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const json = extractJson(text);
    const picks = Array.isArray((json as any).picks) ? (json as any).picks : [];
    const valid = new Map(briefs.map((b) => [b.offerSnapshotId, b]));
    return picks
      .filter((p: any) => p && valid.has(p.offerSnapshotId))
      .slice(0, 2)
      .map((p: any) => ({
        offerSnapshotId: p.offerSnapshotId,
        kind: (p.kind === "mission" ? "mission" : "benefit") as "benefit" | "mission",
        reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : valid.get(p.offerSnapshotId)!.title,
      }));
  } catch {
    return mockCurate(input, briefs);
  }
}

// 키 없을 때: LLM 없이도 '판단형' 추천을 흉내 — 사용자 순가치로 고르고 니즈 맞춤 이유를 생성.
function mockCurate(input: { category: string | null; needLevel: NeedLevel }, briefs: OfferBrief[]): RecoPick[] {
  const benefits = briefs.filter((b) => b.kind === "benefit");
  const missions = briefs.filter((b) => b.kind === "mission");
  const score = (b: OfferBrief) => b.expectedReward - (b.autoRenewal ? 1500 : 0) - (input.category && b.category !== input.category ? 3000 : 0);
  const picks: RecoPick[] = [];
  const topBenefit = benefits.sort((a, b) => score(b) - score(a))[0];
  if (topBenefit) {
    const reason = topBenefit.isRental
      ? `말씀하신 니즈에 맞는 렌탈이에요. 설치 확정 시 ${fmt(topBenefit.expectedReward)}P 적립(의무 ${topBenefit.mandatoryMonths ?? "-"}개월 확인).`
      : `조건 대비 적립이 커요. 확정 시 최대 ${fmt(topBenefit.expectedReward)}P.`;
    picks.push({ offerSnapshotId: topBenefit.offerSnapshotId, kind: "benefit", reason });
  }
  // ready 이거나 마땅한 혜택이 없을 때만 미션을 가볍게 곁들임.
  const topMission = missions[0];
  if (topMission && (input.needLevel === "ready" || !topBenefit)) {
    picks.push({ offerSnapshotId: topMission.offerSnapshotId, kind: "mission", reason: `${fmt(topMission.expectedReward)}P — 짧게 참여하고 포인트 받기.` });
  }
  return picks.slice(0, 2);
}

function fmt(n: number): string { return n.toLocaleString("ko-KR"); }

export async function generateAnswer(question: string, tier = config.aiModelTier, safetyGuidance?: string | null): Promise<StructuredAnswer> {
  if (!config.anthropicApiKey) return mockAnswer(question);

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const model = TIER_MODEL[tier] ?? TIER_MODEL.fast!;
    // 안전 엔진이 위험 카테고리를 감지하면 그 지침을 시스템 프롬프트에 덧붙여 안전하게 답하도록 유도.
    const system = safetyGuidance ? `${SYSTEM_POLICY}\n\n[안전 지침]\n${safetyGuidance}` : SYSTEM_POLICY;
    const resp = await client.messages.create({
      model,
      max_tokens: 2048, // 한국어 전체 답변+스키마가 잘려 JSON 파싱 실패하지 않도록 여유 확보
      system,
      messages: [{ role: "user", content: question }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const json = extractJson(text);
    return normalize(json, question);
  } catch (err) {
    // 공급자 장애 시 안전 폴백(기획안 9.4). 답변 경로가 광고 때문에 실패하지 않듯, LLM 장애도 격리.
    return mockAnswer(question, true);
  }
}

function extractJson(text: string): Record<string, unknown> {
  // ```json 코드펜스 제거 후 첫 { ~ 마지막 } 구간을 파싱.
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  return {};
}

function normalize(json: Record<string, unknown>, question: string): StructuredAnswer {
  const base = mockAnswer(question);
  const need = json.need_level as string;
  const nudge = json.reward_nudge as string;
  return {
    summary: (json.summary as string) ?? base.summary,
    sections: (json.sections as StructuredAnswer["sections"]) ?? base.sections,
    next_actions: (json.next_actions as StructuredAnswer["next_actions"]) ?? base.next_actions,
    uncertainty: (json.uncertainty as StructuredAnswer["uncertainty"]) ?? base.uncertainty,
    suggested_category: (json.suggested_category as string) ?? base.suggested_category,
    need_level: (["none", "exploring", "ready"].includes(need) ? need : base.need_level) as NeedLevel,
    reward_nudge: (nudge === "walk" || nudge === "mission" ? nudge : null) as RewardNudge,
    need_summary: typeof json.need_summary === "string" ? json.need_summary : base.need_summary,
    follow_ups: Array.isArray(json.follow_ups) ? (json.follow_ups as unknown[]).filter((x) => typeof x === "string").slice(0, 3) as string[] : base.follow_ups,
  };
}

// 키가 없어도 데모가 동작하도록 하는 결정형 답변. 질문 키워드로 카테고리·니즈강도를 추정.
function mockAnswer(question: string, degraded = false): StructuredAnswer {
  const q = question.toLowerCase();
  let category: string | null = "life";
  if (/렌탈|렌트|구독|정수기|비데|안마의자|매트리스|공기청정기\s*렌/.test(q)) category = "rental";
  else if (/여행|부산|제주|숙박|호텔|기차|ktx|항공|비행기/.test(q)) category = "travel";
  else if (/쇼핑|구매|가격|최저가|사려|살까|사는|싸게|필터|청정기|제품|배송|주문|상품/.test(q)) category = "shopping";
  else if (/설문|미션|적립|포인트/.test(q)) category = "survey";

  // 니즈 강도: '지금 하려는' 신호가 있으면 ready, 상업 카테고리면 exploring, 아니면 none.
  const commercialCat = category === "rental" || category === "travel" || category === "shopping";
  const readySignal = /신청|예약|가입|계약|주문|설치\s*(신청|해)|하고\s*싶|하려|할래|해줘|가입할|바꾸려|바꿀|알아보고\s*있/.test(q);
  const need_level: NeedLevel = commercialCat ? (readySignal ? "ready" : "exploring") : "none";

  // 리워드 넛지: 건강·산책·소일·절약 맥락엔 걷기, 설문·틈새 미션 맥락엔 미션.
  let reward_nudge: RewardNudge = null;
  if (need_level !== "ready") {
    if (/걷|산책|운동|건강|무릎|허리|심심|소일|용돈|생활비|절약|살\s*빼/.test(q)) reward_nudge = "walk";
    else if (/설문|미션|틈틈|짬|간단히\s*벌|포인트\s*모/.test(q)) reward_nudge = "mission";
  }

  return {
    summary: degraded
      ? "지금은 간단히 안내드리고, 잠시 후 더 자세히 도와드릴게요."
      : `'${question.slice(0, 40)}'에 대해 핵심부터 정리해 드릴게요.`,
    sections: [
      {
        title: "먼저 확인할 점",
        body:
          category === "travel"
            ? "이동수단(KTX·고속버스·항공)과 숙소 지역을 총비용 기준으로 비교하는 것이 좋아요. 가격은 출발일·예약시점에 따라 달라집니다."
            : "핵심 조건(총비용·기간·취소 규정)을 먼저 비교하는 것이 좋아요.",
        importance: "high",
      },
      {
        title: "비교 요령",
        body: "표시 가격만 보지 말고 배송비·수수료·자동결제 여부까지 포함한 총비용으로 판단하세요.",
        importance: "medium",
      },
    ],
    next_actions: [
      { label: "날짜/조건을 정해 다시 물어보기", action_type: "ask_followup" },
      { label: "관련 혜택 살펴보기", action_type: "view_offers" },
    ],
    uncertainty: {
      level: "medium",
      message: "가격·조건은 시점에 따라 달라질 수 있어요. 이동 전에 원문에서 다시 확인하세요.",
    },
    suggested_category: category,
    need_level,
    reward_nudge,
    need_summary: need_level === "none" ? "" : `${category} 관련 도움을 찾고 있음`,
    follow_ups: followUpsFor(category),
  };
}

function followUpsFor(category: string | null): string[] {
  switch (category) {
    case "rental": return ["의무 사용기간이 뭔가요?", "중도 해지하면 위약금이 있나요?", "자가 관리형이 더 쌀까요?"];
    case "travel": return ["KTX랑 고속버스 중 뭐가 싸요?", "성수기 피하는 시기는 언제예요?"];
    case "shopping": return ["배송비까지 합치면 얼마예요?", "더 싼 곳도 있을까요?"];
    case "survey": return ["미션은 얼마나 걸리나요?", "포인트는 언제 들어와요?"];
    default: return ["좀 더 자세히 알려줄래요?", "제 상황에 맞게 정리해줄래요?"];
  }
}
