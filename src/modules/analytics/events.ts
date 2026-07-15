// 행동 이벤트 로깅(KPI 퍼널). 재무 원장과 분리된 append-only 분석 로그.
// 실패해도 본 요청을 막지 않는다(계측은 부가기능).
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";

export function logEvent(name: string, userId: string | null, props?: Record<string, unknown>): void {
  try {
    db.prepare("INSERT INTO events (event_id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id("evt"),
      userId,
      name,
      props ? JSON.stringify(props) : null,
      now()
    );
  } catch {
    /* 계측 실패는 무시 */
  }
}

/** 간단 퍼널 요약(어드민/파일럿 관측용). */
export function funnelSummary(sinceIso?: string): { name: string; count: number }[] {
  const since = sinceIso ?? "1970-01-01";
  return db
    .prepare("SELECT name, COUNT(*) AS count FROM events WHERE created_at >= ? GROUP BY name ORDER BY count DESC")
    .all(since) as { name: string; count: number }[];
}
