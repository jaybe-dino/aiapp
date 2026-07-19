// 클라이언트 직결 LLM (테스트 편의용).
// EXPO_PUBLIC_ANTHROPIC_KEY 가 있으면 데모 모드에서도 실제 Claude(Haiku)로 '진짜 대화'가 된다.
// ⚠️ 이 키는 앱 번들에 포함되므로 개인 테스트용으로만. 실서비스는 백엔드 경유(키 노출 금지).
const KEY = (process.env.EXPO_PUBLIC_ANTHROPIC_KEY || "").trim();
export const hasClientLLM = !!KEY;

const SYSTEM = `당신은 한국 50~70대 사용자를 돕는 따뜻한 생활비서 AI입니다.
쉬운 말로, 큰 흐름은 '한 줄 결론 → 근거/방법' 순서로 답하세요.
가격·정책처럼 변하는 정보는 확인을 권하고, 건강·금융·법률은 전문가 상담을 안내하세요.
반드시 아래 JSON 형식으로만 답하세요(다른 말 금지):
{"summary": "한 문장 핵심 결론", "sections": [{"title": "소제목", "body": "설명"}]}  (sections 1~2개, 각 body는 2~3문장)`;

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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true", // 웹 프리뷰에서도 동작
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: guidance ? `${SYSTEM}\n\n[안전 지침] ${guidance}` : SYSTEM,
      messages,
    }),
  });
  if (!res.ok) throw new Error("LLM " + res.status);
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
