// 커머셜 엔진(기획안 11~13장).
// 핵심 경계: 이 모듈은 대화 '원문'을 절대 받지 않는다. 오직 제한된 IntentContext만 받는다(불변조건).
// No Ad Is Valid: 적합 후보가 없으면 null 을 정상 응답으로 반환.
import { db } from "../../db/index.js";
import { id, now, token, hmac } from "../../lib/id.js";
import { config } from "../../config.js";

// 답변 확정 후 생성되는 '제한된 의도 문맥'(기획안 12.2). 원문/민감정보 없음.
export interface IntentContext {
  category: string | null; // travel|shopping|survey ...
  priceBand: "low" | "mid" | "high" | null;
  region: string; // KR
  commercialAllowed: boolean; // 안전엔진 판정(고위험이면 false)
}

export interface OfferCard {
  offerId: string;
  offerSnapshotId: string;
  supplierId: string;
  label: "광고·제휴 혜택";
  advertiserName: string;
  title: string;
  recommendationReason: string;
  totalCost: number;
  expectedReward: number; // "확정 시 최대" — 확정 잔액처럼 보이면 안 됨(문구는 클라이언트)
  approvalWindow: string;
  cancelTerms: string;
  autoRenewal: boolean;
  dataSharing: string;
  category: string;
  // 렌탈(구독형) 전용. 일반 오퍼는 null.
  isRental: boolean;
  monthlyFee: number | null;
  contractMonths: number | null;
  mandatoryMonths: number | null;
}

interface OfferJoinRow {
  offer_id: string;
  supplier_id: string;
  category: string;
  title: string;
  advertiser_name: string;
  price_band: string;
  reward_eligible: number;
  high_risk: number;
  offer_snapshot_id: string;
  total_cost: number;
  reward_amount: number;
  commission_amount: number;
  approval_window: string;
  cancel_terms: string;
  auto_renewal: number;
  data_sharing: string;
  monthly_fee: number | null;
  contract_months: number | null;
  mandatory_months: number | null;
}

/** 최신 스냅샷을 가진 활성 오퍼 목록(혜택/미션 탭 및 답변 카드 후보). */
function candidateOffers(filter: { category?: string | null; types?: string[] }): OfferJoinRow[] {
  const rows = db
    .prepare(
      `SELECT o.offer_id, o.supplier_id, o.category, o.title, o.advertiser_name, o.price_band,
              o.reward_eligible, o.high_risk,
              v.offer_snapshot_id, v.total_cost, v.reward_amount, v.commission_amount,
              v.approval_window, v.cancel_terms, v.auto_renewal, v.data_sharing,
              v.monthly_fee, v.contract_months, v.mandatory_months
       FROM offers o
       JOIN suppliers s ON s.supplier_id = o.supplier_id
       JOIN offer_versions v ON v.offer_id = o.offer_id
       WHERE o.status = 'active'
         AND s.reward_traffic_allowed = 1
         AND v.effective_at = (
           SELECT MAX(v2.effective_at) FROM offer_versions v2 WHERE v2.offer_id = o.offer_id
         )`
    )
    .all() as OfferJoinRow[];

  return rows.filter((r) => {
    if (r.high_risk) return false; // 고위험 자동추천 제외(불변조건 2)
    if (filter.category && r.category !== filter.category) return false;
    if (filter.types && !filter.types.includes(supplierType(r.supplier_id))) return false;
    return true;
  });
}

function supplierType(supplierId: string): string {
  const s = db.prepare("SELECT type FROM suppliers WHERE supplier_id = ?").get(supplierId) as { type: string } | undefined;
  return s?.type ?? "";
}

function toCard(r: OfferJoinRow, reason: string): OfferCard {
  return {
    offerId: r.offer_id,
    offerSnapshotId: r.offer_snapshot_id,
    supplierId: r.supplier_id,
    label: "광고·제휴 혜택",
    advertiserName: r.advertiser_name,
    title: r.title,
    recommendationReason: reason,
    totalCost: r.total_cost,
    expectedReward: r.reward_amount,
    approvalWindow: r.approval_window,
    cancelTerms: r.cancel_terms,
    autoRenewal: !!r.auto_renewal,
    dataSharing: r.data_sharing,
    category: r.category,
    isRental: r.category === "rental" || r.monthly_fee != null,
    monthlyFee: r.monthly_fee,
    contractMonths: r.contract_months,
    mandatoryMonths: r.mandatory_months,
  };
}

/**
 * 답변 뒤에 붙일 오퍼 카드 1개 선택(턴당 최대 1개).
 * 랭킹: 수수료가 아니라 '사용자 순가치'(예상보상 - 자동결제/해지 위험 페널티)로 정렬(기획안 10장).
 * 적합 후보 없으면 null.
 */
