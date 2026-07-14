// API 클라이언트. 기본 URL은 app.json extra.apiBaseUrl 에서 읽고,
// 개발 중에는 실기기에서 접근 가능한 PC IP로 바꾸세요(예: http://192.168.0.10:3000).
import Constants from "expo-constants";

const BASE: string = (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? "http://localhost:3000";

// MVP 인증: x-user-id 헤더(운영에선 토큰). 데모 사용자 고정.
const USER_ID = "usr_demo";

function uuid(): string {
  return "k-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

async function req<T>(path: string, opts: RequestInit & { idem?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-user-id": USER_ID,
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

export const Api = {
  baseUrl: BASE,
  async createConversation() {
    return req<{ conversation_id: string }>("/v1/conversations", { method: "POST", body: "{}" });
  },
  async ask(conversationId: string, text: string) {
    return req<{
      answerSnapshotId: string;
      answer: {
        summary: string;
        sections: { title: string; body: string }[];
        uncertainty: { message: string };
      };
      commercial: OfferCard | null;
    }>(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
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
    return req(`/v1/suppliers/${supplier}/postbacks`, {
      method: "POST",
      body: JSON.stringify({ external_conversion_id: "demo_" + Date.now(), click_id: clickId, source, gross_amount: gross }),
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
