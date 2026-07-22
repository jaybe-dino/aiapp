# 수익화 연동 가이드 (샘플 → 실연동)

수익화는 **어댑터 구조**로 되어 있어, 지금은 내장 '샘플' 소스로 동작하고 나중에 실제 제휴 API를
같은 인터페이스로 구현해 갈아끼우면 된다. 제품 로직(대화·추천·원장)은 건드릴 필요가 없다.

## 구성

| 수익원 | 인터페이스 | 샘플 구현 | 실연동 대상 |
|---|---|---|---|
| 제휴 오퍼(쇼핑·여행·렌탈·미션) | `OfferSource` (`monetization/catalog.ts`) | `sampleOfferSource` (샘플 카탈로그) | LinkPrice·쿠팡파트너스·오퍼월 SDK·렌탈 제휴망 |
| 걷기 광고 재원(CPM) | `AdNetwork` (`monetization/adnetwork.ts`) | `sampleAdNetwork` (즉시 인정·예시 CPM) | AdMob rewarded 등 + **서버검증(SSV)** |
| 대화 연장 광고(리워드) | `AdNetwork` + `ai/chatgate.ts` (`chat_ad`) | `sampleAdNetwork` (즉시 인정) | AdMob/AppLovin **리워드 광고 + SSV** |
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

## 대화 연장 광고 게이트 (핵심 수익화 루프)

일상 대화가 본체이고, **무료 대화 N회 소진 후에는 리워드 광고를 봐야 대화를 이어갈 수 있다**
(광고 시청 = 포인트 적립). 걷기 보상과 동일한 자체 광고망 전환 경로(`chat_ad`)를 재사용한다.

- 설정(`.env`): `FREE_CHATS_PER_DAY`(기본 5) · `CHAT_AD_UNLOCK_COUNT`(광고 1회당 개방 수, 기본 5) · `CHAT_AD_REWARD`(동반 지급 포인트, 기본 20)
- 상태/개방 API: `GET /v1/chat/status`, `POST /v1/chat/ad`(body: `ad_impression_id`)
- 게이트 위치: `orchestrator.handleTurn` 진입부. **위기·사기(critical) 대화는 절대 게이팅하지 않는다**(안전 우선).
- 보상 지급: `chatgate.watchChatAd` → `ingestConversion(source:"chat_ad", origin:"internal")` → 즉시 `available`.

### 리워드 광고 SDK 실연동 지점 (클라이언트 → 서버)

| 단계 | 지금(샘플) | 실연동 |
|---|---|---|
| ① 클라이언트 광고 재생 | 앱: 1.4초 대기로 대체(`AIScreen.watchAdAndContinue` / 웹 `gateCard`) | AdMob/AppLovin **Rewarded Ad** 표시, `onUserEarnedReward` 콜백 대기 |
| ② 시청 증적 전달 | `POST /v1/chat/ad`(빈 body 또는 임의 impression id) | 광고 SDK가 준 **SSV 토큰/트랜잭션 id**를 `ad_impression_id`로 전달 |
| ③ 서버 검증 | `sampleAdNetwork.verifyImpression`(존재만 확인) | `admobAdNetwork.verifyImpression`: 광고망 **SSV 콜백으로 재사용·위조 검증** |
| ④ 재원/보상 | 예시 CPM 즉시 인정 | 실 eCPM 반영, 재원 실입금 확인 전 pending 유지 옵션 |

즉, 클라이언트는 `watchAdAndContinue`의 `setTimeout(1400)` 자리를 리워드 광고 SDK 호출로,
서버는 `sampleAdNetwork`를 `admobAdNetwork`로 교체하면 된다. **게이트·원장·대화 로직은 그대로.**

## 서비스 E2E 테스트

AI 대화 → 추천 → 클릭 → 전환 → 보상 → 걷기 → 쿠폰까지 한 번에 흘려보고 보고서를 출력한다.

```bash
npm run e2e     # ANTHROPIC_API_KEY 있으면 실제 LLM, 없으면 결정형 목업
```

출력 예: 대화 4턴(exploring/ready/사기)의 답변·추천·후속질문·안전안내 → 렌탈 전환 40,000원 →
걷기 60원 → 쿠폰 교환(paid) → 원장 균형 검증 → KPI 퍼널.
