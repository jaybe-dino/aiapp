# 혜택AI (hyeaek-ai)

쇼핑(CPS) · 오퍼월(CPA) · **캐시워크(걷기 리워드)** · **렌탈(정수기·비데·공기청정기 구독형 CPA)** · AI 광고추천을 **하나의 투명 보상 원장**으로 묶은 리워드 AI 앱.

> UI는 시니어 친화 **따뜻한 크림+딥그린 디자인**(음성 우선 큰 버튼, 라운드 카드). 렌탈은 정기결제 특성상 **월 요금·약정·의무기간·자동결제 경고**를 강조해 노출합니다.

**구성**
| 부분 | 위치 | 설명 |
|---|---|---|
| 백엔드 | `src/` | 모듈러 모놀리스 API + 불변 원장 (Node·Fastify·SQLite) |
| 사용자 웹 | `src/web/` → `http://localhost:3000/` | 시니어 친화 웹 클라이언트(데모용) |
| **운영자 콘솔** | `src/web-admin/` → `http://localhost:3000/admin/` | 오퍼·전환·지급·이중승인 조정·감사 |
| **모바일 앱** | `mobile/` | **iOS · Android** (Expo/React Native, 실제 배포 대상) |


두 기획 자료(`시스템 개발 기획안`, `UX 서비스 기획안`)를 바탕으로,
- 자료의 3대 자산(**Answer-First 광고독립성** · **불변 복식부기 원장** · **목적별 동의**)은 그대로 구현하고
- 자료에 **없던 캐시워크(걷기) 도메인**을 원칙(“무보상 행위에 현금 지급 금지”)과 정합하게 새로 설계해 추가했습니다.

> 개선 진단·설계 보강 문서는 [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) 참고.

## 빠른 실행 (키 없이 동작)

```bash
npm install
npm run dev          # http://localhost:3000
```

- `ANTHROPIC_API_KEY` 가 **없어도** 결정형 mock 답변으로 전체 흐름이 동작합니다.
- 실제 Claude를 붙이려면 `.env.example` → `.env` 복사 후 키를 채우세요(최신 Claude 모델 사용).

```bash
npm test             # 원장 불변조건 테스트
npm run typecheck    # 타입 체크
npm run reset        # DB 초기화 후 재시드
```

## 운영자 콘솔 (`/admin`)

기획안 20장(운영자 콘솔·거버넌스) 구현. `http://localhost:3000/admin/` 접속 후 토큰으로 로그인.

| 운영자 | 토큰 | 권한 |
|---|---|---|
| 대표(owner) | `admin-owner-token` | 전체 |
| 운영(ops) | `admin-ops-token` | 오퍼·공급사·전환 |
| 검수(reviewer) | `admin-review-token` | 오퍼·전환 |
| 재무(finance) | `admin-finance-token` | 지급·대사·고액조정 |

기능: 대시보드(수익·보상·**공헌이익**·원장균형 KPI), 오퍼 관리(필수필드 게이트), 공급사 리워드 승인,
전환 대사(review 큐), **이중 승인 보상조정**(요청자≠승인자, 5만원+ finance/owner), 지급 대사(UNKNOWN 해결),
사용자·동의, 원장 뷰어, 감사 로그.

## 모바일 앱 (iOS · Android) — `mobile/`

Expo/React Native. **하나의 코드베이스로 두 플랫폼** 빌드. 자세한 실행·스토어 빌드는 [`mobile/README.md`](mobile/README.md).

```bash
cd mobile && npm install && npx expo start   # Expo Go(QR) 또는 i/a 시뮬레이터
```

걷기 탭은 `expo-sensors` Pedometer로 실기기 만보기를 연동합니다(시뮬레이터는 데모 버튼).

## 화면 (시니어 친화 웹 클라이언트)

하단 5개 탭 — **AI 도움 · 혜택(쇼핑) · 미션(오퍼월) · 걷기 · 내 보상**

