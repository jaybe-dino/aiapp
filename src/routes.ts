// 사용자 API 라우트(기획안 17장).
// 인증: Authorization: Bearer <세션토큰> 우선, dev 에선 x-user-id 폴백.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db/index.js";
import { id, now, hmac } from "./lib/id.js";
import crypto from "node:crypto";
import { config } from "./config.js";
import { ProblemError, Problems } from "./lib/problem.js";
import { withIdempotency } from "./lib/idempotency.js";
import { verifyToken } from "./lib/auth.js";
import { rateLimit } from "./lib/ratelimit.js";
import { str, int } from "./lib/validate.js";
import { handleTurn } from "./modules/ai/orchestrator.js";
import {
  listShoppingOffers,
  listMissionOffers,
  listRentalOffers,
  getOfferSnapshot,
  createClick,
} from "./modules/commercial/commercial.js";
import { submitRentalLead, listLeadsForUser } from "./modules/commercial/lead.js";
import { ingestConversion } from "./modules/attribution/attribution.js";
import { userWallet, assertLedgerBalanced } from "./modules/ledger/ledger.js";
import { listRewards, getReward, rewardTimeline, approve, makeAvailable, reverse } from "./modules/reward/reward.js";
import { requestPayout, getPayout, listPayouts } from "./modules/payout/payout.js";
import { syncSteps, claimMilestone, todayStatus } from "./modules/cashwalk/cashwalk.js";
import { guestLogin, phoneStart, phoneVerify, getUser, listConsents, setConsent, hasConsent } from "./modules/auth/auth.js";

