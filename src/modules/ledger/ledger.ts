// 보상 원장 — 복식부기형 불변 원장(기획안 15장).
// 불변조건:
//  - 모든 경제사건은 2개 이상 분개를 만들고 차변합계 == 대변합계 (거래 합계 0).
//  - 금액은 항상 양수, 방향(debit/credit)으로 부호를 표현.
//  - idempotency_key 유일 → 재시도해도 중복 적립/차감 없음.
//  - 삭제/수정 금지. 정정은 반대 분개로만.
//  - 잔액은 컬럼이 아니라 분개 합으로 계산(projection).
import { db, tx } from "../../db/index.js";
import { id, now, uuidv7 } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";

export type Direction = "debit" | "credit";
export interface Entry {
  account: string;
  direction: Direction;
  amount: number;
}

// 계정 정의 헬퍼
export const Accounts = {
  rewardExpense: () => "platform:reward_expense",
  commissionReceivable: () => "platform:commission_receivable",
  commissionRevenue: () => "platform:commission_revenue",
  payoutReserved: () => "platform:payout_reserved",
  payoutExpense: () => "platform:payout_expense",
  userPending: (userId: string) => `user:${userId}:pending`,
  userAvailable: (userId: string) => `user:${userId}:available`,
};

function ensureAccount(accountId: string): void {
  const existing = db.prepare("SELECT 1 FROM ledger_accounts WHERE account_id = ?").get(accountId);
  if (existing) return;
  const [ownerType, ownerId, accountType] = parseAccount(accountId);
  db.prepare(
    "INSERT INTO ledger_accounts (account_id, owner_type, owner_id, currency, account_type) VALUES (?, ?, ?, 'KRW', ?)"
  ).run(accountId, ownerType, ownerId, accountType);
}

function parseAccount(accountId: string): [string, string | null, string] {
  const parts = accountId.split(":");
  if (parts[0] === "user") return ["user", parts[1] ?? null, parts[2] ?? "unknown"];
  return ["platform", null, parts.slice(1).join(":")];
}

/**
 * 원장 거래를 기록한다. 반드시 균형(차변==대변)이어야 하며, 아니면 예외.
 * idempotencyKey가 이미 있으면 기존 거래를 반환(중복 방지).
 */
export function postTransaction(params: {
  eventType: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  entries: Entry[];
  traceId?: string;
}): { ledgerTxId: string; duplicate: boolean } {
  return tx(() => {
    const dup = db
      .prepare("SELECT ledger_tx_id FROM ledger_transactions WHERE idempotency_key = ?")
      .get(params.idempotencyKey) as { ledger_tx_id: string } | undefined;
    if (dup) return { ledgerTxId: dup.ledger_tx_id, duplicate: true };

    const debit = params.entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
    const credit = params.entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
    if (params.entries.length < 2) throw new Error("원장 거래는 분개가 2개 이상이어야 합니다.");
    if (debit !== credit) throw new Error(`원장 불균형: 차변 ${debit} != 대변 ${credit}`);
    if (params.entries.some((e) => e.amount <= 0)) throw new Error("분개 금액은 양수여야 합니다.");

    const ledgerTxId = id("ltx");
    const ts = now();
    db.prepare(
      `INSERT INTO ledger_transactions (ledger_tx_id, event_type, reference_type, reference_id, idempotency_key, currency, trace_id, effective_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'KRW', ?, ?, ?)`
    ).run(
      ledgerTxId,
      params.eventType,
      params.referenceType,
      params.referenceId,
      params.idempotencyKey,
      params.traceId ?? null,
      ts,
      ts
    );

    const insEntry = db.prepare(
      "INSERT INTO ledger_entries (entry_id, ledger_tx_id, account_id, direction, amount, currency) VALUES (?, ?, ?, ?, ?, 'KRW')"
    );
    for (const e of params.entries) {
      ensureAccount(e.account);
      insEntry.run(id("lde"), ledgerTxId, e.account, e.direction, e.amount);
    }
    return { ledgerTxId, duplicate: false };
  });
}

