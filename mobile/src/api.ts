// API 클라이언트. 기본 URL 우선순위:
//   1) 환경변수 EXPO_PUBLIC_API_URL (실기기 테스트 시 PC의 LAN IP로 지정, 앱 코드 수정 불필요)
//   2) app.json 의 extra.apiBaseUrl
//   3) http://localhost:3000 (시뮬레이터/웹 기본값)
// 실기기 예: EXPO_PUBLIC_API_URL=http://192.168.0.10:3000 npx expo start
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  ((Constants.expoConfig?.extra as any)?.apiBaseUrl ?? "http://localhost:3000");

function uuid(): string {
  return "k-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

// 세션 토큰(Bearer). 앱 최초 실행 시 게스트 로그인으로 발급받아 저장.
let TOKEN: string | null = null;
let sessionPromise: Promise<void> | null = null;

async function ensureSession(): Promise<void> {
  if (TOKEN) return;
  if (!sessionPromise) {
    sessionPromise = (async () => {
      TOKEN = await AsyncStorage.getItem("hyeaek_token");
      if (TOKEN) return;
      let deviceId = await AsyncStorage.getItem("hyeaek_device");
      if (!deviceId) { deviceId = uuid(); await AsyncStorage.setItem("hyeaek_device", deviceId); }
      const res = await fetch(BASE + "/v1/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId }),
      });
      const body = await res.json();
      TOKEN = body.token;
      if (TOKEN) await AsyncStorage.setItem("hyeaek_token", TOKEN);
    })();
  }
  await sessionPromise;
}

async function req<T>(path: string, opts: RequestInit & { idem?: boolean } = {}): Promise<T> {
  await ensureSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
    ...(opts.headers as Record<string, string>),
  };
  if (opts.idem) headers["Idempotency-Key"] = uuid();
  const res = await fetch(BASE + path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body as T;
}

export interface OfferCard {
  offerId: string;
  offerSnapshotId: string;
  advertiserName: string;
  title: string;
  recommendationReason: string;
  totalCost: number;
  expectedReward: number;
  approvalWindow: string;
  cancelTerms: string;
  autoRenewal: boolean;
  dataSharing: string;
  category: string;
  isRental: boolean;
  monthlyFee: number | null;
  contractMonths: number | null;
  mandatoryMonths: number | null;
}

export type NeedLevel = "none" | "exploring" | "ready";
export type RewardNudge = "walk" | "mission" | null;
export interface SafetyNotice {
  level: "info" | "warn" | "critical";
  title: string;
  body: string;
  resources?: { label: string; value: string }[];
}
export interface Proactive {
  greeting: string;
  message: string;
  topic: string;
  action: { label: string; tab: string } | null;
  weather: { label: string; tempC: number } | null;
}
export interface AskResult {
  answerSnapshotId: string;
  answer: {
    summary: string;
    sections: { title: string; body: string }[];
    uncertainty: { message: string };
  };
  commercial: OfferCard | null;
  matched?: { benefits: OfferCard[]; missions: OfferCard[] };
  needLevel?: NeedLevel;
  rewardNudge?: RewardNudge;
  safetyNotice?: SafetyNotice | null;
  followUps?: string[];
}

