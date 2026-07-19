// 환경설정 로더. .env 를 읽되 없으면 안전한 기본값으로 동작(키 없이 실행 가능).
import fs from "node:fs";
import path from "node:path";

function loadDotenv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
loadDotenv();

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  isProd: nodeEnv === "production",
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "app.db"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // 기본은 가장 저렴한 등급(fast=Claude Haiku 4.5). 필요 시 AI_MODEL_TIER로 상향.
  aiModelTier: (process.env.AI_MODEL_TIER ?? "fast") as "fast" | "balanced" | "reasoning",
  supplierHmacSecret: process.env.SUPPLIER_HMAC_SECRET ?? "dev-supplier-secret-change-me",
  clickSigningSecret: process.env.CLICK_SIGNING_SECRET ?? "dev-click-secret-change-me",
  couponProviderMode: (process.env.COUPON_PROVIDER_MODE ?? "success") as "success" | "fail" | "unknown",
  // 수익화 소스: sample(내장 샘플 카탈로그·광고망) | live(실제 제휴 API — 추후 연동).
  monetizationMode: (process.env.MONETIZATION_MODE ?? "sample") as "sample" | "live",
  // 세션 토큰 서명 비밀. 운영에선 반드시 환경변수로 주입.
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
  // 개인정보(리드 연락처·주소) 필드 암호화 키. 운영에선 KMS 관리.
  piiEncKey: process.env.PII_ENC_KEY ?? "dev-pii-encryption-key-change-me",
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 24 * 30), // 30일
  // 개발 편의: x-user-id 헤더 인증 폴백 허용(운영에선 자동 비활성).
  allowHeaderAuth: (process.env.ALLOW_HEADER_AUTH ?? (nodeEnv !== "production" ? "true" : "false")) === "true",
  // dev 시뮬레이션 엔드포인트 활성(운영에선 자동 비활성).
  enableDevEndpoints: (process.env.ENABLE_DEV_ENDPOINTS ?? (nodeEnv !== "production" ? "true" : "false")) === "true",
  // 쓰기 API 레이트리밋(분당 요청 수, IP+사용자 기준).
  writeRateLimitPerMin: Number(process.env.WRITE_RATE_LIMIT_PER_MIN ?? 120),
} as const;

// [보안] 운영(prod)에서 개발용 기본 비밀이 그대로 쓰이면 세션 위조·PII 복호화·포스트백 위조가
// 한 번에 열린다. dev 기본값(dev-...-change-me)이 남아 있으면 기동을 실패시켜 사고를 원천 차단.
if (config.isProd) {
  const mustSet: [string, string][] = [
    ["SESSION_SECRET", config.sessionSecret],
    ["PII_ENC_KEY", config.piiEncKey],
    ["SUPPLIER_HMAC_SECRET", config.supplierHmacSecret],
    ["CLICK_SIGNING_SECRET", config.clickSigningSecret],
  ];
  const insecure = mustSet.filter(([, v]) => v.startsWith("dev-")).map(([k]) => k);
  if (insecure.length) {
    throw new Error(
      `[보안] 운영 환경에서 다음 비밀이 개발 기본값입니다: ${insecure.join(", ")}. ` +
        `환경변수로 강한 값을 주입한 뒤 기동하세요.`
    );
  }
}