/** 계정 잔액 = credit합 - debit합. (사용자/부채 계정 기준: 사용자에게 '남은 금액') */
export function accountBalance(accountId: string): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) AS cr,
         COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0) AS dr
       FROM ledger_entries WHERE account_id = ?`
    )
    .get(accountId) as { cr: number; dr: number };
  return row.cr - row.dr;
}

export function userWallet(userId: string): { available: number; pending: number; currency: string } {
  return {
    available: accountBalance(Accounts.userAvailable(userId)),
    pending: accountBalance(Accounts.userPending(userId)),
    currency: "KRW",
  };
}

/** 전체 원장이 균형인지 검증(모든 거래의 차변합==대변합, 전체 합==0). 대사/테스트용. */
export function assertLedgerBalanced(): void {
  const rows = db
    .prepare(
      `SELECT ledger_tx_id,
         SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END) AS net
       FROM ledger_entries GROUP BY ledger_tx_id`
    )
    .all() as { ledger_tx_id: string; net: number }[];
  const bad = rows.filter((r) => r.net !== 0);
  if (bad.length) throw new Error(`불균형 거래 ${bad.length}건: ${bad.map((b) => b.ledger_tx_id).join(",")}`);
}

// ---- 경제 이벤트별 분개 조합 ---------------------------------------------

/** 전환 확정 → 확인중(pending) 보상 생성 + 플랫폼 수수료 인식. */
export function bookPendingReward(p: {
  userId: string;
  conversionId: string;
  rewardAmount: number;
  commissionAmount: number;
}): void {
  const entries: Entry[] = [
    // 보상 부문: 플랫폼 비용 발생, 사용자 확인중 잔액 증가
    { account: Accounts.rewardExpense(), direction: "debit", amount: p.rewardAmount },
    { account: Accounts.userPending(p.userId), direction: "credit", amount: p.rewardAmount },
  ];
  if (p.commissionAmount > 0) {
    // 수수료 부문: 받을 채권 증가, 수익 인식(유닛이코노믹스 = 수익 - 보상비용)
    entries.push({ account: Accounts.commissionReceivable(), direction: "debit", amount: p.commissionAmount });
    entries.push({ account: Accounts.commissionRevenue(), direction: "credit", amount: p.commissionAmount });
  }
  postTransaction({
    eventType: "pending_created",
    referenceType: "conversion",
    referenceId: p.conversionId,
    idempotencyKey: `pending:${p.conversionId}`,
    entries,
  });
}

/** 확인중 → 사용가능. 사용자 내부 이동(pending -> available). */
export function bookAvailable(p: { userId: string; rewardTransactionId: string; amount: number }): void {
  postTransaction({
    eventType: "available",
    referenceType: "reward",
    referenceId: p.rewardTransactionId,
    idempotencyKey: `available:${p.rewardTransactionId}`,
    entries: [
      { account: Accounts.userPending(p.userId), direction: "debit", amount: p.amount },
      { account: Accounts.userAvailable(p.userId), direction: "credit", amount: p.amount },
    ],
  });
}

/** 취소/반품 → 반대 분개(from 상태에 따라 pending 또는 available 회수). */
export function bookReversal(p: {
  userId: string;
  rewardTransactionId: string;
  amount: number;
  from: "pending" | "available";
}): void {
  const src = p.from === "pending" ? Accounts.userPending(p.userId) : Accounts.userAvailable(p.userId);
  postTransaction({
    eventType: "reversed",
    referenceType: "reward",
    referenceId: p.rewardTransactionId,
    idempotencyKey: `reversed:${p.rewardTransactionId}:${uuidv7().slice(0, 8)}`,
    entries: [
      { account: src, direction: "debit", amount: p.amount },
      { account: Accounts.rewardExpense(), direction: "credit", amount: p.amount },
    ],
  });
}

/** 쿠폰 교환 예약: available -> payout_reserved. 잔액 부족이면 예외. */
export function bookPayoutReserve(p: { userId: string; payoutId: string; amount: number }): void {
  const available = accountBalance(Accounts.userAvailable(p.userId));
  if (available < p.amount) {
    throw Problems.conflict("사용 가능한 보상이 부족합니다.", `필요 ${p.amount}원, 보유 ${available}원`);
  }
  postTransaction({
    eventType: "payout_reserved",
    referenceType: "payout",
    referenceId: p.payoutId,
    idempotencyKey: `reserve:${p.payoutId}`,
    entries: [
      { account: Accounts.userAvailable(p.userId), direction: "debit", amount: p.amount },
      { account: Accounts.payoutReserved(), direction: "credit", amount: p.amount },
    ],
  });
}

/** 쿠폰 발급 성공: reserved -> expense(지급 확정). */
export function bookPayoutPaid(p: { payoutId: string; amount: number }): void {
  postTransaction({
    eventType: "paid",
    referenceType: "payout",
    referenceId: p.payoutId,
    idempotencyKey: `paid:${p.payoutId}`,
    entries: [
      { account: Accounts.payoutReserved(), direction: "debit", amount: p.amount },
      { account: Accounts.payoutExpense(), direction: "credit", amount: p.amount },
    ],
  });
}

/** 쿠폰 발급 명확한 실패: reserved -> available(잔액 복구). */
export function bookPayoutReversed(p: { userId: string; payoutId: string; amount: number }): void {
  postTransaction({
    eventType: "payout_reversed",
    referenceType: "payout",
    referenceId: p.payoutId,
    idempotencyKey: `payout_reversed:${p.payoutId}`,
    entries: [
      { account: Accounts.payoutReserved(), direction: "debit", amount: p.amount },
      { account: Accounts.userAvailable(p.userId), direction: "credit", amount: p.amount },
    ],
  });
}
