// 사용자 API 라우트(기획안 17장). MVP 인증은 x-user-id 헤더로 대체(기본 usr_demo).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db/index.js";
import { id, now } from "./lib/id.js";
import { ProblemError } from "./lib/problem.js";
import { withIdempotency } from "./lib/idempotency.js";
import { handleTurn } from "./modules/ai/orchestrator.js";
import {
  listShoppingOffers,
  listMissionOffers,
  getOfferSnapshot,
  createClick,
} from "./modules/commercial/commercial.js";
import { ingestConversion } from "./modules/attribution/attribution.js";
import { userWallet, assertLedgerBalanced } from "./modules/ledger/ledger.js";
import { listRewards, getReward, rewardTimeline, approve, makeAvailable, reverse } from "./modules/reward/reward.js";
import { requestPayout, getPayout, listPayouts } from "./modules/payout/payout.js";
import { syncSteps, claimMilestone, todayStatus } from "./modules/cashwalk/cashwalk.js";

function uid(req: FastifyRequest): string {
  return (req.headers["x-user-id"] as string) || "usr_demo";
}
function reqId(): string {
  return id("req");
}
function requireIdem(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"] as string | undefined;
  if (!key) throw new ProblemError({ status: 400, code: "IDEMPOTENCY_REQUIRED", title: "Idempotency-Key 헤더가 필요합니다." });
  return key;
}

