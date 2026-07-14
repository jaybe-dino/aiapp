// 쿠폰 지급 Saga(기획안 15.5).
// 1) 멱등성 검증 → 2) 원장에서 available→payout_reserved 예약 + payout_order(RESERVED)
// → 3) Worker가 쿠폰 발급 → 4) 성공: paid, 명확한 실패: 예약 해제(available 복구)
// → 5) UNKNOWN: 재발급 없이 상태 보류 후 대사(사용자 잔액은 예약 상태로 보호).
import { db } from "../../db/index.js";
import { id, now, sha256 } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { bookPayoutReserve, bookPayoutPaid, bookPayoutReversed } from "../ledger/ledger.js";
import { issueCoupon } from "./coupon.provider.js";

interface PayoutRow {
  payout_id: string;
  user_id: string;
  amount: number;
  product_id: string;
  status: string;
  coupon_code: string | null;
}

export async function requestPayout(p: {
  userId: string;
  amount: number;
  productId: string;
  idempotencyKey: string;
}): Promise<PayoutRow> {
  if (p.amount <= 0) throw Problems.badRequest("교환 금액이 올바르지 않습니다.");

  // 요청 키 유일. 같은 키 + 같은 내용은 기존 주문 반환(멱등). 같은 키 + 다른 내용은 409(15.4).
  const dup = db.prepare("SELECT * FROM payout_orders WHERE idempotency_key = ?").get(p.idempotencyKey) as
    | PayoutRow
    | undefined;
  if (dup) {
    if (dup.amount !== p.amount || dup.product_id !== p.productId) {
      throw Problems.conflict("같은 요청 키로 다른 내용이 접수되었습니다.", "Idempotency-Key 재사용 규칙 위반");
    }
    if (dup.status === "reserved") await runSaga(dup.payout_id); // 미완 saga 이어서 진행
    return getPayout(dup.payout_id)!;
  }

  const payoutId = id("pay");
  const ts = now();

  // 예약: 원장 트랜잭션(잔액 부족이면 여기서 409). payout_order 생성.
  bookPayoutReserve({ userId: p.userId, payoutId, amount: p.amount });
  db.prepare(
    `INSERT INTO payout_orders (payout_id, user_id, amount, currency, product_id, status, coupon_code, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'KRW', ?, 'reserved', NULL, ?, ?, ?)`
  ).run(payoutId, p.userId, p.amount, p.productId, p.idempotencyKey, ts, ts);

  await runSaga(payoutId);
  return getPayout(payoutId)!;
}

async function runSaga(payoutId: string): Promise<void> {
  const order = getPayout(payoutId);
  if (!order || order.status !== "reserved") return;

  const providerIdempotencyKey = sha256(`coupon:${payoutId}`);
  const requestHash = sha256(JSON.stringify({ payoutId, amount: order.amount, productId: order.product_id }));
  const res = await issueCoupon({ providerIdempotencyKey, amount: order.amount, productId: order.product_id });

  db.prepare(
    "INSERT INTO payout_attempts (id, payout_id, provider, request_hash, provider_request_id, result, created_at) VALUES (?, ?, 'coupon_mock', ?, ?, ?, ?)"
  ).run(id("pat"), payoutId, requestHash, res.providerRequestId ?? null, res.result, now());

  if (res.result === "success") {
    bookPayoutPaid({ payoutId, amount: order.amount });
    db.prepare("UPDATE payout_orders SET status = 'paid', coupon_code = ?, updated_at = ? WHERE payout_id = ?").run(
      res.couponCode ?? null,
      now(),
      payoutId
    );
  } else if (res.result === "fail") {
    bookPayoutReversed({ userId: order.user_id, payoutId, amount: order.amount });
    db.prepare("UPDATE payout_orders SET status = 'reversed', updated_at = ? WHERE payout_id = ?").run(now(), payoutId);
  } else {
    // UNKNOWN: 재발급 금지. 상태만 unknown 으로 두고 대사에서 조회/정정(잔액은 reserved로 보호).
    db.prepare("UPDATE payout_orders SET status = 'unknown', updated_at = ? WHERE payout_id = ?").run(now(), payoutId);
  }
}

export function getPayout(payoutId: string): PayoutRow | undefined {
  return db.prepare("SELECT * FROM payout_orders WHERE payout_id = ?").get(payoutId) as PayoutRow | undefined;
}

export function listPayouts(userId: string): PayoutRow[] {
  return db.prepare("SELECT * FROM payout_orders WHERE user_id = ? ORDER BY created_at DESC").all(userId) as PayoutRow[];
}
