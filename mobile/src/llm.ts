// 클라이언트 직결 LLM (테스트 편의용).
// EXPO_PUBLIC_ANTHROPIC_KEY 가 있으면 데모 모드에서도 실제 Claude(Haiku)로 '진짜 대화'가 된다.
// ⚠️ 이 키는 앱 번들에 포함되므로 개인 테스트용으로만. 실서비스는 백엔드 경유(키 노출 금지).
const KEY = (process.env.EXPO_PUBLIC_ANTHROPIC_KEY || "").trim();
export const hasClientLLM = !!KEY;
// 키 형태가 맞는지(빈 값·따옴표 포함·플레이스홀더) 사전 점검 — 실패 원인 진단용.
export const keyLooksValid = /^sk-ant-/.test(KEY) && KEY.length > 30;

// 마지막 LLM 호출 실패 사유(화면·로그에 노출).
export let lastLLMError: string | null = null;
export function getLLMError() { return lastLLMError; }

const SYSTEM = `당신은 한국 50~70대 사용자를 돕는 따뜻한 생활비서 AI입니다.
매우 짧고 쉽게 답하세요. 한 문장 결론 먼저, 어려운 말·영어 약어 금지.
[중요] 병원·약국·맛집·가격·최저가·영업시간·날씨·교통·최신 뉴스처럼 실시간이거나 지역에 따라
달라지는 정보를 물으면 반드시 web_search 도구로 검색해 '실제 정보'(이름·주소·전화·시간 등)를
찾아 답하세요. "검색할 수 없다"고 하지 마세요 — 당신에게는 web_search 도구가 있습니다.
단, 의학적 '진단·처방'과 금융·법률의 최종 결정은 전문가 상담을 함께 안내하세요.
검색 후에도 반드시 아래 JSON 형식으로만 답하세요(다른 말 금지):
{"summary": "한 문장 핵심 결론", "sections": [{"title": "소제목", "body": "핵심 정보(주소·전화 등)"}]}  (sections 최대 3개)`;

type Msg = { role: "user" | "assistant"; content: string };
let history: Msg[] = [];

export function resetLLM() { history = []; }

function extractJson(text: string): any {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "");
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { /* noop */ } }
  return {};
}

export async function llmAnswer(
  question: string,
  guidance?: string | null
): Promise<{ summary: string; sections: { title: string; body: string }[] }> {
  const messages: Msg[] = [...history, { role: "user", content: question }];
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true", // 웹 프리뷰에서도 동작
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        // 실시간·지역 정보(병원·가격 등)를 실제로 찾아주는 서버사이드 웹 검색 도구.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        system: guidance ? `${SYSTEM}\n\n[안전 지침] ${guidance}` : SYSTEM,
        messages,
      }),
    });
  } catch (e: any) {
    // 네트워크 자체 실패(인터넷·프록시·DNS).
    lastLLMError = "네트워크: " + (e?.message || "연결 실패");
    console.warn("[LLM] fetch 실패:", lastLLMError);
    throw e;
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch { /* noop */ }
    lastLLMError = `HTTP ${res.status}${res.status === 401 ? " (API 키가 틀렸거나 만료됨)" : res.status === 429 ? " (사용량 한도 초과)" : res.status === 400 ? " (요청 오류)" : ""}`;
    console.warn("[LLM] 응답 오류:", res.status, detail);
    throw new Error("LLM " + res.status);
  }
  lastLLMError = null;
  const data = await res.json();
  const text: string = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  // 멀티턴 기억(최근 6턴)
  history.push({ role: "user", content: question }, { role: "assistant", content: text.slice(0, 600) });
  if (history.length > 12) history = history.slice(-12);

  const json = extractJson(text);
  const sections = Array.isArray(json.sections)
    ? json.sections.filter((s: any) => s && s.title && s.body).slice(0, 2)
    : [];
  const summary = typeof json.summary === "string" && json.summary ? json.summary : (text.split("\n")[0] || "도와드릴게요.").slice(0, 140);
  return { summary, sections };
}
