// Model Gateway(기획안 7.2). 공급자 이름을 제품 로직에 노출하지 않고 능력 등급으로 추상화.
// ANTHROPIC_API_KEY 가 있으면 최신 Claude 모델을 호출하고, 없으면 결정형 mock 으로 폴백(키 없이 실행 가능).
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";

// 능력 등급 → 실제 모델 매핑. 최신 Claude 모델을 기본값으로 사용.
const TIER_MODEL: Record<string, string> = {
  fast: "claude-haiku-4-5-20251001",
  balanced: "claude-sonnet-5",
  reasoning: "claude-opus-4-8",
};

export interface StructuredAnswer {
  summary: string;
  sections: { title: string; body: string; importance: "high" | "medium" | "low" }[];
  next_actions: { label: string; action_type: string }[];
  uncertainty: { level: "low" | "medium" | "high"; message: string };
  suggested_category: string | null; // 광고 의도 문맥용 카테고리 힌트(원문 아님)
}

const SYSTEM_POLICY = `당신은 한국 55~69세 사용자를 돕는 생활비서 AI입니다.
원칙:
- 광고/수수료 정보는 당신에게 주어지지 않습니다. 답변은 광고와 무관하게 완결하세요.
- 큰 흐름은 '한 줄 결론 → 근거/비교 → 다음 행동' 순으로.
- 가격·정책처럼 변동 가능한 정보는 불확실성과 확인 시점을 함께 알리세요.
- 건강·금융·법률 등 고위험은 단정하지 말고 전문기관 확인을 안내하세요.
반드시 아래 JSON 스키마로만 답하세요:
{"summary": string, "sections": [{"title": string, "body": string, "importance": "high|medium|low"}],
 "next_actions": [{"label": string, "action_type": string}],
 "uncertainty": {"level": "low|medium|high", "message": string},
 "suggested_category": "travel|shopping|rental|survey|life|null 중 하나(정수기·비데·공기청정기 렌탈/구독 문의는 rental)"}`;

export async function generateAnswer(question: string, tier = config.aiModelTier): Promise<StructuredAnswer> {
  if (!config.anthropicApiKey) return mockAnswer(question);

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const model = TIER_MODEL[tier] ?? TIER_MODEL.balanced!;
    const resp = await client.messages.create({
      model,
      max_tokens: 1200,
      system: SYSTEM_POLICY,
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
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  return {};
}

function normalize(json: Record<string, unknown>, question: string): StructuredAnswer {
  const base = mockAnswer(question);
  return {
    summary: (json.summary as string) ?? base.summary,
    sections: (json.sections as StructuredAnswer["sections"]) ?? base.sections,
    next_actions: (json.next_actions as StructuredAnswer["next_actions"]) ?? base.next_actions,
    uncertainty: (json.uncertainty as StructuredAnswer["uncertainty"]) ?? base.uncertainty,
    suggested_category: (json.suggested_category as string) ?? base.suggested_category,
  };
}

// 키가 없어도 데모가 동작하도록 하는 결정형 답변. 질문 키워드로 카테고리를 추정.
function mockAnswer(question: string, degraded = false): StructuredAnswer {
  const q = question.toLowerCase();
  let category: string | null = "life";
  if (/렌탈|렌트|구독|정수기|비데|안마의자|매트리스|공기청정기\s*렌/.test(q)) category = "rental";
  else if (/여행|부산|제주|숙박|호텔|기차|ktx|항공|비행기/.test(q)) category = "travel";
  else if (/쇼핑|구매|가격|최저가|사려|살까|사는|싸게|필터|청정기|제품|배송|주문|상품/.test(q)) category = "shopping";
  else if (/설문|미션|적립|포인트/.test(q)) category = "survey";

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
  };
}
