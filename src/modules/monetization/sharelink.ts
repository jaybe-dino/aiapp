// 토스쇼핑 쉐어링크(ShareLink) 어댑터 — 쇼핑 CPS의 실연동 지점.
// 비즈니스 모델(공식 문서 기준): 공유링크 클릭 후 24시간 내 토스쇼핑에서 결제하면
// 결제 금액의 10%가 수익으로 집계된다. 우리는 그 수익의 일부를 사용자 포인트로 환원한다.
//   sample 모드: 목업 링크 생성(전체 흐름 체험용)
//   live 모드: 쉐어링크 Open API(https://sharelink-docs.toss.im/guide/open-api)로 교체
//              — 링크 생성 API 호출부(buildShareLink)와 정산 웹훅 수신부만 갈아끼우면
//              클릭·귀속·원장·보상 흐름은 그대로 동작한다.
import { config } from "../../config.js";

export interface ShareLinkAdapter {
  name: string;
  /** 상품 공유링크 생성. live에선 Open API 호출(생성된 단축링크 반환). */
  buildShareLink(p: { offerId: string; clickId: string; landingDomain: string }): string;
  /** 귀속 창(클릭 후 결제 인정 시간, 시간 단위). 쉐어링크 정책 = 24시간. */
  attributionWindowHours: number;
  /** 결제액 대비 수익율(쉐어링크 정책 = 10%). */
  revenueRate: number;
}

/** 샘플 쉐어링크 — 실제 API 없이 동일한 모양의 링크·정책으로 동작. */
export const sampleShareLink: ShareLinkAdapter = {
  name: "sample-sharelink",
  attributionWindowHours: 24,
  revenueRate: 0.1,
  buildShareLink({ offerId, clickId, landingDomain }) {
    // live: POST /open-api/links { productId } → { shareUrl } 형태로 교체(API 키 필요)
    return `https://${landingDomain}/share/${offerId}?click_id=${clickId}`;
  },
};

// live 전환 시: MONETIZATION_MODE=live + SHARELINK_API_KEY 로 실제 구현을 여기서 분기.
export const shareLink: ShareLinkAdapter = sampleShareLink;

/** 사용자 적립 표시용 — 결제액 기준 예상 적립(수익 10%의 절반을 사용자 환원 기본값). */
export function estimatedUserReward(price: number): number {
  return Math.floor((price * shareLink.revenueRate) / 2 / 10) * 10; // 10원 단위 절사
}
