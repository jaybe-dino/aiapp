// 민감 필드(연락처·주소 등) 저장용 암호화 — AES-256-GCM.
// 운영에선 키를 KMS로 관리. MVP는 config.piiEncKey 에서 파생.
import crypto from "node:crypto";
import { config } from "../config.js";

const KEY = crypto.createHash("sha256").update(config.piiEncKey).digest(); // 32바이트

/** 평문 → "iv:tag:cipher"(base64url) 저장 문자열. */
export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/** 저장 문자열 → 평문. 형식/무결성 오류 시 예외. */
export function decryptField(stored: string): string {
  const [ivB, tagB, dataB] = stored.split(":");
  if (!ivB || !tagB || !dataB) throw new Error("암호문 형식 오류");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64url")), decipher.final()]).toString("utf8");
}

/** 화면 표시용 마스킹(복호화 없이 저장 원문에서 만들 순 없으므로 평문 입력). */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "***";
  return d.slice(0, 3) + "-****-" + d.slice(-4);
}
export function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + "*";
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}
