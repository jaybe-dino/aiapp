-- 혜택AI MVP 스키마
-- 설계 원칙(기획안 4장/15장): 도메인별 데이터 소유권 분리, 금액은 불변 복식부기 원장,
-- 멱등성 키 유일 제약, 전환별 경제효과 1회, 상태는 덮어써도 원인 이벤트는 보존.
-- MVP는 단일 SQLite 파일에 스키마 접두어로 도메인을 논리 분리한다(운영 전환 시 DB 분리).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =========================================================================
-- Identity & Consent (기획안 4장, 18장)
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,          -- UUIDv7 유사
  display_name   TEXT NOT NULL,
  age_band       TEXT NOT NULL DEFAULT '55-69',
  font_scale     REAL NOT NULL DEFAULT 1.2,
  tts_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

-- 목적별 동의(하나의 포괄동의 금지). purpose: service|conversation_store|personalized_ads|marketing|third_party
CREATE TABLE IF NOT EXISTS consents (
  user_id        TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  granted        INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, purpose)
);

-- =========================================================================
-- Conversation (기획안 6장) — 원문과 분석 이벤트 분리, 답변 확정 시각 보존
-- =========================================================================
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  answer_snapshot_id TEXT PRIMARY KEY,
  conversation_id    TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  question           TEXT NOT NULL,
  answer_json        TEXT NOT NULL,        -- 구조화 응답 계약(9.3)
  content_hash       TEXT NOT NULL,        -- 답변 불변성 증적
  risk_tier          TEXT NOT NULL,
  commercial_allowed INTEGER NOT NULL,     -- 안전 판정 결과(고위험이면 0)
  finalized_at       TEXT NOT NULL,        -- 이 시각 이전에는 오퍼 조회 금지(불변조건 1)
  created_at         TEXT NOT NULL
);

-- =========================================================================
-- Commercial: 오퍼 카탈로그 (기획안 11장) — 조건은 불변 스냅샷으로 보존
-- =========================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id           TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,     -- shopping_cps | offerwall_cpa | walk_ad
  reward_traffic_allowed INTEGER NOT NULL, -- 리워드 트래픽 승인 여부(11.1)
  hmac_secret           TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id        TEXT PRIMARY KEY,
  supplier_id     TEXT NOT NULL,
  category        TEXT NOT NULL,           -- travel|shopping|survey|app_install|walk ...
  title           TEXT NOT NULL,
  advertiser_name TEXT NOT NULL,
  landing_domain  TEXT NOT NULL,
  region          TEXT NOT NULL DEFAULT 'KR',
  price_band      TEXT NOT NULL DEFAULT 'mid',
  status          TEXT NOT NULL DEFAULT 'active', -- active|ineligible|stopped
  reward_eligible INTEGER NOT NULL DEFAULT 1,
  high_risk       INTEGER NOT NULL DEFAULT 0      -- 대출/투자/의약품/도박 등 고위험(자동추천 제외)
);

-- 노출·클릭이 참조하는 조건 불변 스냅샷(11.2). 조건 변경 시 새 스냅샷 추가(덮어쓰기 금지)
CREATE TABLE IF NOT EXISTS offer_versions (
  offer_snapshot_id TEXT PRIMARY KEY,
  offer_id          TEXT NOT NULL,
  total_cost        INTEGER NOT NULL,       -- 원(minor unit 없음, KRW는 정수 원)
  reward_amount     INTEGER NOT NULL,       -- 확정 시 최대 예상 보상
  commission_amount INTEGER NOT NULL,       -- 플랫폼 예상 수수료(유닛이코노믹스)
  approval_window   TEXT NOT NULL,          -- 예: "7~14일"
  cancel_terms      TEXT NOT NULL,
  auto_renewal      INTEGER NOT NULL DEFAULT 0,
  data_sharing      TEXT NOT NULL DEFAULT '없음',
  effective_at      TEXT NOT NULL
);

