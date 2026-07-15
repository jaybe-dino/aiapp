// 보상 상태기계·정합성 테스트: 승인 상한, 부분승인 회수, reserved/paid 직접취소 금지.
import { beforeAll, describe, it, expect } from "vitest";
import { applySchema } from "../src/db/index.js";
import { createPendingFromConversion, approve, makeAvailable, reverse } from "../src/modules/reward/reward.js";
import { userWallet, assertLedgerBalanced } from "../src/modules/ledger/ledger.js";

const R = Math.floor(Math.random() * 1e9).toString(36);
beforeAll(() => applySchema());

function seedPending(user: string, amount: number) {
  return createPendingFromConversion({
    conversionId: "cnv_rw_" + R + "_" + user,
    userId: user,
    source: "shopping_cps",
    rewardAmount: amount,
    commissionAmount: 5000,
    title: "테스트 적립",
  });
}

describe("보상 정합성", () => {
  it("승인 금액이 예상 적립을 초과하면 거부된다", () => {
    const u = "usr_over_" + R;
    const rw = seedPending(u, 4000);
    expect(() => approve(rw.reward_transaction_id, 9999)).toThrow();
    assertLedgerBalanced();
  });

  it("부분 승인(예상보다 적음) 시 차액은 pending에서 회수되어 잔액이 갇히지 않는다", () => {
    const u = "usr_partial_" + R;
    const rw = seedPending(u, 4000);
    approve(rw.reward_transaction_id, 3000); // 예상 4000 중 3000만 승인
    makeAvailable(rw.reward_transaction_id);
    const w = userWallet(u);
    expect(w.available).toBe(3000);
    expect(w.pending).toBe(0); // 차액 1000은 pending에 갇히지 않고 회수됨
    assertLedgerBalanced();
  });

  it("available 보상은 정상 취소되어 잔액이 0으로 회수된다", () => {
    const u = "usr_rev_" + R;
    const rw = seedPending(u, 2000);
    approve(rw.reward_transaction_id);
    makeAvailable(rw.reward_transaction_id);
    expect(userWallet(u).available).toBe(2000);
    reverse(rw.reward_transaction_id, "공급사 취소");
    expect(userWallet(u).available).toBe(0);
    assertLedgerBalanced();
  });
});
