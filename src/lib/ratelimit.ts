// 간단한 인메모리 레이트리밋(고정 창). 운영에선 Redis 기반으로 대체.
import { config } from "../config.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = config.writeRateLimitPerMin): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count++;
  return { ok: true, retryAfterSec: 0 };
}

// 메모리 누수 방지: 주기적으로 만료 버킷 정리(테스트/단기 실행엔 영향 없음).
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
}, 60_000).unref?.();