export function selectOfferForAnswer(ctx: IntentContext): OfferCard | null {
  if (!ctx.commercialAllowed) return null;
  // 렌탈 의도면 렌탈 공급망까지 후보에 포함
  const types = ctx.category === "rental" ? ["rental_cpa"] : ["shopping_cps", "offerwall_cpa"];
  const cands = candidateOffers({ category: ctx.category, types });
  if (!cands.length) return null;

  const ranked = cands
    .map((r) => {
      const autoRenewalPenalty = r.auto_renewal ? 1500 : 0;
      const userNetValue = r.reward_amount - autoRenewalPenalty;
      return { r, userNetValue };
    })
    .sort((a, b) => b.userNetValue - a.userNetValue);

  const best = ranked[0]!.r;
  const reason =
    best.category === "rental"
      ? "질문하신 렌탈과 관련된 검수된 제휴 상품"
      : ctx.category
        ? `현재 질문(${ctx.category})과 관련되고, 총비용 대비 예상 보상이 큰 혜택`
        : "질문과 관련성이 확인된 혜택";
  return toCard(best, reason);
}

/** 혜택 탭: 쇼핑형 오퍼 목록. */
export function listShoppingOffers(): OfferCard[] {
  return candidateOffers({ types: ["shopping_cps"] }).map((r) => toCard(r, "검수된 쇼핑·예약 제휴"));
}

/** 미션 탭: 오퍼월형(행동형) 오퍼 목록. */
export function listMissionOffers(): OfferCard[] {
  return candidateOffers({ types: ["offerwall_cpa"] }).map((r) => toCard(r, "행동형 미션 보상"));
}

/** 렌탈 탭/섹션: 정수기·비데·공기청정기 등 렌탈(구독형) 오퍼 목록. */
export function listRentalOffers(): OfferCard[] {
  return candidateOffers({ types: ["rental_cpa"] }).map((r) => toCard(r, "검수된 렌탈 제휴 · 조건을 꼭 확인하세요"));
}

/**
 * 대화 채팅용 매칭 — 답변의 주요 요인(의도 카테고리)에 맞는 혜택·미션을 함께 제시.
 * 안전(고위험)엔 노출 안 함. 혜택은 카테고리 매칭(없으면 대표 혜택), 미션은 관련 상위.
 */
export function matchForChat(ctx: IntentContext): { benefits: OfferCard[]; missions: OfferCard[] } {
  if (!ctx.commercialAllowed) return { benefits: [], missions: [] };
  const benefitTypes = ctx.category === "rental" ? ["rental_cpa"] : ["shopping_cps", "rental_cpa"];
  let benefitRows = candidateOffers({ category: ctx.category, types: benefitTypes });
  if (!benefitRows.length) benefitRows = candidateOffers({ types: benefitTypes }); // 카테고리 매칭 없으면 대표 혜택
  const missionRows = candidateOffers({ types: ["offerwall_cpa"] });
  const reason = ctx.category ? `질문(${ctx.category})과 관련된 혜택` : "관련 혜택";
  return {
    benefits: benefitRows.slice(0, 2).map((r) => toCard(r, reason)),
    missions: missionRows.slice(0, 2).map((r) => toCard(r, "함께 하면 좋은 미션")),
  };
}

export function getOfferSnapshot(offerSnapshotId: string): OfferCard | null {
  const r = db
    .prepare(
      `SELECT o.offer_id, o.supplier_id, o.category, o.title, o.advertiser_name, o.price_band,
              o.reward_eligible, o.high_risk,
              v.offer_snapshot_id, v.total_cost, v.reward_amount, v.commission_amount,
              v.approval_window, v.cancel_terms, v.auto_renewal, v.data_sharing,
              v.monthly_fee, v.contract_months, v.mandatory_months
       FROM offer_versions v JOIN offers o ON o.offer_id = v.offer_id
       WHERE v.offer_snapshot_id = ?`
    )
    .get(offerSnapshotId) as OfferJoinRow | undefined;
  return r ? toCard(r, "선택하신 혜택 상세") : null;
}

/**
 * 외부 이동용 서명 클릭 생성(기획안 5.2, 13.1).
 * click_id + offer_snapshot_id 를 함께 고정하고 서명한다. 이후 postback 귀속의 근거.
 */
export function createClick(p: {
  userId: string;
  offerSnapshotId: string;
  answerSnapshotId?: string | null;
}): { clickId: string; redirectUrl: string; expiresAt: string } | null {
  const card = getOfferSnapshot(p.offerSnapshotId);
  if (!card) return null;
  const offer = db.prepare("SELECT landing_domain FROM offers WHERE offer_id = ?").get(card.offerId) as
    | { landing_domain: string }
    | undefined;
  if (!offer) return null;

  const clickId = "clk_" + token(18);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // 귀속 만료 7일
  const signature = hmac(config.clickSigningSecret, `${clickId}:${p.offerSnapshotId}:${card.supplierId}`);

  db.prepare(
    `INSERT INTO clicks (click_id, user_id, offer_id, offer_snapshot_id, supplier_id, answer_snapshot_id, signature, attribution_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(clickId, p.userId, card.offerId, p.offerSnapshotId, card.supplierId, p.answerSnapshotId ?? null, signature, expiresAt, now());

  // 허용 도메인 + HTTPS + 서명 파라미터가 붙은 단기 서명 URL(운영에선 서버가 실제 딥링크 생성)
  const redirectUrl = `https://${offer.landing_domain}/?click_id=${clickId}&sig=${signature.slice(0, 16)}`;
  return { clickId, redirectUrl, expiresAt };
}
