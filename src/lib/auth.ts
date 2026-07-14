// 세션 토큰 — 외부 라이브러리 없이 HMAC 서명 방식(JWT 유사).
// payload(base64url).signature 형식. 위변조·만료를 서버가 검증한다.
import crypto from "node:crypto";
import { config } from "../config.js";

interface TokenPayload {
  uid: string;
  iat: number; // 발급(sec)
  exp: number; // 만료(sec)
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function sign(data: string): string {
  return crypto.createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
}

export function issueToken(uid: string, ttlSec = config.sessionTtlSec): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { uid, iat: now, exp: now + ttlSec };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined): { uid: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  // 서명 검증(타이밍 세이프)
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (!payload.uid || typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null; // 만료
    return { uid: payload.uid };
  } catch {
    return null;
  }
}
