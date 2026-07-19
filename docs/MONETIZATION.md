# 수익화 연동 가이드 (샘플 → 실연동)

수익화는 **어댑터 구조**로 되어 있어, 지금은 내장 '샘플' 소스로 동작하고 나중에 실제 제휴 API를
같은 인터페이스로 구현해 갈아끼우면 된다. 제품 로직(대화·추천·원장)은 건드릴 필요가 없다.

## 구성

| 수익원 | 인터페이스 | 샘플 구현 | 실연동 대상 |
|---|---|---|---|
| 제휴 오퍼(쇼핑·여행·렌탈·미션) | `OfferSource` (`monetization/catalog.ts`) | `sampleOfferSource` (샘플 카탈로그) | LinkPrice·쿠팡파트너스·오퍼월 SDK·렌탈 제휴망 |
| 걷기 광고 재원(CPM) | `AdNetwork` (`monetization/adnetwork.ts`) | `sampleAdNetwork` (즉시 인정·예시 CPM) | AdMob rewarded 등 + **서버검증(SSV)** |
| 쿠폰 지급(출금) | `issueCoupon` (`payout/coupon.provider.ts`) | `COUPON_PROVIDER_MODE` 목업 | 기프티쇼 등 기프티콘 API |
| 전환 수신(포스트백) | `POST /v1/suppliers/:id/postbacks` | HMAC 서명 검증(이미 구현) | 공급사별 시크릿·source 화이트리스트 |

선택 스위치: `.env` 의 `MONETIZATION_MODE=sample`(기본) 또는 `live`.

## 실연동 절차(요약)

1. **오퍼 소스**: `catalog.ts` 에 `OfferSource` 를 구현한 `realOfferSource` 추가
   (제휴 API에서 상품·조건·수수료·보상을 받아 `SampleOffer` 형태로 반환). `index.ts` 의 live 분기에 연결.
   → `syncCatalog(realOfferSource)` 를 주기적으로 실행(오퍼 피드 동기화).
2. **광고 재원**: `adnetwork.ts` 에 `admobAdNetwork` 구현 — `verifyImpression` 은 광고 SDK 토큰을
   광고망 **SSV 콜백으로 검증**(재사용·위조 차단), `grossForMilestone` 은 실 eCPM 기반. `index.ts` 연결.
   → 재원 실입금 확인 전까지 보상을 pending 유지하는 옵션 권장.
3. **쿠폰**: `coupon.provider.ts` 의 `issueCoupon` 을 실제 기프티콘 API로 교체(멱등키·UNKNOWN 복구 그대로 활용).
4. **공급사 포스트백**: 공급사별 `hmac_secret` 분리, `source` 허용 매트릭스 강제(내부 전용 `cashwalk_ad` 등 차단 — 이미 적용).

핵심 불변조건은 유지된다: 답변은 광고 독립(Answer-First), 위험 카테고리·고위험 오퍼는 노출 제외,
복식부기 원장·쿠폰 Saga·이중승인 governance.

## 서비스 E2E 테스트

AI 대화 → 추천 → 클릭 → 전환 → 보상 → 걷기 → 쿠폰까지 한 번에 흘려보고 보고서를 출력한다.

```bash
npm run e2e     # ANTHROPIC_API_KEY 있으면 실제 LLM, 없으면 결정형 목업
```

출력 예: 대화 4턴(exploring/ready/사기)의 답변·추천·후속질문·안전안내 → 렌탈 전환 40,000원 →
걷기 60원 → 쿠폰 교환(paid) → 원장 균형 검증 → KPI 퍼널.
