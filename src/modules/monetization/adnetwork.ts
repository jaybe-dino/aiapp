// 걷기 광고 보상 재원 어댑터.
// 지금은 '샘플' 광고망(sampleAdNetwork)으로, 마일스톤 광고 시청을 즉시 인정하고 예시 CPM을 반환한다.
// 나중에 실제 리워드 광고(AdMob rewarded 등)로 교체할 때, 같은 AdNetwork 인터페이스로
// 서버측 검증(SSV) 콜백을 구현하면 cashwalk 로직은 그대로 동작한다.
import { REWARD_PER_MILESTONE } from "../cashwalk/constants.js";

export interface AdVerification {
  ok: boolean;
  reason?: string;
}
export interface AdNetwork {
  name: string;
  /** 광고 시청 증적 검증. 샘플은 비어있지 않은 impression id면 통과. 실제는 SSV 콜백 대조. */
  verifyImpression(adImpressionId: string, ctx: { userId: string; milestone: number }): AdVerification;
  /** 마일스톤 1회당 광고 수취액(CPM 환산). 보상보다 커야 마진이 남는다. */
  grossForMilestone(milestone: number): number;
}

export const sampleAdNetwork: AdNetwork = {
  name: "sample",
  verifyImpression(adImpressionId) {
    if (!adImpressionId) return { ok: false, reason: "no_impression" };
    return { ok: true };
  },
  grossForMilestone() {
    return REWARD_PER_MILESTONE * 2; // 예시: 보상의 2배 수취 → 절반이 플랫폼 마진
  },
};

// TODO(실연동): AdMob/오퍼월 리워드 광고.
//   verifyImpression → 광고 SDK가 준 서명 토큰을 광고망 SSV 엔드포인트로 검증(재사용·위조 차단).
//   grossForMilestone → 실제 eCPM 기반 산정. 재원 실입금 확인 전까지 pending 유지 옵션.
