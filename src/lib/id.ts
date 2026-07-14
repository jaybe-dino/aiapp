import crypto from "node:crypto";

// UUIDv7 유사: 앞 48비트에 밀리초 타임스탬프를 넣어 시간 정렬성을 갖되 추측은 어렵게.
export function uuidv7(): string {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, "0");
  const rand = crypto.randomBytes(10).toString("hex");
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${rand.slice(0, 3)}-${rand.slice(3, 7)}-${rand.slice(7, 19)}`;
}

/** 접두어가 붙은 도메인 식별자. 예: id("cnv") -> cnv_01890a... */
export function id(prefix: string): string {
  return `${prefix}_${uuidv7().replace(/-/g, "").slice(0, 24)}`;
}

/** 추측 불가능한 토큰(click_id, 쿠폰 등). */
export function token(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmac(secret: string, input: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

export function now(): string {
  return new Date().toISOString();
}
