// 운영자 콘솔 백엔드(기획안 20장). 핵심: 금액 직접수정 금지 → 이중 승인, 모든 행위 감사.
import { db, tx } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { accountBalance, Accounts, assertLedgerBalanced, bookManualAdjustment, bookPayoutPaid, bookPayoutReversed } from "../ledger/ledger.js";
import { approve, makeAvailable, reverse, getReward, createPendingFromConversion } from "../reward/reward.js";

export interface AdminUser {
  admin_id: string;
  email: string;
  name: string;
  role: "ops" | "reviewer" | "finance" | "owner";
}

export function authAdmin(token: string | undefined): AdminUser {
  if (!token) throw new ProblemAuth();
  const row = db.prepare("SELECT admin_id, email, name, role FROM admin_users WHERE token = ?").get(token) as
    | AdminUser
    | undefined;
  if (!row) throw new ProblemAuth();
  return row;
}
class ProblemAuth extends Error {}
export function isAuthError(e: unknown): boolean {
  return e instanceof ProblemAuth;
}

export function audit(actor: string, action: string, target?: string, detail?: unknown) {
  db.prepare("INSERT INTO audit_log (id, actor, action, target, detail, trace_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(
    id("aud"),
    actor,
    action,
    target ?? null,
    detail ? JSON.stringify(detail) : null,
    now()
  );
}

// ---------- 대시보드 ----------
export function dashboard() {
  const rev = accountBalance(Accounts.commissionRevenue()); // credit-누적 수익
  const rewardExpense = -accountBalance(Accounts.rewardExpense()); // debit 누적(음수 balance) → 양수화
  const payoutExpense = accountBalance(Accounts.payoutExpense());
  const convByStatus = db
    .prepare("SELECT status, COUNT(*) c, COALESCE(SUM(reward_amount),0) reward FROM conversions GROUP BY status")
    .all() as { status: string; c: number; reward: number }[];
  const rewardByState = db
    .prepare("SELECT state, COUNT(*) c, COALESCE(SUM(COALESCE(approved_amount,expected_amount)),0) amt FROM reward_transactions GROUP BY state")
    .all() as { state: string; c: number; amt: number }[];
  const users = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  const pendingLiability = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger_entries e JOIN ledger_accounts a ON a.account_id=e.account_id WHERE a.account_type='pending' AND e.direction='credit'").get() as { s: number };

  let balanced = true;
  try { assertLedgerBalanced(); } catch { balanced = false; }

  return {
    revenue: rev,
    reward_expense: rewardExpense,
    payout_expense: payoutExpense,
    gross_margin: rev - rewardExpense, // 수수료 수익 - 보상 비용
    conversions_by_status: convByStatus,
    rewards_by_state: rewardByState,
    users,
    ledger_balanced: balanced,
    unknown_payouts: (db.prepare("SELECT COUNT(*) c FROM payout_orders WHERE status='unknown'").get() as { c: number }).c,
    review_conversions: (db.prepare("SELECT COUNT(*) c FROM conversions WHERE status='review'").get() as { c: number }).c,
    pending_adjustments: (db.prepare("SELECT COUNT(*) c FROM manual_adjustments WHERE status='requested'").get() as { c: number }).c,
  };
}

// ---------- 공급사 ----------
export function listSuppliers() {
  return db.prepare("SELECT supplier_id, name, type, reward_traffic_allowed FROM suppliers ORDER BY supplier_id").all();
}
export function setSupplierReward(actor: string, supplierId: string, allowed: boolean) {
  db.prepare("UPDATE suppliers SET reward_traffic_allowed = ? WHERE supplier_id = ?").run(allowed ? 1 : 0, supplierId);
  audit(actor, "supplier.reward_toggle", supplierId, { allowed });
  return { supplier_id: supplierId, reward_traffic_allowed: allowed };
}