/** 인증된 사용자 ID를 해석한다. 없으면 401. */
function uid(req: FastifyRequest): string {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    const v = verifyToken(auth.slice(7));
    if (v) return v.uid;
    throw new ProblemError({ status: 401, code: "UNAUTHORIZED", title: "로그인이 필요합니다.", detail: "세션이 만료되었거나 올바르지 않습니다." });
  }
  // dev 폴백: x-user-id (운영에선 비활성)
  if (config.allowHeaderAuth) {
    const h = req.headers["x-user-id"] as string | undefined;
    if (h) return h;
  }
  throw new ProblemError({ status: 401, code: "UNAUTHORIZED", title: "로그인이 필요합니다." });
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

  // 보안 헤더 + 쓰기 API 레이트리밋
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && req.url.startsWith("/v1/")) {
      const who = (req.headers["authorization"] as string) || (req.headers["x-user-id"] as string) || req.ip;
      const rl = rateLimit(`w:${req.ip}:${who}`);
      if (!rl.ok) {
        reply.header("Retry-After", String(rl.retryAfterSec));
        return reply.status(429).send({ type: "about:blank", code: "RATE_LIMITED", title: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", status: 429, request_id: reqId() });
      }
    }
  });

  app.get("/health", async () => ({ ok: true, ts: now() }));

  // --- 인증 -----------------------------------------------------------
  app.post("/v1/auth/guest", async (req: FastifyRequest<{ Body: { device_id?: string } }>) => {
    const r = guestLogin(req.body?.device_id);
    return { user_id: r.userId, token: r.token, display_name: r.displayName, token_type: "Bearer" };
  });
  app.post("/v1/auth/phone/start", async (req: FastifyRequest<{ Body: { phone: string } }>) => {
    const r = phoneStart(String(req.body?.phone ?? ""));
    // 운영에선 devCode 를 응답에 넣지 않는다(SMS 발송). dev 에서만 노출.
    return { challenge_id: r.challengeId, ...(config.enableDevEndpoints ? { dev_code: r.devCode } : {}) };
  });
  app.post("/v1/auth/phone/verify", async (req: FastifyRequest<{ Body: { challenge_id: string; code: string } }>) => {
    const r = phoneVerify(String(req.body?.challenge_id ?? ""), String(req.body?.code ?? ""));
    return { user_id: r.userId, token: r.token, token_type: "Bearer" };
  });
  app.get("/v1/me", async (req) => {
    const u = getUser(uid(req));
    if (!u) throw Problems.notFound("사용자");
    return { user_id: u.user_id, display_name: u.display_name, age_band: u.age_band, font_scale: u.font_scale, tts_enabled: !!u.tts_enabled };
  });

  // --- 동의 -----------------------------------------------------------
  app.get("/v1/consents", async (req) => ({ consents: listConsents(uid(req)) }));
  app.put("/v1/consents/:purpose", async (req: FastifyRequest<{ Params: { purpose: string }; Body: { granted: boolean } }>) => {
    return setConsent(uid(req), req.params.purpose, !!req.body?.granted);
  });

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
    const text = str(req.body?.text, "질문 내용", { min: 1, max: 2000 });
    const result = await handleTurn({ conversationId, userId, question: text });
    return result;
  });

  // --- 혜택(쇼핑)/미션(오퍼월) 목록 & 상세 ----------------------------
  app.get("/v1/offers", async (req: FastifyRequest<{ Querystring: { type?: string } }>) => {
    const type = req.query.type;
    if (type === "mission") return { offers: listMissionOffers() };
    if (type === "shopping") return { offers: listShoppingOffers() };
    if (type === "rental") return { offers: listRentalOffers() };
    return { shopping: listShoppingOffers(), mission: listMissionOffers(), rental: listRentalOffers() };
  });

  app.get("/v1/offers/:snapshotId", async (req: FastifyRequest<{ Params: { snapshotId: string } }>) => {
    const card = getOfferSnapshot(req.params.snapshotId);
    if (!card) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "혜택을 찾을 수 없습니다." });
    return card;
  });

  // 외부 이동용 서명 클릭 생성. 렌탈(리드형)은 제3자 제공 동의가 있어야 진행 가능.
  app.post("/v1/offers/:snapshotId/clicks", async (req: FastifyRequest<{ Params: { snapshotId: string }; Body: { answer_snapshot_id?: string } }>) => {
    const userId = uid(req);
    const key = requireIdem(req);
    const snap = getOfferSnapshot(req.params.snapshotId);
    if (!snap) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "혜택을 찾을 수 없습니다." });
    // 연락처·주소를 제휴사에 전달하는 오퍼(렌탈 리드 등)는 third_party 동의 필수(개인정보 목적 제한).
    if (snap.dataSharing !== "없음" && !hasConsent(userId, "third_party")) {
      throw new ProblemError({
        status: 403,
        code: "CONSENT_REQUIRED",
        title: "개인정보 제3자 제공 동의가 필요합니다.",
        detail: `${snap.advertiserName}에 ${snap.dataSharing}이(가) 전달됩니다. 동의 후 진행할 수 있어요.`,
        nextAction: { label: "동의하고 계속", href: "/v1/consents/third_party" },
      });
    }
    return withIdempotency("click", key, req.body, () => {
      const res = createClick({ userId, offerSnapshotId: req.params.snapshotId, answerSnapshotId: req.body?.answer_snapshot_id ?? null });
      if (!res) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "혜택을 찾을 수 없습니다." });
      return { click_id: res.clickId, redirect_url: res.redirectUrl, attribution_expires_at: res.expiresAt };
    });
  });

  // --- 렌탈 리드(설치 상담 신청) -------------------------------------
  app.post("/v1/offers/:snapshotId/lead", async (req: FastifyRequest<{ Params: { snapshotId: string }; Body: { name: string; phone: string; address: string; preferred_time?: string } }>) => {
    const userId = uid(req);
    const key = requireIdem(req);
    return withIdempotency("lead", key, { snap: req.params.snapshotId, ...req.body }, () => {
      const b = req.body ?? ({} as any);
      const r = submitRentalLead(userId, req.params.snapshotId, {
        name: b.name, phone: b.phone, address: b.address, preferredTime: b.preferred_time,
      });
      return { lead_id: r.leadId, click_id: r.clickId, advertiser_name: r.advertiserName };
    });
  });
  app.get("/v1/leads", async (req) => ({ leads: listLeadsForUser(uid(req)) }));

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
    const amount = int(req.body?.amount, "교환 금액", { min: 100, max: 1_000_000 });
    const productId = str(req.body?.product_id ?? "coupon_3000", "상품", { max: 64 });
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
  // 보안: 공급사별 시크릿으로 raw body HMAC 서명 검증(X-Signature). 실패 시 401.
  app.post("/v1/suppliers/:supplier/postbacks", async (req: FastifyRequest<{ Params: { supplier: string }; Body: any }>) => {
    const supplierId = req.params.supplier;
    const sup = db.prepare("SELECT hmac_secret FROM suppliers WHERE supplier_id = ?").get(supplierId) as { hmac_secret: string | null } | undefined;
    if (!sup) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "알 수 없는 공급사입니다." });
    const secret = sup.hmac_secret;
    const rawBody = (req as any).rawBody as string | undefined;
    const provided = (req.headers["x-signature"] as string | undefined) ?? "";
    if (!secret) throw new ProblemError({ status: 401, code: "SUPPLIER_UNVERIFIED", title: "공급사 서명 설정이 없습니다." });
    const expected = hmac(secret, rawBody ?? JSON.stringify(req.body ?? {}));
    const ok = provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) throw new ProblemError({ status: 401, code: "BAD_SIGNATURE", title: "서명 검증에 실패했습니다." });

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

  // --- dev 전용: 전환 시뮬레이터(클라이언트 데모용) ------------------
  // 인증된 사용자의 클릭에 대해 서버가 내부적으로 전환을 생성한다(운영에선 비활성).
  app.post("/v1/dev/simulate-conversion", async (req: FastifyRequest<{ Body: { supplier: string; source: string; click_id?: string; gross_amount?: number } }>) => {
    if (!config.enableDevEndpoints) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "사용할 수 없습니다." });
    uid(req); // 인증 필요
    const b = req.body ?? ({} as any);
    const res = ingestConversion({
      supplierId: String(b.supplier ?? "sup_linkprice"),
      externalConversionId: "demo_" + id("ext"),
      clickId: b.click_id ?? null,
      source: String(b.source ?? "shopping_cps"),
      grossAmount: Number(b.gross_amount ?? 10000),
      rawPayload: b,
    });
    return { conversion_id: res.conversionId, status: res.status };
  });

  // --- 데모/개발 보조 API (운영 비활성) ------------------------------
  // [보안] 이 보조 라우트들은 인증·권한이 없어 보상 상태를 임의 조작할 수 있으므로
  // 반드시 dev 게이트로 막는다. 운영에선 attribution-worker와 어드민 콘솔(requireAdmin,
  // 이중승인)만이 보상 상태를 진행한다. dev 게이트는 운영(prod)에서 자동 false.
  const devOnly = () => {
    if (!config.enableDevEndpoints) throw new ProblemError({ status: 404, code: "NOT_FOUND", title: "사용할 수 없습니다." });
  };
  // 전환 상태 진행(공급사 승인 → 사용가능). 데모에서 전환을 '사용 가능'까지 진행할 때만.
  app.post("/v1/admin/rewards/:id/approve", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    devOnly();
    uid(req); // 인증 필요
    approve(req.params.id);
    return makeAvailable(req.params.id);
  });
  app.post("/v1/admin/rewards/:id/reverse", async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>) => {
    devOnly();
    uid(req);
    return reverse(req.params.id, req.body?.reason ?? "공급사 취소");
  });
  // 원장 균형 자가검증(대사)
  app.get("/v1/admin/ledger/check", async (req: FastifyRequest) => {
    devOnly();
    uid(req);
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
