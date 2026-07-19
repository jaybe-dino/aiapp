// 선제 대화 엔진 — 앱이 먼저 말을 거는 '일상 동반자'의 핵심.
// 사용자 맥락(시간대·위치/날씨·걷기·보상)을 모아 따뜻한 안부 + 대화 시작 주제 + 행동 제안을 만든다.
// 위치(날씨)는 동의(location)와 지역이 있을 때만 사용(프라이버시).
import { db } from "../../db/index.js";
import { now } from "../../lib/id.js";
import { userWallet } from "../ledger/ledger.js";
import { todayStatus } from "../cashwalk/cashwalk.js";
import { hasConsent } from "../auth/auth.js";
import { sampleWeather } from "./weather.js";

export interface Proactive {
  greeting: string;
  message: string; // 오늘의 안부(선제 메시지)
  topic: string; // 탭하면 대화가 시작되는 주제
  action: { label: string; tab: string } | null; // 걷기/보상 등 바로가기
  weather: { label: string; tempC: number } | null;
}

function partOfDay(hour: number): string {
  return hour < 6 ? "새벽" : hour < 11 ? "아침" : hour < 17 ? "낮" : hour < 21 ? "저녁" : "밤";
}

// 시간·날씨·맥락에 맞는 대화 시작 주제 후보(회전).
function topicFor(pod: string, weatherLabel: string | null): string {
  if (weatherLabel === "비") return "비 오는 날 집에서 할 만한 소일거리 추천해줄까요?";
  if (weatherLabel === "미세먼지 많음") return "미세먼지 심한 날 건강 관리 팁 알려드릴까요?";
  if (pod === "아침") return "오늘 하루 어떻게 보내면 좋을지 같이 계획해볼까요?";
  if (pod === "낮") return "점심 뭐 드셨어요? 저녁 메뉴 같이 골라볼까요?";
  if (pod === "저녁" || pod === "밤") return "오늘 하루 어떠셨어요? 내일 준비할 것 있으면 도와드릴게요.";
  return "요즘 궁금하거나 알아보고 싶은 게 있으세요?";
}

export function buildProactive(userId: string): Proactive {
  const user = db.prepare("SELECT display_name, region FROM users WHERE user_id = ?").get(userId) as
    | { display_name: string; region: string | null }
    | undefined;
  const name = user && user.display_name && user.display_name !== "게스트" ? `${user.display_name}님` : "";
  const ts = now();
  const dayKey = ts.slice(0, 10);
  const hour = Number(ts.slice(11, 13)) || 9;
  const pod = partOfDay(hour);

  const wallet = userWallet(userId);
  const walk = todayStatus(userId, dayKey);

  // 위치(날씨)는 동의 + 지역이 있을 때만.
  const useLocation = !!(user?.region) && hasConsent(userId, "location");
  const weather = useLocation ? sampleWeather.current(user!.region!, dayKey) : null;

  // 선제 메시지 구성(따뜻한 안부 + 맥락).
  const parts: string[] = [];
  parts.push(`${name ? name + ", " : ""}좋은 ${pod}이에요.`);
  if (weather) parts.push(`${user!.region}은 지금 ${weather.label}, ${weather.tempC}도예요. ${weather.advice}`);
  if (walk.claimable.length > 0) parts.push(`받을 수 있는 걷기 보상이 ${walk.claimable.length}개 있어요.`);
  else if (walk.steps > 0) parts.push(`오늘 ${walk.steps.toLocaleString("ko-KR")}보 걸으셨네요. 조금 더 걸으면 포인트가 쌓여요.`);
  if (wallet.available >= 3000) parts.push(`모아둔 포인트로 쿠폰을 바꿀 수 있어요.`);
  else if (wallet.pending > 0) parts.push(`확인 중인 보상이 곧 사용 가능으로 바뀔 거예요.`);

  // 행동 제안(우선순위: 걷기 보상 → 쿠폰 교환).
  let action: { label: string; tab: string } | null = null;
  if (walk.claimable.length > 0) action = { label: "걷기 보상 받기", tab: "걷기" };
  else if (wallet.available >= 3000) action = { label: "쿠폰으로 교환", tab: "내보상" };

  return {
    greeting: `${name || "안녕하세요"} 👋`,
    message: parts.join(" "),
    topic: topicFor(pod, weather?.label ?? null),
    action,
    weather: weather ? { label: weather.label, tempC: weather.tempC } : null,
  };
}