-- 노출/클릭 로그 (기획안 13장)
CREATE TABLE IF NOT EXISTS clicks (
  click_id          TEXT PRIMARY KEY,       -- 추측 불가능, 공급사별 서명
  user_id           TEXT NOT NULL,
  offer_id          TEXT NOT NULL,
  offer_snapshot_id TEXT NOT NULL,
  supplier_id       TEXT NOT NULL,
  answer_snapshot_id TEXT,                  -- 어떤 답변 뒤에 노출됐는지(감사)
  signature         TEXT NOT NULL,
  attribution_expires_at TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- =========================================================================
-- Attribution: 전환 (기획안 13~14장) — 공급사 원문 보존 + 유일 경제효과 키
-- =========================================================================
CREATE TABLE IF NOT EXISTS conversions (
  conversion_id          TEXT PRIMARY KEY,
  supplier_id            TEXT NOT NULL,
  external_conversion_id TEXT NOT NULL,     -- 공급사 네임스페이스와 함께 유일
  click_id               TEXT,
  user_id                TEXT,
  source                 TEXT NOT NULL,     -- shopping_cps|offerwall_cpa|cashwalk_ad
  gross_amount           INTEGER NOT NULL,  -- 공급사가 알린 확정 수익
  reward_amount          INTEGER NOT NULL,  -- 사용자에게 지급할 보상
  commission_amount      INTEGER NOT NULL,  -- 플랫폼 마진
  fraud_score            REAL NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL,     -- received|attributed|review|rejected
  raw_payload            TEXT NOT NULL,
  received_at            TEXT NOT NULL,
  UNIQUE (supplier_id, external_conversion_id)   -- 동일 공급사 동일 전환 1회(불변조건 5)
);

-- =========================================================================
-- Reward Ledger (기획안 15장) — 복식부기 불변 원장
-- =========================================================================
CREATE TABLE IF NOT EXISTS ledger_accounts (
  account_id   TEXT PRIMARY KEY,           -- 예: platform:reward_expense, user:{id}:available
  owner_type   TEXT NOT NULL,              -- platform | user
  owner_id     TEXT,
  currency     TEXT NOT NULL DEFAULT 'KRW',
  account_type TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, currency, account_type)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  ledger_tx_id    TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,           -- pending_created|available|reversed|payout_reserved|paid|payout_reversed
  reference_type  TEXT NOT NULL,           -- conversion|payout|reward
  reference_id    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,     -- 재시도 중복 방지(불변조건, 15.4)
  currency        TEXT NOT NULL DEFAULT 'KRW',
  trace_id        TEXT,
  effective_at    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id     TEXT PRIMARY KEY,
  ledger_tx_id TEXT NOT NULL REFERENCES ledger_transactions(ledger_tx_id),
  account_id   TEXT NOT NULL REFERENCES ledger_accounts(account_id),
  direction    TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount       INTEGER NOT NULL CHECK (amount > 0),   -- 항상 양수, 방향으로 부호 표현
  currency     TEXT NOT NULL DEFAULT 'KRW'
);
CREATE INDEX IF NOT EXISTS idx_entries_account ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_entries_tx ON ledger_entries(ledger_tx_id);

