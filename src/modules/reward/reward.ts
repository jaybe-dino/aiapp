// 사용자 보상 거래 상태 기계(기획안 15.2).
// 상태: pending → approved → available → reserved → paid, 그리고 어디서든 reversed.
// 상태는 덮어써도 reward_state_events 와 원장 분개는 보존한다.
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { bookPendingReward, bookAvailable, bookReversal } from "../ledger/ledger.js";

export type RewardState = "pending" | "approved" | "available" | "reserved" | "paid" | "reversed";

const ALLOWED: Record<RewardState, RewardState[]> = {
  pending: ["approved", "reversed"],
  approved: ["available", "reversed"],
  available: ["reserved", "reversed"],
  reserved: ["paid", "available", "reversed"],
  paid: ["reversed"],
  reversed: [],
};

interface RewardRow {
  reward_transaction_id: string;
  conversion_id: string | null;
  user_id: string;
  source: string;
  state: RewardState;
  expected_amount: number;
  approved_amount: number | null;
  currency: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export function getReward(rewardTransactionId: string): RewardRow | undefined {
  return db
    .prepare("SELECT * FROM reward_transactions WHERE reward_transaction_id = ?")
    .get(rewardTransactionId) as RewardRow | undefined;
}

export function listRewards(userId: string): RewardRow[] {
  return db
    .prepare("SELECT * FROM reward_transactions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as RewardRow[];
}

export function rewardTimeline(rewardTransactionId: string) {
  return db
    .prepare("SELECT from_state, to_state, reason, created_at FROM reward_state_events WHERE reward_transaction_id = ? ORDER BY created_at ASC")
    .all(rewardTransactionId);
}

function recordEvent(rewardTransactionId: string, from: RewardState | null, to: RewardState, reason: string, sourceEventId?: string) {
  db.prepare(
    "INSERT INTO reward_state_events (id, reward_transaction_id, from_state, to_state, reason, source_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id("rse"), rewardTransactionId, from, to, reason, sourceEventId ?? null, now());
}

/** 전환에서 pending 보상 거래를 생성(전환별 1회, conversion_id UNIQUE 로 강제). */
export function createPendingFromConversion(p: {
  conversionId: string;
  userId: string;
  source: string;
  rewardAmount: number;
  commissionAmount: number;
  title: string;
}): RewardRow {
  const existing = db
    .prepare("SELECT * FROM reward_transactions WHERE conversion_id = ?")
    .get(p.conversionId) as RewardRow | undefined;
  if (existing) return existing; // 멱등: 같은 전환 재처리

  const rid = id("rwd");
  const ts = now();
  db.prepare(
    `INSERT INTO reward_transactions (reward_transaction_id, conversion_id, user_id, source, state, expected_amount, approved_amount, currency, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, NULL, 'KRW', ?, ?, ?)`
  ).run(rid, p.conversionId, p.userId, p.source, p.rewardAmount, p.title, ts, ts);
  recordEvent(rid, null, "pending", "유효 전환 수신·귀속");
  bookPendingReward({ userId: p.userId, conversionId: p.conversionId, rewardAmount: p.rewardAmount, commissionAmount: p.commissionAmount });
  return getReward(rid)!;
}

function transition(rid: string, to: RewardState, reason: string) {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  if (!ALLOWED[r.state].includes(to)) {
    throw Problems.conflict("허용되지 않는 상태 전이입니다.", `${r.state} → ${to}`);
  }
  db.prepare("UPDATE reward_transactions SET state = ?, updated_at = ? WHERE reward_transaction_id = ?").run(to, now(), rid);
  recordEvent(rid, r.state, to, reason);
  return getReward(rid)!;
}

export function approve(rid: string, approvedAmount?: number): RewardRow {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  const amount = approvedAmount ?? r.expected_amount;
  db.prepare("UPDATE reward_transactions SET approved_amount = ? WHERE reward_transaction_id = ?").run(amount, rid);
  return transition(rid, "approved", "공급사 승인, 금액 확정");
}

export function makeAvailable(rid: string): RewardRow {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  const amount = r.approved_amount ?? r.expected_amount;
  const out = transition(rid, "available", "반품기간·내부검증·정산 정책 통과");
  bookAvailable({ userId: r.user_id, rewardTransactionId: rid, amount });
  return out;
}

export function reverse(rid: string, reason: string): RewardRow {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  const amount = r.approved_amount ?? r.expected_amount;
  // 원장 회수: 현재 사용자 잔액 위치에 따라 회수 계정 결정
  if (r.state === "pending" || r.state === "approved") {
    bookReversal({ userId: r.user_id, rewardTransactionId: rid, amount, from: "pending" });
  } else if (r.state === "available") {
    bookReversal({ userId: r.user_id, rewardTransactionId: rid, amount, from: "available" });
  }
  return transition(rid, "reversed", reason);
}

/** 걷기/자체광고처럼 즉시 확정 가능한 보상: pending→approved→available 자동 진행. */
export function fastTrackToAvailable(rid: string): RewardRow {
  approve(rid);
  return makeAvailable(rid);
}
