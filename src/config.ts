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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "app.db"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  aiModelTier: (process.env.AI_MODEL_TIER ?? "balanced") as "fast" | "balanced" | "reasoning",
  supplierHmacSecret: process.env.SUPPLIER_HMAC_SECRET ?? "dev-supplier-secret-change-me",
  clickSigningSecret: process.env.CLICK_SIGNING_SECRET ?? "dev-click-secret-change-me",
  couponProviderMode: (process.env.COUPON_PROVIDER_MODE ?? "success") as "success" | "fail" | "unknown",
} as const;