// ---------- 오퍼 ----------
export function listOffers() {
  return db
    .prepare(
      `SELECT o.offer_id, o.supplier_id, o.category, o.title, o.advertiser_name, o.status, o.reward_eligible, o.high_risk,
              v.offer_snapshot_id, v.total_cost, v.reward_amount, v.commission_amount, v.auto_renewal, v.data_sharing, v.approval_window, v.cancel_terms
       FROM offers o LEFT JOIN offer_versions v ON v.offer_id=o.offer_id
       AND v.effective_at=(SELECT MAX(v2.effective_at) FROM offer_versions v2 WHERE v2.offer_id=o.offer_id)
       ORDER BY o.status, o.category`
    )
    .all();
}

// 필수 필드 게이트(기획안 11.3). 하나라도 없으면 노출 불가.
function offerFieldGate(v: { total_cost: number; reward_amount: number; approval_window: string; cancel_terms: string; data_sharing: string }): string[] {
  const missing: string[] = [];
  if (v.reward_amount == null) missing.push("예상 보상");
  if (!v.approval_window) missing.push("승인 기간");
  if (!v.cancel_terms) missing.push("취소·반품");
  if (!v.data_sharing) missing.push("개인정보 제공");
  return missing;
}

export function setOfferStatus(actor: string, offerId: string, status: "active" | "stopped") {
  const offer = db.prepare("SELECT offer_id FROM offers WHERE offer_id=?").get(offerId);
  if (!offer) throw Problems.notFound("오퍼");
  if (status === "active") {
    const v = db.prepare("SELECT total_cost, reward_amount, approval_window, cancel_terms, data_sharing FROM offer_versions WHERE offer_id=? ORDER BY effective_at DESC LIMIT 1").get(offerId) as any;
    const missing = v ? offerFieldGate(v) : ["조건 스냅샷"];
    if (missing.length) throw Problems.conflict("필수 항목 누락으로 노출할 수 없습니다.", missing.join(", "));
  }
  db.prepare("UPDATE offers SET status=? WHERE offer_id=?").run(status, offerId);
  audit(actor, "offer.status", offerId, { status });
  return { offer_id: offerId, status };
}

