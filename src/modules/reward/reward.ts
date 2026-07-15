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
  reserved: ["paid", "available"], // 지급 취소는 payout saga(available 복구)로. 직접 reversed 금지.
  paid: [], // 확정 지급은 되돌리지 않음(정정은 수동조정 흐름).
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
  // [정합] 승인액은 0 이상, 예상 적립 이하만 허용. 초과 승인은 pending 음수·available 인플레이션을 유발.
  if (amount < 0) throw Problems.badRequest("승인 금액이 올바르지 않습니다.");
  if (amount > r.expected_amount) {
    throw Problems.conflict("승인 금액이 예상 적립을 초과합니다.", `승인 ${amount}원 > 예상 ${r.expected_amount}원`);
  }
  db.prepare("UPDATE reward_transactions SET approved_amount = ? WHERE reward_transaction_id = ?").run(amount, rid);
  return transition(rid, "approved", "공급사 승인, 금액 확정");
}

export function makeAvailable(rid: string): RewardRow {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  const amount = r.approved_amount ?? r.expected_amount;
  // 승인액이 예상보다 적으면(부분 승인) 차액은 pending에서 회수해 잔액이 갇히지 않게 한다.
  const shortfall = r.expected_amount - amount;
  const out = transition(rid, "available", "반품기간·내부검증·정산 정책 통과");
  bookAvailable({ userId: r.user_id, rewardTransactionId: rid, amount });
  if (shortfall > 0) {
    bookReversal({ userId: r.user_id, rewardTransactionId: rid, amount: shortfall, from: "pending" });
  }
  return out;
}

export function reverse(rid: string, reason: string): RewardRow {
  const r = getReward(rid);
  if (!r) throw Problems.notFound("보상 거래");
  const amount = r.approved_amount ?? r.expected_amount;
  // 원장 회수: 현재 사용자 잔액 위치에 따라 회수 계정 결정.
  // reserved/paid(지급 진행/완료)는 여기서 되돌리면 원장과 불일치가 나므로 지급 취소 흐름으로만 처리.
  if (r.state === "pending" || r.state === "approved") {
    bookReversal({ userId: r.user_id, rewardTransactionId: rid, amount, from: "pending" });
  } else if (r.state === "available") {
    bookReversal({ userId: r.user_id, rewardTransactionId: rid, amount, from: "available" });
  } else {
    throw Problems.conflict("이 상태의 보상은 직접 취소할 수 없습니다.", `${r.state} 상태는 지급(payout) 취소 흐름으로 처리하세요.`);
  }
  return transition(rid, "reversed", reason);
}

/** 걷기/자체광고처럼 즉시 확정 가능한 보상: pending→approved→available 자동 진행. */
export function fastTrackToAvailable(rid: string): RewardRow {
  approve(rid);
  return makeAvailable(rid);
}
