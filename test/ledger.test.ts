// 원장 핵심 불변조건 테스트: 균형, 멱등성, 잔액 이동, 잔액 부족 차단.
import { beforeAll, describe, it, expect } from "vitest";
import { db, applySchema } from "../src/db/index.js";
import {
  bookPendingReward,
  bookAvailable,
  bookPayoutReserve,
  bookPayoutPaid,
  userWallet,
  assertLedgerBalanced,
  Accounts,
  accountBalance,
} from "../src/modules/ledger/ledger.js";
import { Problems } from "../src/lib/problem.js";

const U = "usr_test_" + Math.floor(Math.random() * 1e6);

beforeAll(() => {
  applySchema();
});

describe("보상 원장 불변조건", () => {
  it("pending 생성 시 사용자 pending 잔액 증가, 원장은 균형", () => {
    bookPendingReward({ userId: U, conversionId: "cnv_t1", rewardAmount: 4000, commissionAmount: 9000 });
    expect(userWallet(U).pending).toBe(4000);
    assertLedgerBalanced();
  });

  it("동일 전환 재처리는 멱등 (중복 적립 없음)", () => {
    bookPendingReward({ userId: U, conversionId: "cnv_t1", rewardAmount: 4000, commissionAmount: 9000 });
    expect(userWallet(U).pending).toBe(4000); // 그대로
    assertLedgerBalanced();
  });

  it("available 이동 시 pending→available, 합계 보존", () => {
    bookAvailable({ userId: U, rewardTransactionId: "rwd_t1", amount: 4000 });
    const w = userWallet(U);
    expect(w.pending).toBe(0);
    expect(w.available).toBe(4000);
    assertLedgerBalanced();
  });

  it("잔액 부족 시 지급 예약은 409로 차단", () => {
    expect(() => bookPayoutReserve({ userId: U, payoutId: "pay_over", amount: 999999 })).toThrow();
  });

  it("지급 예약→확정 후 사용자 available 감소, 원장 균형 유지", () => {
    bookPayoutReserve({ userId: U, payoutId: "pay_t1", amount: 3000 });
    expect(userWallet(U).available).toBe(1000);
    expect(accountBalance(Accounts.payoutReserved())).toBeGreaterThanOrEqual(3000);
    bookPayoutPaid({ payoutId: "pay_t1", amount: 3000 });
    assertLedgerBalanced();
    // 사용자 available 은 이미 1000, 예약분은 expense로 확정
    expect(userWallet(U).available).toBe(1000);
  });
});