// 새 조건 스냅샷 추가(덮어쓰기 금지)
export function addOfferVersion(actor: string, offerId: string, v: {
  total_cost: number; reward_amount: number; commission_amount: number;
  approval_window: string; cancel_terms: string; auto_renewal?: boolean; data_sharing?: string;
}) {
  const offer = db.prepare("SELECT offer_id FROM offers WHERE offer_id=?").get(offerId);
  if (!offer) throw Problems.notFound("오퍼");
  const snapId = id("ofs");
  db.prepare(
    `INSERT INTO offer_versions (offer_snapshot_id, offer_id, total_cost, reward_amount, commission_amount, approval_window, cancel_terms, auto_renewal, data_sharing, effective_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(snapId, offerId, v.total_cost, v.reward_amount, v.commission_amount, v.approval_window, v.cancel_terms, v.auto_renewal ? 1 : 0, v.data_sharing ?? "없음", now());
  audit(actor, "offer.new_version", offerId, { snapId, ...v });
  return { offer_snapshot_id: snapId };
}

// ---------- 전환 대사/검토 ----------
export function listConversions(status?: string) {
  const q = status
    ? "SELECT * FROM conversions WHERE status=? ORDER BY received_at DESC LIMIT 100"
    : "SELECT * FROM conversions ORDER BY received_at DESC LIMIT 100";
  return status ? db.prepare(q).all(status) : db.prepare(q).all();
}

// review 큐의 전환을 수동 귀속(승인) → 보상 pending 생성
export function attributeConversion(actor: string, conversionId: string) {
  const c = db.prepare("SELECT * FROM conversions WHERE conversion_id=?").get(conversionId) as any;
  if (!c) throw Problems.notFound("전환");
  if (c.status === "attributed") return { ok: true, already: true };
  if (!c.user_id || c.reward_amount <= 0) throw Problems.conflict("사용자/보상 정보가 없어 수동 귀속할 수 없습니다.");
  db.prepare("UPDATE conversions SET status='attributed' WHERE conversion_id=?").run(conversionId);
  const rw = createPendingFromConversion({
    conversionId, userId: c.user_id, source: c.source, rewardAmount: c.reward_amount, commissionAmount: c.commission_amount, title: "수동 귀속 보상",
  });
  audit(actor, "conversion.attribute", conversionId, { rewardTransactionId: rw.reward_transaction_id });
  return { ok: true, reward_transaction_id: rw.reward_transaction_id };
}
export function rejectConversion(actor: string, conversionId: string, reason: string) {
  db.prepare("UPDATE conversions SET status='rejected' WHERE conversion_id=?").run(conversionId);
  audit(actor, "conversion.reject", conversionId, { reason });
  return { ok: true };
}

// ---------- 보상 상태 진행(운영) ----------
export function advanceReward(actor: string, rewardId: string) {
  const r = getReward(rewardId);
  if (!r) throw Problems.notFound("보상");
  if (r.state === "pending") approve(rewardId);
  const out = makeAvailable(rewardId);
  audit(actor, "reward.advance", rewardId, { to: out.state });
  return out;
}
export function reverseReward(actor: string, rewardId: string, reason: string) {
  const out = reverse(rewardId, reason);
  audit(actor, "reward.reverse", rewardId, { reason });
  return out;
}

// ---------- 이중 승인 수동조정 ----------
export function requestAdjustment(requester: AdminUser, p: { userId: string; amount: number; direction: "credit" | "debit"; reason: string; userMessage?: string }) {
  if (p.amount <= 0) throw Problems.badRequest("금액은 양수여야 합니다.");
  const caseId = id("adj");
  const ts = now();
  db.prepare(
    `INSERT INTO manual_adjustments (case_id, user_id, amount, direction, reason, user_message, status, requested_by, approved_by, ledger_tx_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, NULL, NULL, ?, ?)`
  ).run(caseId, p.userId, p.amount, p.direction, p.reason, p.userMessage ?? null, requester.email, ts, ts);
  audit(requester.email, "adjustment.request", caseId, p);
  return db.prepare("SELECT * FROM manual_adjustments WHERE case_id=?").get(caseId);
}

export function approveAdjustment(approver: AdminUser, caseId: string) {
  return tx(() => {
    const a = db.prepare("SELECT * FROM manual_adjustments WHERE case_id=?").get(caseId) as any;
    if (!a) throw Problems.notFound("조정 요청");
    if (a.status !== "requested") throw Problems.conflict("이미 처리된 요청입니다.", a.status);
    // 이중 승인: 요청자 != 승인자, 고액은 finance/owner 필요
    if (a.requested_by === approver.email) throw Problems.conflict("요청자와 승인자가 같을 수 없습니다.");
    if (a.amount >= 50000 && !["finance", "owner"].includes(approver.role)) {
      throw Problems.conflict("고액 조정은 finance/owner 승인이 필요합니다.");
    }
    const ledgerTxId = bookManualAdjustment({ userId: a.user_id, caseId, amount: a.amount, direction: a.direction });
    db.prepare("UPDATE manual_adjustments SET status='approved', approved_by=?, ledger_tx_id=?, updated_at=? WHERE case_id=?").run(approver.email, ledgerTxId, now(), caseId);
    audit(approver.email, "adjustment.approve", caseId, { ledgerTxId });
    return db.prepare("SELECT * FROM manual_adjustments WHERE case_id=?").get(caseId);
  });
}
export function rejectAdjustment(approver: AdminUser, caseId: string, reason: string) {
  db.prepare("UPDATE manual_adjustments SET status='rejected', approved_by=?, updated_at=? WHERE case_id=? AND status='requested'").run(approver.email, now(), caseId);
  audit(approver.email, "adjustment.reject", caseId, { reason });
  return db.prepare("SELECT * FROM manual_adjustments WHERE case_id=?").get(caseId);
}
export function listAdjustments() {
  return db.prepare("SELECT * FROM manual_adjustments ORDER BY created_at DESC LIMIT 100").all();
}

// ---------- 지급/대사 ----------
export function listPayouts() {
  return db.prepare("SELECT payout_id, user_id, amount, product_id, status, coupon_code, created_at FROM payout_orders ORDER BY created_at DESC LIMIT 100").all();
}
// UNKNOWN 지급 수동 해결(공급자 조회 결과 반영). resolve: paid | reversed
export function resolveUnknownPayout(actor: string, payoutId: string, resolve: "paid" | "reversed") {
  const o = db.prepare("SELECT * FROM payout_orders WHERE payout_id=?").get(payoutId) as any;
  if (!o) throw Problems.notFound("지급");
  if (o.status !== "unknown") throw Problems.conflict("UNKNOWN 상태만 해결할 수 있습니다.", o.status);
  if (resolve === "paid") {
    bookPayoutPaid({ payoutId, amount: o.amount });
    db.prepare("UPDATE payout_orders SET status='paid', updated_at=? WHERE payout_id=?").run(now(), payoutId);
  } else {
    bookPayoutReversed({ userId: o.user_id, payoutId, amount: o.amount });
    db.prepare("UPDATE payout_orders SET status='reversed', updated_at=? WHERE payout_id=?").run(now(), payoutId);
  }
  audit(actor, "payout.resolve_unknown", payoutId, { resolve });
  return db.prepare("SELECT * FROM payout_orders WHERE payout_id=?").get(payoutId);
}

// 대사 실행: 원장 균형 + 지급 vs 원장 지출 대조
export function runReconciliation(actor: string) {
  let balanced = true;
  try { assertLedgerBalanced(); } catch { balanced = false; }
  const paidSum = (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payout_orders WHERE status='paid'").get() as { s: number }).s;
  const expenseSum = accountBalance(Accounts.payoutExpense());
  const matched = balanced && paidSum === expenseSum;
  const runId = id("rec");
  db.prepare("INSERT INTO reconciliation_runs (run_id, scope, period, counts, amounts, status, created_at) VALUES (?, 'ledger', ?, ?, ?, ?, ?)").run(
    runId, new Date().toISOString().slice(0, 10),
    JSON.stringify({ paid_orders: (db.prepare("SELECT COUNT(*) c FROM payout_orders WHERE status='paid'").get() as any).c }),
    JSON.stringify({ paid_sum: paidSum, ledger_payout_expense: expenseSum }),
    matched ? "matched" : "mismatch", now()
  );
  audit(actor, "reconciliation.run", runId, { matched, paidSum, expenseSum });
  return { run_id: runId, balanced, paid_sum: paidSum, ledger_payout_expense: expenseSum, matched };
}

// ---------- 사용자/동의 ----------
export function listUsers() {
  return db.prepare("SELECT user_id, display_name, age_band, created_at FROM users ORDER BY created_at DESC LIMIT 100").all();
}
export function userDetail(userId: string) {
  const user = db.prepare("SELECT * FROM users WHERE user_id=?").get(userId);
  if (!user) throw Problems.notFound("사용자");
  return {
    user,
    consents: db.prepare("SELECT purpose, granted, policy_version, updated_at FROM consents WHERE user_id=?").all(userId),
    wallet: { available: accountBalance(Accounts.userAvailable(userId)), pending: accountBalance(Accounts.userPending(userId)) },
    rewards: db.prepare("SELECT reward_transaction_id, title, state, expected_amount, approved_amount FROM reward_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(userId),
  };
}

// ---------- 감사 로그 ----------
export function listAudit() {
  return db.prepare("SELECT actor, action, target, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200").all();
}

// ---------- 원장 뷰어 ----------
export function ledgerAccounts() {
  return db
    .prepare(
      `SELECT a.account_id, a.owner_type, a.account_type,
              COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount ELSE 0 END),0) cr,
              COALESCE(SUM(CASE WHEN e.direction='debit' THEN e.amount ELSE 0 END),0) dr
       FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.account_id
       GROUP BY a.account_id ORDER BY a.owner_type, a.account_type`
    )
    .all()
    .map((r: any) => ({ ...r, balance: r.cr - r.dr }));
}
