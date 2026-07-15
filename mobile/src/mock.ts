// 오프라인 데모 목업 — 백엔드 없이 앱 전체 흐름을 체험하기 위한 인메모리 구현.
// api.ts 가 서버 연결 실패를 감지하면 자동으로 이 목업으로 전환한다.
import type { OfferCard, CashwalkStatus } from "./api";

const STEP_PER_MS = 1000, DAILY_CAP = 20000, REWARD_PER_MS = 20;

const state = {
  wallet: { available: 0, pending: 0, used: 0 },
  rewards: [] as any[],
  steps: 0,
  claimed: new Set<number>(),
};

function rid(p: string) { return p + "_" + Math.random().toString(36).slice(2, 10); }

function mkOffer(o: Partial<OfferCard>): OfferCard {
  return {
    offerId: rid("off"), offerSnapshotId: rid("ofs"), advertiserName: "", title: "",
    recommendationReason: "", totalCost: 0, expectedReward: 0, approvalWindow: "", cancelTerms: "",
    autoRenewal: false, dataSharing: "없음", category: "shopping",
    isRental: false, monthlyFee: null, contractMonths: null, mandatoryMonths: null, ...o,
  };
}

const OFFERS: Record<string, OfferCard[]> = {
  shopping: [
    mkOffer({ advertiserName: "○○여행", title: "부산 해운대 호텔 2박", recommendationReason: "검수된 쇼핑·예약 제휴", totalCost: 180000, expectedReward: 4000, approvalWindow: "여행 종료 후 7~14일", cancelTerms: "체크인 3일 전까지 무료 취소", category: "travel" }),
    mkOffer({ advertiserName: "△△리빙", title: "공기청정기 필터 정기배송", recommendationReason: "검수된 쇼핑·예약 제휴", totalCost: 39000, expectedReward: 1200, approvalWindow: "구매 확정 후 7일", cancelTerms: "반품 시 적립 취소", autoRenewal: true, category: "shopping" }),
  ],
  mission: [
    mkOffer({ advertiserName: "□□리서치", title: "생활습관 설문(약 3분)", recommendationReason: "행동형 미션 보상", totalCost: 0, expectedReward: 300, approvalWindow: "설문 완료 확인 후 1~2일", cancelTerms: "불성실 응답 시 적립 취소", dataSharing: "설문 응답(비식별)", category: "survey" }),
  ],
  rental: [
    mkOffer({ advertiserName: "○○웰스", title: "정수기 렌탈 (냉·온·정)", recommendationReason: "검수된 렌탈 제휴 · 조건을 꼭 확인하세요", totalCost: 466200, expectedReward: 40000, approvalWindow: "설치 완료 후 30~45일", cancelTerms: "의무사용기간 내 해지 시 위약금", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", category: "rental", isRental: true, monthlyFee: 25900, contractMonths: 36, mandatoryMonths: 18 }),
    mkOffer({ advertiserName: "△△매직", title: "비데 렌탈 (온수 세정)", recommendationReason: "검수된 렌탈 제휴 · 조건을 꼭 확인하세요", totalCost: 190800, expectedReward: 25000, approvalWindow: "설치 완료 후 30일", cancelTerms: "의무사용기간 내 해지 시 위약금", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", category: "rental", isRental: true, monthlyFee: 10600, contractMonths: 36, mandatoryMonths: 12 }),
    mkOffer({ advertiserName: "○○웰스", title: "공기청정기 렌탈", recommendationReason: "검수된 렌탈 제휴 · 조건을 꼭 확인하세요", totalCost: 356400, expectedReward: 33000, approvalWindow: "설치 완료 후 30~45일", cancelTerms: "의무사용기간 내 해지 시 위약금", autoRenewal: true, dataSharing: "이름·연락처·설치주소(설치 상담용)", category: "rental", isRental: true, monthlyFee: 16500, contractMonths: 36, mandatoryMonths: 18 }),
  ],
};

function findOffer(snapshotId: string): OfferCard | undefined {
  for (const list of Object.values(OFFERS)) { const o = list.find((x) => x.offerSnapshotId === snapshotId); if (o) return o; }
  return undefined;
}

function category(q: string): string {
  const s = q.toLowerCase();
  if (/렌탈|렌트|구독|정수기|비데|공기청정기\s*렌/.test(s)) return "rental";
  if (/여행|부산|제주|숙박|호텔|기차|ktx|항공/.test(s)) return "travel";
  if (/쇼핑|구매|가격|최저가|사는|싸게|필터|청정기|배송|상품/.test(s)) return "shopping";
  return "life";
}

function cashwalkStatus(): CashwalkStatus {
  const unlocked = Math.min(Math.floor(state.steps / STEP_PER_MS), DAILY_CAP / STEP_PER_MS);
  const claimable: number[] = [];
  for (let m = 1; m <= unlocked; m++) if (!state.claimed.has(m)) claimable.push(m);
  return {
    steps: state.steps, dailyCap: DAILY_CAP, stepPerMilestone: STEP_PER_MS, rewardPerMilestone: REWARD_PER_MS,
    unlockedMilestones: unlocked, claimedMilestones: [...state.claimed].sort((a, b) => a - b), claimable,
    earnedToday: state.claimed.size * REWARD_PER_MS,
  };
}

function addReward(title: string, source: string, amount: number, available: boolean) {
  state.rewards.unshift({
    reward_transaction_id: rid("rwd"), title, source,
    state: available ? "available" : "pending", state_label: available ? "사용 가능" : "확인 중",
    amount, created_at: new Date().toISOString(),
    _timeline: available
      ? [{ reason: "유효 전환 수신·귀속", created_at: new Date().toISOString() }, { reason: "사용 가능", created_at: new Date().toISOString() }]
      : [{ reason: "유효 전환 수신·귀속", created_at: new Date().toISOString() }],
  });
  if (available) state.wallet.available += amount; else state.wallet.pending += amount;
}

// api.ts 의 Api 와 동일한 시그니처
export const MockApi = {
  async createConversation() { return { conversation_id: rid("cnv") }; },
  async ask(_c: string, text: string) {
    const cat = category(text);
    const benefits = cat === "rental" ? [OFFERS.rental[0]!] : cat === "travel" ? [OFFERS.shopping[0]!] : [OFFERS.shopping[1]!, OFFERS.shopping[0]!];
    const missions = OFFERS.mission.slice(0, 1);
    return {
      answerSnapshotId: rid("ans"),
      answer: {
        summary: cat === "rental"
          ? "정수기 렌탈은 월 요금·약정·의무기간·자동결제를 꼭 함께 비교하는 게 좋아요."
          : `'${text.slice(0, 24)}' 관련해서 핵심부터 정리해 드릴게요.`,
        sections: [
          { title: "먼저 확인할 점", body: cat === "rental" ? "월 렌탈료뿐 아니라 총 소유비용(월×약정)과 중도해지 위약금을 함께 보세요." : "핵심 조건(총비용·기간·취소 규정)을 먼저 비교하는 것이 좋아요." },
          { title: "이렇게 하면 좋아요", body: "표시 가격만 보지 말고 배송비·수수료·자동결제까지 포함한 총비용으로 판단하세요." },
        ],
        uncertainty: { message: "가격·조건은 시점에 따라 달라질 수 있어요. 진행 전에 다시 확인하세요." },
      },
      commercial: benefits[0] ?? null,
      matched: { benefits, missions },
    };
  },
  async offers(type: "shopping" | "mission" | "rental") { return { offers: OFFERS[type] ?? [] }; },
  async createClick(_s: string) { return { click_id: rid("clk"), redirect_url: "https://example.com" }; },
  async simulateConversion(_sup: string, source: string, _clk: string, gross: number) {
    const map: Record<string, string> = { shopping_cps: "쇼핑 적립", offerwall_cpa: "미션 보상", rental_cpa: "렌탈 보상" };
    // 데모: 쇼핑/미션/렌탈은 '확인 중'(승인 대기). 걷기만 즉시 사용가능.
    addReward(map[source] ?? "보상", source, source === "rental_cpa" ? 40000 : source === "offerwall_cpa" ? 300 : 1200, false);
    return { conversion_id: rid("cnv"), status: "attributed" };
  },
  async wallet() { return { ...state.wallet }; },
  async rewards() { return { rewards: state.rewards.map(({ _timeline, ...r }) => r) }; },
  async rewardDetail(id: string) {
    const r = state.rewards.find((x) => x.reward_transaction_id === id);
    return { title: r?.title ?? "보상", state_label: r?.state_label ?? "", amount: r?.amount ?? 0, timeline: r?._timeline ?? [] };
  },
  async payout(amount: number) {
    if (state.wallet.available < amount) throw { code: "REWARD_NOT_AVAILABLE", title: "사용 가능한 보상이 부족합니다." };
    state.wallet.available -= amount; state.wallet.used += amount;
    return { status: "paid", status_label: "사용 완료", coupon_code: "CPN-" + Math.random().toString(36).slice(2, 8).toUpperCase() };
  },
  async cashwalk() { return cashwalkStatus(); },
  async syncSteps(steps: number) { state.steps = Math.min(Math.max(steps, state.steps), DAILY_CAP + STEP_PER_MS); return cashwalkStatus(); },
  async claimMilestone(milestone: number, _ad: string) {
    if (!state.claimed.has(milestone)) { state.claimed.add(milestone); addReward("걷기 광고 보상", "cashwalk_ad", REWARD_PER_MS, true); }
    return { rewardAmount: REWARD_PER_MS, status: cashwalkStatus() };
  },
  async setConsent(_p: string, _g: boolean) { return { ok: true }; },
  async submitLead(_s: string, _lead: any) {
    addReward("렌탈 보상", "rental_cpa", 40000, false);
    return { lead_id: rid("led"), click_id: rid("clk"), advertiser_name: "○○웰스" };
  },
};
