// 온보딩 표시 상태. 첫 실행 시 1회 노출, 설정에서 다시 보기 가능.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hyeaek_onboarded";
let listener: ((show: boolean) => void) | null = null;

export function bindOnboarding(cb: (show: boolean) => void): void {
  listener = cb;
}
export async function initOnboarding(): Promise<void> {
  const seen = await AsyncStorage.getItem(KEY);
  if (!seen) listener?.(true);
}
export async function completeOnboarding(): Promise<void> {
  await AsyncStorage.setItem(KEY, "1");
  listener?.(false);
}
export function replayOnboarding(): void {
  listener?.(true);
}
