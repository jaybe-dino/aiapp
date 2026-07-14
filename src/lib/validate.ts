// 경량 입력 검증 헬퍼. 실패 시 400 ProblemError.
import { Problems } from "./problem.js";

export function str(v: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof v !== "string") throw Problems.badRequest(`${field}이(가) 필요합니다.`);
  const s = v.trim();
  if (opts.min != null && s.length < opts.min) throw Problems.badRequest(`${field}이(가) 너무 짧습니다.`);
  if (opts.max != null && s.length > opts.max) throw Problems.badRequest(`${field}이(가) 너무 깁니다.`, `최대 ${opts.max}자`);
  return s;
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw Problems.badRequest(`${field}은(는) 정수여야 합니다.`);
  if (opts.min != null && n < opts.min) throw Problems.badRequest(`${field} 값이 너무 작습니다.`);
  if (opts.max != null && n > opts.max) throw Problems.badRequest(`${field} 값이 너무 큽니다.`);
  return n;
}
