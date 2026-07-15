// 리드 개인정보 필드 암호화 왕복 + 마스킹 테스트.
import { describe, it, expect } from "vitest";
import { encryptField, decryptField, maskPhone, maskName } from "../src/lib/crypto.js";

describe("필드 암호화(AES-GCM)", () => {
  it("암호화→복호화 왕복이 원문을 복원한다", () => {
    const plain = "서울시 강남구 테헤란로 123, 4층";
    const enc = encryptField(plain);
    expect(enc).not.toContain(plain);
    expect(decryptField(enc)).toBe(plain);
  });

  it("매번 다른 암호문(IV 랜덤)이지만 같은 원문으로 복원", () => {
    const a = encryptField("01012345678");
    const b = encryptField("01012345678");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("01012345678");
    expect(decryptField(b)).toBe("01012345678");
  });

  it("변조된 암호문은 복호화 실패(무결성)", () => {
    const enc = encryptField("홍길동");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptField(tampered)).toThrow();
  });

  it("마스킹", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskName("홍길동")).toBe("홍*동");
    expect(maskName("김철")).toBe("김*");
  });
});
