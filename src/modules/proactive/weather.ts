// 날씨 어댑터 — 선제 대화의 '위치 맥락'. 지금은 샘플(결정형), 나중에 기상청/OpenWeather로 교체.
export interface Weather { label: string; tempC: number; advice: string; }
export interface WeatherProvider { name: string; current(region: string, dayKey: string): Weather; }

const CONDS = [
  { label: "맑음", advice: "산책하기 딱 좋은 날이에요." },
  { label: "구름 조금", advice: "가볍게 걷기 좋아요." },
  { label: "쌀쌀함", advice: "겉옷 하나 챙기세요." },
  { label: "비", advice: "우산 잊지 마세요." },
  { label: "미세먼지 많음", advice: "외출 시 마스크 챙기시고, 실내 활동도 좋아요." },
];

export const sampleWeather: WeatherProvider = {
  name: "sample",
  current(region, dayKey) {
    // 지역+날짜로 결정형(데모에서 하루 동안 일관). 실연동 시 실제 관측값으로 대체.
    const seed = (region + dayKey).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const c = CONDS[seed % CONDS.length]!;
    return { label: c.label, tempC: 6 + (seed % 22), advice: c.advice };
  },
};
