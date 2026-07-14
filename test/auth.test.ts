// 세션 토큰 서명/검증 + 만료 + 위변조 방어 테스트.
import { describe, it, expect } from "vitest";
import { issueToken, verifyToken } from "../src/lib/auth.js";

describe("세션 토큰", () => {
  it("발급한 토큰은 검증되고 uid를 복원한다", () => {
    const t = issueToken("usr_abc");
    expect(verifyToken(t)).toEqual({ uid: "usr_abc" });
  });

  it("서명이 변조되면 거부한다", () => {
    const t = issueToken("usr_abc");
    const tampered = t.slice(0, -3) + "xyz";
    expect(verifyToken(tampered)).toBeNull();
  });

  it("payload(uid)를 바꾸면 서명 불일치로 거부한다", () => {
    const t = issueToken("usr_abc");
    const [, sig] = t.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ uid: "usr_evil", iat: 0, exp: 9999999999 })).toString("base64url");
    expect(verifyToken(`${forgedBody}.${sig}`)).toBeNull();
  });

  it("만료된 토큰은 거부한다", () => {
    const t = issueToken("usr_abc", -1); // 이미 만료
    expect(verifyToken(t)).toBeNull();
  });

  it("빈/형식오류 토큰은 null", () => {
    expect(verifyToken(undefined)).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("nodot")).toBeNull();
  });
});