const RealApi = {
  baseUrl: BASE,
  async createConversation() {
    return req<{ conversation_id: string }>("/v1/conversations", { method: "POST", body: "{}" });
  },
  async ask(conversationId: string, text: string) {
    return req<AskResult>(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  },
  async offers(type: "shopping" | "mission" | "rental") {
    return req<{ offers: OfferCard[] }>(`/v1/offers?type=${type}`);
  },
  async createClick(offerSnapshotId: string, answerSnapshotId?: string | null) {
    return req<{ click_id: string; redirect_url: string }>(`/v1/offers/${offerSnapshotId}/clicks`, {
      method: "POST",
      idem: true,
      body: JSON.stringify({ answer_snapshot_id: answerSnapshotId ?? null }),
    });
  },
  async simulateConversion(supplier: string, source: string, clickId: string, gross: number) {
    // 데모: 서버 dev 시뮬레이터(실 postback은 공급사 HMAC 서명 필요)
    return req(`/v1/dev/simulate-conversion`, {
      method: "POST",
      body: JSON.stringify({ supplier, source, click_id: clickId, gross_amount: gross }),
    });
  },
  async setConsent(purpose: string, granted: boolean) {
    return req<{ purpose: string; granted: boolean }>(`/v1/consents/${purpose}`, { method: "PUT", body: JSON.stringify({ granted }) });
  },
  async consents() {
    return req<{ consents: { purpose: string; granted: number; policy_version: string; updated_at: string }[] }>("/v1/consents");
  },
  async proactive() {
    return req<Proactive>("/v1/proactive");
  },
  async setRegion(region: string | null) {
    return req<{ region: string | null }>("/v1/me/region", { method: "PUT", body: JSON.stringify({ region }) });
  },
  async me() {
    return req<{ region: string | null; display_name: string }>("/v1/me");
  },
  async logout() {
    TOKEN = null;
    sessionPromise = null;
    await AsyncStorage.multiRemove(["hyeaek_token", "hyeaek_device"]);
    return { ok: true };
  },
  async submitLead(offerSnapshotId: string, lead: { name: string; phone: string; address: string; preferred_time?: string }) {
    return req<{ lead_id: string; click_id: string; advertiser_name: string }>(`/v1/offers/${offerSnapshotId}/lead`, {
      method: "POST",
      idem: true,
      body: JSON.stringify(lead),
    });
  },
  async wallet() {
    return req<{ available: number; pending: number; used: number }>("/v1/wallet");
  },
  async rewards() {
    return req<{ rewards: { reward_transaction_id: string; title: string; source: string; state: string; state_label: string; amount: number }[] }>("/v1/rewards");
  },
  async rewardDetail(id: string) {
    return req<{ title: string; state_label: string; amount: number; timeline: { reason: string; created_at: string }[] }>(`/v1/rewards/${id}`);
  },
  async payout(amount: number) {
    return req<{ status: string; status_label: string; coupon_code: string | null }>("/v1/payouts", {
      method: "POST",
      idem: true,
      body: JSON.stringify({ amount, product_id: "coupon_3000" }),
    });
  },
  async cashwalk() {
    return req<CashwalkStatus>("/v1/cashwalk");
  },
  async syncSteps(steps: number) {
    return req<CashwalkStatus>("/v1/cashwalk/steps", { method: "POST", body: JSON.stringify({ steps, device_integrity_ok: true }) });
  },
  async claimMilestone(milestone: number, adImpressionId: string) {
    return req<{ rewardAmount: number; status: CashwalkStatus }>("/v1/cashwalk/claims", {
      method: "POST",
      body: JSON.stringify({ milestone, ad_impression_id: adImpressionId }),
    });
  },
};

export interface CashwalkStatus {
  steps: number;
  dailyCap: number;
  stepPerMilestone: number;
  rewardPerMilestone: number;
  unlockedMilestones: number;
  claimedMilestones: number[];
  claimable: number[];
  earnedToday: number;
}

// ---- 오프라인 데모 모드 자동 전환 ----------------------------------------
// 서버 연결에 실패하면(네트워크 오류) 자동으로 내장 목업으로 전환한다.
// → 백엔드 없이 npx expo start 만으로 아이폰에서 전체 화면 체험 가능.
import { MockApi } from "./mock";

export let demoMode = process.env.EXPO_PUBLIC_DEMO === "1";
type DemoListener = (on: boolean) => void;
const demoListeners: DemoListener[] = [];
export function onDemoMode(cb: DemoListener): () => void {
  demoListeners.push(cb);
  cb(demoMode);
  return () => { const i = demoListeners.indexOf(cb); if (i >= 0) demoListeners.splice(i, 1); };
}
function enableDemo() {
  if (demoMode) return;
  demoMode = true;
  demoListeners.forEach((l) => l(true));
}
// 서버가 보낸 problem 객체(code/title 보유)가 아니면 네트워크 오류로 간주.
function isNetworkError(e: any): boolean {
  return !!e && typeof e === "object" && !("code" in e) && !("title" in e);
}

// RealApi 를 감싸: demoMode 면 MockApi, 아니면 실서버 호출(실패 시 자동 데모 전환).
export const Api: typeof RealApi = new Proxy(RealApi, {
  get(target, prop: string | symbol) {
    const real = (target as any)[prop];
    if (typeof real !== "function") return real;
    return async (...args: any[]) => {
      if (demoMode) return (MockApi as any)[prop](...args);
      try {
        return await real(...args);
      } catch (e) {
        if (isNetworkError(e) && (MockApi as any)[prop]) { enableDemo(); return (MockApi as any)[prop](...args); }
        throw e;
      }
    };
  },
});
