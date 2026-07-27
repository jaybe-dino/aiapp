// 오프라인 데모 목업 — 백엔드 없이 앱 전체 흐름을 체험하기 위한 인메모리 구현.
// api.ts 가 서버 연결 실패를 감지하면 자동으로 이 목업으로 전환한다.
import type { OfferCard, CashwalkStatus } from "./api";
import { hasClientLLM, keyLooksValid, llmAnswer, resetLLM, getLLMError } from "./llm";

const STEP_PER_MS = 1000, DAILY_CAP = 20000, REWARD_PER_MS = 20;

const state = {
  wallet: { available: 0, pending: 0, used: 0 },
  rewards: [] as any[],
  steps: 0,
  claimed: new Set<number>(),
  region: null as string | null,
  // 일상 대화 + 수익화 미션: 무료 대화 N회 후에는 '광고 보고 이어가기'로 대화를 연장한다.
  chat: { used: 0, free: 5, adUnlocks: 0, adReward: 20, perUnlock: 5 },
  // 스폰서 대화 미션(대화하면 돈 버는 루프): 주제 대화 완료 → 스폰서 재원으로 즉시 적립.
  mission: { active: null as { missionId: string; turns: number } | null, completed: new Set<string>() },
  streakDays: 1, // 데모: 오늘 첫 대화 기준
};

const CHAT_MISSIONS = [
  { missionId: "cm_health", sponsor: "○○헬스케어", title: "건강 습관 이야기 나누기", opening: "요즘 나이에 맞는 건강 관리, 뭐부터 하면 좋을까요?", reward: 500, turnsRequired: 3 },
  { missionId: "cm_travel", sponsor: "△△여행", title: "가을 나들이 계획 세우기", opening: "가을에 당일치기로 다녀올 만한 곳 추천해줘요", reward: 300, turnsRequired: 2 },
  { missionId: "cm_saving", sponsor: "□□마트", title: "장보기 절약 요령 배우기", opening: "장볼 때 돈 아끼는 요령 좀 알려줘요", reward: 300, turnsRequired: 2 },
];

function chatAllowance() { return state.chat.free + state.chat.adUnlocks * state.chat.perUnlock; }
function chatStatusObj() {
  const allowance = chatAllowance();
  const remaining = Math.max(0, allowance - state.chat.used);
  return { used: state.chat.used, allowance, remaining, locked: remaining <= 0, adReward: state.chat.adReward, perUnlock: state.chat.perUnlock };
}

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
  if (/렌탈|렌트|구독|정수기|비데|안마의자|매트리스|공기청정기\s*렌/.test(s)) return "rental";
  if (/여행|부산|제주|숙박|호텔|펜션|리조트|기차|ktx|항공|비행기|패키지/.test(s)) return "travel";
  if (/쇼핑|구매|가격|최저가|사는|사고\s*싶|싸게|저렴|필터|청정기|배송|상품|선물|노트북|휴대폰|건강식품|영양제|홍삼/.test(s)) return "shopping";
  return "life";
}

