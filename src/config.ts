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
  aiModelTier: (process.env.AI_MODEL_TIER ?? "balanced") as "fast" | "balanced" | "reasoning",
  supplierHmacSecret: process.env.SUPPLIER_HMAC_SECRET ?? "dev-supplier-secret-change-me",
  clickSigningSecret: process.env.CLICK_SIGNING_SECRET ?? "dev-click-secret-change-me",
  couponProviderMode: (process.env.COUPON_PROVIDER_MODE ?? "success") as "success" | "fail" | "unknown",
  // 세션 토큰 서명 비밀. 운영에선 반드시 환경변수로 주입.
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 24 * 30), // 30일
  // 개발 편의: x-user-id 헤더 인증 폴백 허용(운영에선 자동 비활성).
  allowHeaderAuth: (process.env.ALLOW_HEADER_AUTH ?? (nodeEnv !== "production" ? "true" : "false")) === "true",
  // dev 시뮬레이션 엔드포인트 활성(운영에선 자동 비활성).
  enableDevEndpoints: (process.env.ENABLE_DEV_ENDPOINTS ?? (nodeEnv !== "production" ? "true" : "false")) === "true",
  // 쓰기 API 레이트리밋(분당 요청 수, IP+사용자 기준).
  writeRateLimitPerMin: Number(process.env.WRITE_RATE_LIMIT_PER_MIN ?? 120),
} as const;
