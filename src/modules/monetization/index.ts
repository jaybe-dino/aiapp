// 수익화 어댑터 선택기. MONETIZATION_MODE=sample(기본) | live 로 소스를 고른다.
// live 소스(실제 제휴 API·광고망)는 아직 미구현 → 지금은 sample 로 폴백하며 경고만.
// 실연동 시: 아래 live 분기에 realOfferSource / admobAdNetwork 등을 연결.
import { config } from "../../config.js";
import { sampleOfferSource, syncCatalog, type OfferSource } from "./catalog.js";
import { sampleAdNetwork, type AdNetwork } from "./adnetwork.js";

const live = config.monetizationMode === "live";

export const offerSource: OfferSource = live
  ? sampleOfferSource // TODO(실연동): realOfferSource(LinkPrice/쿠팡파트너스/오퍼월/렌탈 제휴망)
  : sampleOfferSource;

export const adNetwork: AdNetwork = live
  ? sampleAdNetwork // TODO(실연동): admobAdNetwork(SSV 검증)
  : sampleAdNetwork;

export { syncCatalog };
export const monetizationMode = config.monetizationMode;