돈 버는 루프 전체를 브라우저에서 시연할 수 있습니다:
1. **AI 도움**: 질문 → 광고와 분리된 답변 → (관련 시) 광고·제휴 카드 1개
2. 카드에서 **제휴처 이동**(비식별 클릭 ID 생성) → 데모 전환 시뮬레이션 → “확인 중” 보상
3. **걷기**: +1,000보 → 마일스톤 열림 → **광고 보고 받기** → 즉시 “사용 가능” 보상
4. **내 보상**: 사용 가능/확인 중/사용 완료 **분리 표시** → 쿠폰 교환(지급 Saga)

## 아키텍처 (모듈러 모놀리스 + 격리된 핵심)

```
src/
  modules/
    ai/           Answer-First 오케스트레이터 · Model Gateway(Claude/mock) · 안전엔진
    commercial/   오퍼 카탈로그(쇼핑/오퍼월) · 제한 의도문맥 · 서명 클릭  ← 대화 원문 접근 불가
    attribution/  postback→전환 귀속 · 규칙기반 사기점수
    reward/       보상 거래 상태기계 (pending→approved→available→paid / reversed)
    ledger/       ★ 복식부기 불변 원장 (균형·멱등·잔액 projection)
    payout/       쿠폰 지급 Saga (성공/실패/UNKNOWN 복구)
    cashwalk/     ★ 걷기 리워드 (마일스톤 + 광고시청 + 어뷰징 방지) — 신규 도메인
  db/             schema.sql · 연결 · 시드
  web/            바닐라 JS 클라이언트
```

### 지켜지는 핵심 불변조건 (자료 1.3)
- **Answer First**: `orchestrator.ts`가 답변을 먼저 확정(`finalized_at`)한 뒤에만 커머셜 호출. 커머셜 모듈은 대화 원문을 받지 않고 제한된 `IntentContext`만 받음.
- **No Ad Is Valid**: 적합 후보 없으면 `commercial: null` 정상 응답.
- **Money Is a Ledger**: 잔액 컬럼 없음. 모든 금액은 균형 분개로만 생성, 잔액은 분개 합으로 계산.
- **Idempotency Everywhere**: 클릭/전환/원장/쿠폰/걷기청구에 멱등 키·유일 제약.
- **전환별 경제효과 1회**: `conversions(supplier, external_conversion_id)` 유일, `reward_transactions.conversion_id` 유일.
- **고위험 광고 차단**: 대출/투자/의약품/도박 의도 → `commercial_allowed=false`.

## 주요 API (기획안 17장 준거)

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/v1/conversations` | 대화 생성 |
| POST | `/v1/conversations/:id/messages` | 질문 → Answer-First 답변+커머셜 |
| GET | `/v1/offers?type=shopping\|mission` | 혜택/미션 목록 |
| POST | `/v1/offers/:snapshotId/clicks` | 외부 이동 서명 클릭 (Idempotency-Key) |
| POST | `/v1/suppliers/:supplier/postbacks` | 공급사 전환 수신 |
| GET | `/v1/wallet` | 사용가능/확인중/사용완료 |
| GET | `/v1/rewards`, `/v1/rewards/:id` | 보상 목록·타임라인 |
| POST | `/v1/payouts` | 쿠폰 교환 (Idempotency-Key) |
| GET | `/v1/cashwalk` · POST `/v1/cashwalk/steps` · POST `/v1/cashwalk/claims` | 걷기 |
| POST | `/v1/admin/rewards/:id/approve\|reverse` | (데모) 전환 승인/취소 |
| GET | `/v1/admin/ledger/check` | 원장 균형 자가검증(대사) |

## MVP에서 의도적으로 단순화한 것
실 인증(x-user-id 헤더로 대체), RAG 인용, SSE 스트리밍, mTLS/HMAC 강제, 관리자 콘솔 UI, 큐/Outbox(동기 처리로 대체), 다국어. 구조는 유지해 후속 확장이 쉽도록 했습니다. 자세한 로드맵은 `docs/GAP_ANALYSIS.md` 참고.
