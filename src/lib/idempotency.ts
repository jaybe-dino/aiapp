import { db } from "../db/index.js";
import { sha256, now } from "./id.js";
import { Problems } from "./problem.js";

/**
 * 쓰기 API 공통 멱등성(기획안 17.1).
 * - 같은 (scope,key) + 같은 body 이면 저장된 응답을 그대로 반환한다.
 * - 같은 key + 다른 body 이면 409 CONFLICT.
 * - 처음이면 fn()을 실행하고 결과를 저장한 뒤 반환한다.
 */
export function withIdempotency<T>(scope: string, key: string, requestBody: unknown, fn: () => T): T {
  const requestHash = sha256(JSON.stringify(requestBody ?? {}));
  const existing = db
    .prepare("SELECT request_hash, response_json FROM idempotency_records WHERE scope = ? AND key = ?")
    .get(scope, key) as { request_hash: string; response_json: string } | undefined;

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw Problems.conflict("같은 요청 키로 다른 내용이 접수되었습니다.", "Idempotency-Key 재사용 규칙 위반");
    }
    return JSON.parse(existing.response_json) as T;
  }

  const result = fn();
  db.prepare(
    "INSERT INTO idempotency_records (scope, key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(scope, key, requestHash, JSON.stringify(result ?? null), now());
  return result;
}
