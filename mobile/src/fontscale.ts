// AI 대화 글자 크기(시니어 가독성). 보통(1.0)·크게(1.18)·아주 크게(1.36).
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hyeaek_fontscale";
export const SCALES = [
  { id: "normal", label: "보통", value: 1.0 },
  { id: "large", label: "크게", value: 1.18 },
  { id: "xlarge", label: "아주 크게", value: 1.36 },
];

let scale = 1.0;
const listeners: ((v: number) => void)[] = [];

export function currentScale(): number { return scale; }
export function onFontScale(cb: (v: number) => void): () => void {
  listeners.push(cb); cb(scale);
  return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
}
export async function initFontScale(): Promise<void> {
  const v = await AsyncStorage.getItem(KEY);
  if (v) { scale = parseFloat(v) || 1.0; listeners.forEach((l) => l(scale)); }
}
export async function setFontScale(v: number): Promise<void> {
  scale = v; await AsyncStorage.setItem(KEY, String(v));
  listeners.forEach((l) => l(scale));
}
