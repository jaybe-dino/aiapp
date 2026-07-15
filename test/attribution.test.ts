// 전환 귀속 보안 테스트: 걷기 광고 보상(cashwalk_ad) 사칭 차단 + 내부 경로 정상 지급.
import { beforeAll, describe, it, expect } from "vitest";
import { applySchema } from "../src/db/index.js";
import { ingestConversion } from "../src/modules/attribution/attribution.js";
import { userWallet } from "../src/modules/ledger/ledger.js";

const R = Math.floor(Math.random() * 1e9).toString(36);
const VICTIM = "usr_victim_" + R;
const LEGIT = "usr_legit_" + R;

beforeAll(() => {
  applySchema();
});

describe("전환 귀속 보안", () => {
  it("외부 포스트백이 source=cashwalk_ad로 임의 사용자에게 즉시지급 시도하면 거부된다", () => {
    const res = ingestConversion(
      {
        supplierId: "sup_walk_adnet",
        externalConversionId: "spoof_" + R,
        clickId: null,
        source: "cashwalk_ad",
        grossAmount: 200000,
        rawPayload: { user_id: VICTIM, reward_amount: 100000 },
      },
      "postback" // 외부 경로 → 사칭
    );
    expect(res.status).toBe("rejected");
    expect(res.rewardTransactionId).toBeUndefined();
    const w = userWallet(VICTIM);
    expect(w.available).toBe(0);
    expect(w.pending).toBe(0);
  });

  it("내부 경로(claimMilestone)의 cashwalk_ad는 정상적으로 즉시 사용가능 처리된다", () => {
    const res = ingestConversion(
      {
        supplierId: "sup_walk_adnet",
        externalConversionId: "legit_" + R,
        clickId: null,
        source: "cashwalk_ad",
        grossAmount: 40,
        rawPayload: { user_id: LEGIT, reward_amount: 20 },
      },
      "internal"
    );
    expect(res.status).toBe("attributed");
    expect(userWallet(LEGIT).available).toBe(20);
  });
});
