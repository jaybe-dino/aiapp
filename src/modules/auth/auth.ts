// 인증·계정 모듈. 게스트 로그인 + 휴대폰 OTP(스텁) + 세션 토큰 발급.
import { db } from "../../db/index.js";
import { id, now, token as randToken, sha256 } from "../../lib/id.js";
import { issueToken } from "../../lib/auth.js";
import { Problems } from "../../lib/problem.js";

interface UserRow {
  user_id: string;
  display_name: string;
  age_band: string;
  font_scale: number;
  tts_enabled: number;
  created_at: string;
}

export function getUser(userId: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
}

function createUser(displayName: string): UserRow {
  const uid = id("usr");
  const ts = now();
  db.prepare(
    "INSERT INTO users (user_id, display_name, age_band, font_scale, tts_enabled, created_at) VALUES (?, ?, '55-69', 1.2, 1, ?)"
  ).run(uid, displayName, ts);
  // 필수 동의는 기본 부여, 개인화/마케팅/제3자는 미동의 시작(명시 동의 필요)
  for (const [purpose, granted] of [
    ["service", 1],
    ["conversation_store", 1],
    ["personalized_ads", 0],
    ["marketing", 0],
    ["third_party", 0],
  ] as const) {
    db.prepare("INSERT OR IGNORE INTO consents (user_id, purpose, granted, policy_version, updated_at) VALUES (?, ?, ?, 'v1.0', ?)").run(uid, purpose, granted, ts);
  }
  return getUser(uid)!;
}

function linkIdentity(userId: string, method: string, identifier: string, verified: boolean) {
  db.prepare(
    "INSERT OR IGNORE INTO auth_identities (identity_id, user_id, method, identifier, verified, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id("idn"), userId, method, identifier, verified ? 1 : 0, now());
}

function findByIdentity(method: string, identifier: string): string | undefined {
  const r = db.prepare("SELECT user_id FROM auth_identities WHERE method = ? AND identifier = ?").get(method, identifier) as
    | { user_id: string }
    | undefined;
  return r?.user_id;
}

/** 게스트 로그인: 기기ID로 기존 계정 재사용 또는 신규 생성. */
export function guestLogin(deviceId?: string): { userId: string; token: string; displayName: string } {
  const key = deviceId || randToken(8);
  let userId = findByIdentity("guest", key);
  if (!userId) {
    const u = createUser("게스트");
    linkIdentity(u.user_id, "guest", key, true);
    userId = u.user_id;
  }
  return { userId, token: issueToken(userId), displayName: getUser(userId)!.display_name };
}

/** 휴대폰 인증 시작: OTP 생성(실 발송 대신 dev 로그). 코드 해시만 저장. */
export function phoneStart(phone: string): { challengeId: string; devCode?: string } {
  if (!/^01[0-9]{8,9}$/.test(phone.replace(/-/g, ""))) throw Problems.badRequest("휴대폰 번호 형식이 올바르지 않습니다.");
  const normalized = phone.replace(/-/g, "");
  const code = String(Math.floor(100000 + hashToInt(normalized + now()) % 900000)); // 6자리(결정형 아님)
  const challengeId = id("chl");
  db.prepare(
    "INSERT INTO phone_challenges (challenge_id, phone, code_hash, attempts, expires_at, consumed, created_at) VALUES (?, ?, ?, 0, ?, 0, ?)"
  ).run(challengeId, normalized, sha256(code), new Date(Date.now() + 5 * 60 * 1000).toISOString(), now());
  // 운영: SMS 발송. MVP: dev 에서만 코드 반환/로그.
  return { challengeId, devCode: code };
}

/** 휴대폰 인증 확인 → 계정 생성/재사용 + 토큰. */
export function phoneVerify(challengeId: string, code: string): { userId: string; token: string } {
  const c = db.prepare("SELECT * FROM phone_challenges WHERE challenge_id = ?").get(challengeId) as
    | { phone: string; code_hash: string; attempts: number; expires_at: string; consumed: number }
    | undefined;
  if (!c) throw Problems.notFound("인증 요청");
  if (c.consumed) throw Problems.conflict("이미 사용된 인증입니다.");
  if (new Date(c.expires_at).getTime() < Date.now()) throw Problems.conflict("인증 시간이 만료되었습니다.");
  if (c.attempts >= 5) throw Problems.conflict("시도 횟수를 초과했습니다.");
  db.prepare("UPDATE phone_challenges SET attempts = attempts + 1 WHERE challenge_id = ?").run(challengeId);
  if (sha256(code) !== c.code_hash) throw Problems.badRequest("인증번호가 올바르지 않습니다.");

  db.prepare("UPDATE phone_challenges SET consumed = 1 WHERE challenge_id = ?").run(challengeId);
  let userId = findByIdentity("phone", c.phone);
  if (!userId) {
    const u = createUser("회원");
    linkIdentity(u.user_id, "phone", c.phone, true);
    userId = u.user_id;
  }
  return { userId, token: issueToken(userId) };
}

function hashToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ---- 동의 ----
export function listConsents(userId: string) {
  return db.prepare("SELECT purpose, granted, policy_version, updated_at FROM consents WHERE user_id = ?").all(userId);
}
export function setConsent(userId: string, purpose: string, granted: boolean) {
  const valid = ["service", "conversation_store", "personalized_ads", "marketing", "third_party"];
  if (!valid.includes(purpose)) throw Problems.badRequest("알 수 없는 동의 항목입니다.");
  db.prepare(
    "INSERT INTO consents (user_id, purpose, granted, policy_version, updated_at) VALUES (?, ?, ?, 'v1.0', ?) ON CONFLICT(user_id, purpose) DO UPDATE SET granted = excluded.granted, updated_at = excluded.updated_at"
  ).run(userId, purpose, granted ? 1 : 0, now());
  return { purpose, granted };
}
export function hasConsent(userId: string, purpose: string): boolean {
  const r = db.prepare("SELECT granted FROM consents WHERE user_id = ? AND purpose = ?").get(userId, purpose) as
    | { granted: number }
    | undefined;
  return !!r?.granted;
}