-- 사용자 보상 거래 상태 기계(15.2)
CREATE TABLE IF NOT EXISTS reward_transactions (
  reward_transaction_id TEXT PRIMARY KEY,
  conversion_id         TEXT UNIQUE,        -- 전환별 경제효과 1회
  user_id               TEXT NOT NULL,
  source                TEXT NOT NULL,
  state                 TEXT NOT NULL,      -- pending|approved|available|reserved|paid|reversed
  expected_amount       INTEGER NOT NULL,
  approved_amount       INTEGER,
  currency              TEXT NOT NULL DEFAULT 'KRW',
  title                 TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_state_events (
  id                    TEXT PRIMARY KEY,
  reward_transaction_id TEXT NOT NULL,
  from_state            TEXT,
  to_state              TEXT NOT NULL,
  reason                TEXT NOT NULL,
  source_event_id       TEXT,
  created_at            TEXT NOT NULL
);

-- =========================================================================
-- Payout: 쿠폰 지급 Saga (기획안 15.5)
-- =========================================================================
CREATE TABLE IF NOT EXISTS payout_orders (
  payout_id       TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'KRW',
  product_id      TEXT NOT NULL,            -- 쿠폰 상품
  status          TEXT NOT NULL,            -- reserved|paid|reversed|unknown
  coupon_code     TEXT,                     -- 성공 시 발급된 쿠폰(운영에선 암호화 저장)
  idempotency_key TEXT NOT NULL UNIQUE,     -- 사용자 요청 키 유일
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_attempts (
  id                  TEXT PRIMARY KEY,
  payout_id           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  request_hash        TEXT NOT NULL,
  provider_request_id TEXT,
  result              TEXT NOT NULL,        -- success|fail|unknown
  created_at          TEXT NOT NULL
);

-- =========================================================================
-- Cashwalk: 걷기 리워드 (기획안에 없던 신규 도메인)
-- 원칙 준수: 걸음 '자체'에 현금 지급 X. 걸음 마일스톤에서 '광고 시청'을 해야 보상 발생.
-- =========================================================================
CREATE TABLE IF NOT EXISTS cashwalk_days (
  user_id       TEXT NOT NULL,
  day_key       TEXT NOT NULL,             -- YYYY-MM-DD (기기 로컬 기준)
  steps         INTEGER NOT NULL DEFAULT 0,
  integrity_ok  INTEGER NOT NULL DEFAULT 1, -- 루팅/에뮬레이터/센서조작 등 무결성
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, day_key)
);

-- 마일스톤별 광고보상 청구(멱등). 같은 (user,day,milestone)은 1회만 보상.
CREATE TABLE IF NOT EXISTS cashwalk_claims (
  claim_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  day_key      TEXT NOT NULL,
  milestone    INTEGER NOT NULL,           -- 몇 번째 마일스톤(예: 1000보 단위)
  ad_impression_id TEXT NOT NULL,          -- 잠금화면/리워드 광고 시청 증적
  reward_amount INTEGER NOT NULL,
  conversion_id TEXT NOT NULL,             -- 원장 연결용으로 생성한 전환
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, day_key, milestone)
);

-- =========================================================================
-- 멱등성 저장(쓰기 API 공통, 17.1) — 같은 키 다른 body면 409
-- =========================================================================
CREATE TABLE IF NOT EXISTS idempotency_records (
  scope        TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- =========================================================================
-- Audit (기획안 20장) — 운영 행위/감사(변경 불가 성격)
-- =========================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  trace_id   TEXT,
  created_at TEXT NOT NULL
);

-- =========================================================================
-- Admin & Governance (기획안 20장) — 운영자 계정·이중 승인
-- =========================================================================
CREATE TABLE IF NOT EXISTS admin_users (
  admin_id   TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,              -- ops | reviewer | finance | owner
  token      TEXT NOT NULL,              -- MVP 인증 토큰(운영에선 SSO/MFA)
  created_at TEXT NOT NULL
);

-- 금액 직접수정 금지 → 요청/승인 분리(이중 승인). requester != approver 강제.
CREATE TABLE IF NOT EXISTS manual_adjustments (
  case_id      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  amount       INTEGER NOT NULL,         -- 양수
  direction    TEXT NOT NULL,            -- credit(사용자 지급) | debit(회수)
  reason       TEXT NOT NULL,            -- 내부 감사 사유
  user_message TEXT,                     -- 사용자 표시 설명
  status       TEXT NOT NULL,            -- requested | approved | rejected
  requested_by TEXT NOT NULL,
  approved_by  TEXT,
  ledger_tx_id TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 대사(공급사 리포트/쿠폰 발급 vs 원장). 재실행 가능.
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  run_id     TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,              -- supplier | coupon | ledger
  period     TEXT NOT NULL,
  counts     TEXT NOT NULL,              -- JSON 요약
  amounts    TEXT NOT NULL,              -- JSON 요약
  status     TEXT NOT NULL,              -- matched | mismatch
  created_at TEXT NOT NULL
);