type NeedLevel = "none" | "exploring" | "ready";
type Nudge = "walk" | "mission" | null;
// 백엔드 2단계 게이팅을 데모에서도 재현: 니즈 강도 + 리워드 넛지.
function needOf(q: string, cat: string): { need: NeedLevel; nudge: Nudge } {
  const s = q.toLowerCase();
  const commercial = cat === "rental" || cat === "travel" || cat === "shopping";
  // 명시적 상품 요청(추천/찾아/비교/어디서 사 등)도 '준비' 단계로 본다.
  const ready = /신청|예약|가입|계약|주문|설치\s*(신청|해)|하고\s*싶|사고\s*싶|하려|할래|해줘|바꾸려|바꿀|알아보고\s*있|추천|찾아|골라|비교|어디서\s*사|살까|좋을까/.test(s);
  const need: NeedLevel = commercial ? (ready ? "ready" : "exploring") : "none";
  let nudge: Nudge = null;
  if (need !== "ready") {
    if (/걷|산책|운동|건강|무릎|허리|심심|소일|용돈|생활비|절약|살\s*빼/.test(s)) nudge = "walk";
    else if (/설문|미션|틈틈|짬|포인트\s*모/.test(s)) nudge = "mission";
  }
  return { need, nudge };
}
// 데모용 '판단형' 큐레이션: 니즈에 맞춰 이유를 써 붙인다.
function curate(cat: string, need: NeedLevel): { benefits: OfferCard[]; missions: OfferCard[] } {
  if (need === "none") return { benefits: [], missions: [] };
  const pickBenefit = () => {
    if (cat === "rental") return { ...OFFERS.rental[0]!, recommendationReason: `말씀하신 렌탈 니즈에 맞아요. 설치 확정 시 최대 ${OFFERS.rental[0]!.expectedReward.toLocaleString("ko-KR")}P.` };
    if (cat === "travel") return { ...OFFERS.shopping[0]!, recommendationReason: `여행 예약에 맞는 제휴예요. 확정 시 ${OFFERS.shopping[0]!.expectedReward.toLocaleString("ko-KR")}P 적립.` };
    return { ...OFFERS.shopping[1]!, recommendationReason: `조건 대비 적립이 커요. 확정 시 ${OFFERS.shopping[1]!.expectedReward.toLocaleString("ko-KR")}P.` };
  };
  const benefits = [pickBenefit()];
  const missions = need === "ready" ? [{ ...OFFERS.mission[0]!, recommendationReason: `${OFFERS.mission[0]!.expectedReward}P — 짧게 참여하고 포인트 받기.` }] : [];
  return { benefits, missions };
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

// 데모용 안전 가드레일(백엔드 safety.ts의 축약판) — 오프라인에서도 사기·위기 경고 재현.
function safetyOf(text: string): import("./api").SafetyNotice | null {
  const s = text.toLowerCase();
  if (/원금\s*보장|고수익\s*보장|수수료.*먼저|인증번호.*알려|계좌.*알려|검찰.*계좌|손자.*급하게.*돈|리딩방|정부\s*지원금.*수수료/.test(s))
    return { level: "critical", title: "혹시 사기일 수 있어요. 잠시 멈추세요.", body: "‘원금 보장·고수익’, ‘수수료 먼저’, ‘인증번호·계좌 요구’, 기관·가족 사칭은 대표적 사기예요. 절대 송금·개인정보 제공하지 말고 가족·지인에게 먼저 확인하세요.", resources: [{ label: "경찰(신고)", value: "112" }, { label: "보이스피싱·금융사기", value: "1332" }] };
  if (/자살|죽고\s*싶|살기\s*싫|자해/.test(s))
    return { level: "critical", title: "많이 힘드셨을 것 같아요. 혼자 견디지 마세요.", body: "지금 마음이 힘들다면 전문 상담사와 바로 이야기할 수 있어요.", resources: [{ label: "자살예방상담", value: "1393" }, { label: "정신건강상담", value: "1577-0199" }] };
  if (/증상|무슨\s*병|약\s*먹|처방|통증|당뇨|고혈압/.test(s))
    return { level: "warn", title: "건강 문제는 전문의 상담이 가장 안전해요", body: "일반 정보만 알려드릴 수 있어요. 진단·처방은 꼭 의사·약사와 상의하세요." };
  if (/대출|투자|코인|주식|보험\s*가입|재테크/.test(s))
    return { level: "warn", title: "돈이 오가는 결정은 천천히, 공식 창구에서", body: "투자·대출·보험은 원금 손실이나 불리한 조건 위험이 있어요. ‘보장·고수익’은 특히 조심하고, 진행 전 공식 창구·가족과 확인하세요.", resources: [{ label: "금융 사기 의심 시", value: "1332" }] };
  return null;
}

function followUpsFor(cat: string): string[] {
  if (cat === "rental") return ["의무 사용기간이 뭔가요?", "중도 해지하면 위약금이 있나요?"];
  if (cat === "travel") return ["KTX랑 고속버스 중 뭐가 싸요?", "성수기 피하는 시기는 언제예요?"];
  if (cat === "shopping") return ["배송비까지 합치면 얼마예요?", "더 싼 곳도 있을까요?"];
  return ["좀 더 자세히 알려줄래요?", "제 상황에 맞게 정리해줄래요?"];
}

// 키가 없을 때 쓰는 결정형(정해진) 답변.
function cannedAnswer(text: string, cat: string) {
  return {
    summary: cat === "rental"
      ? "정수기 렌탈은 월 요금·약정·의무기간·자동결제를 꼭 함께 비교하는 게 좋아요."
      : cat === "life"
        ? `말씀 잘 들었어요. '${text.slice(0, 20)}'에 대해 도움드릴게요.`
        : `'${text.slice(0, 24)}' 관련해서 핵심부터 정리해 드릴게요.`,
    sections: [
      { title: "먼저 확인할 점", body: cat === "rental" ? "월 렌탈료뿐 아니라 총 소유비용(월×약정)과 중도해지 위약금을 함께 보세요." : "핵심 조건(총비용·기간·취소 규정)을 먼저 비교하는 것이 좋아요." },
      { title: "이렇게 하면 좋아요", body: "표시 가격만 보지 말고 배송비·수수료·자동결제까지 포함한 총비용으로 판단하세요." },
    ],
    uncertainty: { message: "가격·조건은 시점에 따라 달라질 수 있어요. 진행 전에 다시 확인하세요." },
  };
}

// api.ts 의 Api 와 동일한 시그니처
export const MockApi = {
  async createConversation() { resetLLM(); return { conversation_id: rid("cnv") }; },
  async chatMissions() {
    return {
      missions: CHAT_MISSIONS.map((m) => ({
        ...m,
        turns: state.mission.active?.missionId === m.missionId ? state.mission.active.turns : 0,
        state: state.mission.completed.has(m.missionId) ? ("completed" as const) : state.mission.active?.missionId === m.missionId ? ("active" as const) : ("available" as const),
      })),
      streak: { days: state.streakDays, bonus: null },
    };
  },
  async startChatMission(missionId: string) {
    const def = CHAT_MISSIONS.find((m) => m.missionId === missionId);
    if (!def || state.mission.completed.has(missionId)) throw { code: "CONFLICT", title: "오늘 이미 완료한 미션이에요." };
    state.mission.active = { missionId, turns: 0 };
    return { missionId, opening: def.opening, turnsRequired: def.turnsRequired };
  },
  async chatStatus() { return chatStatusObj(); },
  // 광고 시청 완료 → 대화 N회 추가 개방 + 포인트 적립(수익화 미션).
  async watchChatAd() {
    state.chat.adUnlocks += 1;
    addReward("대화 연장 광고 보상", "chat_ad", state.chat.adReward, true);
    return { status: chatStatusObj(), rewarded: state.chat.adReward };
  },
  async ask(_c: string, text: string) {
    const safety = safetyOf(text);
    const cat = category(text);
    // 안전(위기·사기) 대화는 절대 게이팅하지 않는다 — 도움이 우선.
    const critical = !!(safety && safety.level === "critical");
    // 무료 대화 소진 시: 답하지 않고 '광고 보고 이어가기' 게이트를 돌려준다.
    if (!critical && chatStatusObj().locked) {
      return {
        answerSnapshotId: rid("ans"), answer: null, gated: true, chat: chatStatusObj(),
        commercial: null, matched: { benefits: [], missions: [] }, needLevel: "none" as const,
        rewardNudge: null, safetyNotice: null, followUps: [], fallback: false,
      };
    }
    if (!critical) state.chat.used += 1;
    // 위험 상황이면 광고 미노출(백엔드와 동일).
    const { need, nudge } = safety ? { need: "none" as const, nudge: null } : needOf(text, cat);
    const matched = safety ? { benefits: [], missions: [] } : curate(cat, need);

    // 키가 있으면 실제 Claude로 '진짜 대화'(멀티턴). 위기·사기(critical)는 안전 문구를 우선.
    // fallback: 이 답변이 실제 AI가 아니라 예시로 만들어졌는가(정직한 상태 표시용).
    let fallback = true;
    let answer = cannedAnswer(text, cat);
    if (hasClientLLM && !(safety && safety.level === "critical")) {
      try {
        const r = await llmAnswer(text, safety?.body ?? null);
        answer = { summary: r.summary, sections: r.sections, uncertainty: { message: "가격·조건은 시점에 따라 달라질 수 있어요." } };
        fallback = false; // 실제 AI 응답 성공
      } catch {
        // 실제 AI 연결이 안 됐는데 조용히 예시로 답하면 사용자가 원인을 알 수 없음 → 이유를 화면에 노출.
        const why = !keyLooksValid
          ? "API 키 형식이 올바르지 않아요. sk-ant- 로 시작하는 키를 EXPO_PUBLIC_ANTHROPIC_KEY 에 다시 넣어 주세요."
          : (getLLMError() || "인터넷 연결을 확인해 주세요.");
        answer = {
          summary: "지금은 실제 AI 연결이 안 돼 예시로 답했어요.",
          sections: [
            { title: "무엇이 문제인가요?", body: why },
            { title: "이렇게 해보세요", body: "인터넷을 확인하고, 키를 넣은 뒤에는 Expo를 완전히 종료했다가 다시 실행해 주세요(캐시 때문에 반영이 늦을 수 있어요)." },
          ],
          uncertainty: { message: "연결되면 자동으로 실제 대화로 바뀌어요." },
        };
      }
    }

    // 스폰서 대화 미션 진행(위기 대화에서는 미션·보상 언급 없음 — 안전 우선).
    let mission: any = null;
    if (!critical && state.mission.active) {
      const def = CHAT_MISSIONS.find((m) => m.missionId === state.mission.active!.missionId)!;
      state.mission.active.turns += 1;
      const completed = state.mission.active.turns >= def.turnsRequired;
      mission = { missionId: def.missionId, title: def.title, sponsor: def.sponsor, turns: state.mission.active.turns, turnsRequired: def.turnsRequired, completed, reward: def.reward };
      if (completed) {
        state.mission.completed.add(def.missionId);
        state.mission.active = null;
        addReward("대화 미션 보상", "sponsor_chat", def.reward, true); // 스폰서 재원 → 즉시 사용가능
      }
    }

    return {
      answerSnapshotId: rid("ans"),
      answer,
      commercial: matched.benefits[0] ?? null,
      matched,
      needLevel: need,
      rewardNudge: nudge,
      safetyNotice: safety,
      followUps: safety && safety.level === "critical" ? [] : followUpsFor(cat),
      // 안전(critical) 답변은 정해진 안내가 맞으므로 예시 태그를 붙이지 않음.
      fallback: safety && safety.level === "critical" ? false : fallback,
      gated: false,
      chat: chatStatusObj(),
      mission,
      streak: critical ? undefined : { days: state.streakDays, bonus: null },
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
  async setConsent(purpose: string, granted: boolean) { return { purpose, granted }; },
  async consents() {
    return { consents: [
      { purpose: "service", granted: 1, policy_version: "v1.0", updated_at: new Date().toISOString() },
      { purpose: "third_party", granted: 0, policy_version: "v1.0", updated_at: new Date().toISOString() },
      { purpose: "personalized_ads", granted: 0, policy_version: "v1.0", updated_at: new Date().toISOString() },
      { purpose: "marketing", granted: 0, policy_version: "v1.0", updated_at: new Date().toISOString() },
    ] };
  },
  async logout() { return { ok: true }; },
  async me() { return { region: state.region, display_name: "게스트" }; },
  async setRegion(region: string | null) { state.region = region; return { region }; },
  async proactive() {
    const pod = new Date().getHours() < 11 ? "아침" : new Date().getHours() < 17 ? "낮" : "저녁";
    const w = state.region ? { label: "맑음", tempC: 18 } : null;
    const parts = [`좋은 ${pod}이에요.`];
    if (w) parts.push(`${state.region}은 지금 ${w.label}, ${w.tempC}도예요. 산책하기 좋은 날이에요.`);
    if (state.wallet.available >= 3000) parts.push("모아둔 포인트로 쿠폰을 바꿀 수 있어요.");
    else if (state.wallet.pending > 0) parts.push("확인 중인 보상이 곧 사용 가능으로 바뀔 거예요.");
    return {
      greeting: "안녕하세요 👋",
      message: parts.join(" "),
      topic: pod === "아침" ? "오늘 하루 어떻게 보내면 좋을지 같이 계획해볼까요?" : "점심 뭐 드셨어요? 저녁 메뉴 같이 골라볼까요?",
      action: state.wallet.available >= 3000 ? { label: "쿠폰으로 교환", tab: "내보상" } : null,
      weather: w,
    };
  },
  async submitLead(_s: string, _lead: any) {
    addReward("렌탈 보상", "rental_cpa", 40000, false);
    return { lead_id: rid("led"), click_id: rid("clk"), advertiser_name: "○○웰스" };
  },
};
