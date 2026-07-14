// 쿠폰 공급자 어댑터(mock). 운영에선 기프티쇼/쿠폰사 API. 여기선 COUPON_PROVIDER_MODE로 결과를 강제해
// saga의 성공/실패/UNKNOWN 복구 경로를 시연한다.
import { config } from "../../config.js";
import { token } from "../../lib/id.js";

export interface CouponResult {
  result: "success" | "fail" | "unknown";
  couponCode?: string;
  providerRequestId?: string;
}

export async function issueCoupon(p: { providerIdempotencyKey: string; amount: number; productId: string }): Promise<CouponResult> {
  const mode = config.couponProviderMode;
  const providerRequestId = "gift_" + token(8);
  if (mode === "fail") return { result: "fail", providerRequestId };
  if (mode === "unknown") return { result: "unknown", providerRequestId }; // 타임아웃/응답유실 모사
  return { result: "success", couponCode: `CPN-${token(6).toUpperCase()}`, providerRequestId };
}