export function registerRoutes(app: FastifyInstance) {
  // 전역 에러 → RFC7807
  app.setErrorHandler((err, req, reply) => {
    const rid = reqId();
    if (err instanceof ProblemError) return reply.status(err.status).send(err.toBody(rid));
    req.log.error(err);
    return reply.status(500).send({ type: "about:blank", title: "서버 오류", status: 500, code: "INTERNAL", request_id: rid });
  });

  app.get("/health", async () => ({ ok: true, ts: now() }));

  // --- 대화/답변 (Answer-First) ---------------------------------------
  app.post("/v1/conversations", async (req) => {
    const userId = uid(req);
    const conversationId = id("cnv");
    db.prepare("INSERT INTO conversations (conversation_id, user_id, created_at) VALUES (?, ?, ?)").run(conversationId, userId, now());
    return { conversation_id: conversationId };
  });

  app.post("/v1/conversations/:id/messages", async (req: FastifyRequest<{ Params: { id: string }; Body: { text: string } }>) => {
    const userId = uid(req);
    const conversationId = req.params.id;
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) throw new ProblemError({ status: 400, code: "BAD_REQUEST", title: "질문 내용이 비어 있습니다." });
    const result = await handleTurn({ conversationId, userId, question: text });
    return result;
  });

  // --- 혜택(쇼핑)/미션(오퍼월) 목록 & 상세 ----------------------------
  app.get("/v1/offers", async (req: FastifyRequest<{ Querystring: { type?: string } }>) => {
    const type = req.query.type;
    if (type === "mission") return { offers: listMissionOffers() };
    if (type === "shopping") return { offers: listShoppingOffers() };
    return { shopping: listShoppingOffers(), mission: listMissionOffers() };
  });

  app.get("/v1/offers/:snapshotId", async (req: FastifyRequest<{ Params: { snapshotId: string } }>) => {
    const card = getOfferSnapshot(req.params.snapshotId);
    if (!card) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "혜택을 찾을 수 없습니다." });
    return card;
  });

  // 외부 이동용 서명 클릭 생성
  app.post("/v1/offers/:snapshotId/clicks", async (req: FastifyRequest<{ Params: { snapshotId: string }; Body: { answer_snapshot_id?: string } }>) => {
    const userId = uid(req);
    const key = requireIdem(req);
    return withIdempotency("click", key, req.body, () => {
      const res = createClick({ userId, offerSnapshotId: req.params.snapshotId, answerSnapshotId: req.body?.answer_snapshot_id ?? null });
      if (!res) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "혜택을 찾을 수 없습니다." });
      return { click_id: res.clickId, redirect_url: res.redirectUrl, attribution_expires_at: res.expiresAt };
    });
  });

  // --- 지갑/보상 ------------------------------------------------------
  app.get("/v1/wallet", async (req) => {
    const userId = uid(req);
    const w = userWallet(userId);
    const paid = (db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payout_orders WHERE user_id=? AND status='paid'").get(userId) as { s: number }).s;
    return { available: w.available, pending: w.pending, used: paid, currency: w.currency };
  });

  app.get("/v1/rewards", async (req) => {
    const userId = uid(req);
    const rows = listRewards(userId).map((r) => ({
      reward_transaction_id: r.reward_transaction_id,
      title: r.title,
      source: r.source,
      state: r.state,
      state_label: STATE_LABEL[r.state] ?? r.state,
      amount: r.approved_amount ?? r.expected_amount,
      created_at: r.created_at,
    }));
    return { rewards: rows };
  });

  app.get("/v1/rewards/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const r = getReward(req.params.id);
    if (!r) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "보상 거래를 찾을 수 없습니다." });
    return {
      reward_transaction_id: r.reward_transaction_id,
      title: r.title,
      state: r.state,
      state_label: STATE_LABEL[r.state] ?? r.state,
      amount: r.approved_amount ?? r.expected_amount,
      timeline: rewardTimeline(r.reward_transaction_id),
    };
  });

  // --- 쿠폰 교환(지급 Saga) ------------------------------------------
  app.post("/v1/payouts", async (req: FastifyRequest<{ Body: { amount: number; product_id?: string } }>) => {
    const userId = uid(req);
    const key = requireIdem(req);
    const amount = Number(req.body?.amount);
    const productId = req.body?.product_id ?? "coupon_3000";
    const order = await requestPayout({ userId, amount, productId, idempotencyKey: key });
    return {
      payout_id: order.payout_id,
      status: order.status,
      status_label: PAYOUT_LABEL[order.status] ?? order.status,
      coupon_code: order.status === "paid" ? order.coupon_code : null,
    };
  });

  app.get("/v1/payouts/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const order = getPayout(req.params.id);
    if (!order) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "교환 내역을 찾을 수 없습니다." });
    return { payout_id: order.payout_id, status: order.status, status_label: PAYOUT_LABEL[order.status], coupon_code: order.status === "paid" ? order.coupon_code : null };
  });

  app.get("/v1/payouts", async (req) => ({ payouts: listPayouts(uid(req)) }));

  // --- 캐시워크(걷기) -------------------------------------------------
  app.get("/v1/cashwalk", async (req: FastifyRequest<{ Querystring: { day?: string } }>) => {
    const userId = uid(req);
    const day = req.query.day ?? today();
    return todayStatus(userId, day);
  });

  app.post("/v1/cashwalk/steps", async (req: FastifyRequest<{ Body: { steps: number; day_key?: string; device_integrity_ok?: boolean } }>) => {
    const userId = uid(req);
    const dayKey = req.body?.day_key ?? today();
    const res = syncSteps({ userId, dayKey, steps: Number(req.body?.steps ?? 0), deviceIntegrityOk: req.body?.device_integrity_ok });
    return { ...res, ...todayStatus(userId, dayKey) };
  });

  app.post("/v1/cashwalk/claims", async (req: FastifyRequest<{ Body: { milestone: number; ad_impression_id: string; day_key?: string } }>) => {
    const userId = uid(req);
    const dayKey = req.body?.day_key ?? today();
    const res = claimMilestone({ userId, dayKey, milestone: Number(req.body?.milestone), adImpressionId: req.body?.ad_impression_id ?? "" });
    return { ...res, status: todayStatus(userId, dayKey) };
  });

  // --- 공급사 postback(전환 수신) ------------------------------------
  // 운영에선 mTLS/HMAC/IP allowlist. MVP는 공용 어댑터로 단순화(중복은 200).
  app.post("/v1/suppliers/:supplier/postbacks", async (req: FastifyRequest<{ Params: { supplier: string }; Body: any }>) => {
    const supplierId = req.params.supplier;
    const b: Record<string, any> = req.body ?? {};
    const res = ingestConversion({
      supplierId,
      externalConversionId: String(b.external_conversion_id ?? id("ext")),
      clickId: b.click_id ?? null,
      source: b.source ?? "shopping_cps",
      grossAmount: Number(b.gross_amount ?? 0),
      rawPayload: b,
    });
    return { received: true, conversion_id: res.conversionId, status: res.status, duplicate: res.duplicate };
  });

  // --- 운영/데모 보조 API --------------------------------------------
  // 전환 상태 진행(공급사 승인 → 사용가능). 운영에선 attribution-worker가 이벤트로 처리.
  app.post("/v1/admin/rewards/:id/approve", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    approve(req.params.id);
    return makeAvailable(req.params.id);
  });
  app.post("/v1/admin/rewards/:id/reverse", async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>) => {
    return reverse(req.params.id, req.body?.reason ?? "공급사 취소");
  });
  // 원장 균형 자가검증(대사)
  app.get("/v1/admin/ledger/check", async () => {
    assertLedgerBalanced();
    return { balanced: true };
  });
}

const STATE_LABEL: Record<string, string> = {
  pending: "확인 중",
  approved: "승인됨",
  available: "사용 가능",
  reserved: "교환 처리 중",
  paid: "사용 완료",
  reversed: "취소됨",
};
const PAYOUT_LABEL: Record<string, string> = {
  reserved: "교환 처리 중",
  paid: "사용 완료",
  reversed: "실패(잔액 복구됨)",
  unknown: "확인 중(잔액 보호)",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
