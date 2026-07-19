// 가드레일 분류 테스트: 사기·위기·건강·금융 감지 + 광고 차단 + 안전 안내.
import { describe, it, expect } from "vitest";
import { classifyInput } from "../src/modules/ai/safety.js";

describe("가드레일", () => {
  it("사기 신호(원금 보장·수수료 먼저)는 critical로 광고를 차단하고 신고처를 안내한다", () => {
    const r = classifyInput("낯선 사람이 원금 보장하고 고수익 준다는데, 수수료 먼저 송금하래");
    expect(r.category).toBe("scam");
    expect(r.commercialAllowed).toBe(false);
    expect(r.safetyNotice?.level).toBe("critical");
    expect(r.safetyNotice?.resources?.some((x) => x.value === "112" || x.value === "1332")).toBe(true);
  });

  it("기관·가족 사칭도 사기로 분류한다", () => {
    expect(classifyInput("검찰이라며 안전계좌로 이체하래").category).toBe("scam");
    expect(classifyInput("손자가 폰 고장났다고 급하게 돈 보내달래").category).toBe("scam");
  });

  it("위기(자해) 신호는 critical로 상담 연락을 안내한다", () => {
    const r = classifyInput("요즘 너무 힘들어서 죽고 싶어");
    expect(r.category).toBe("crisis");
    expect(r.commercialAllowed).toBe(false);
    expect(r.safetyNotice?.resources?.some((x) => x.value === "1393")).toBe(true);
  });

  it("건강·금융은 warn으로 광고를 차단하되 일반 정보는 허용한다", () => {
    expect(classifyInput("당뇨에 무슨 약 먹어야 해?").category).toBe("health");
    expect(classifyInput("주식 투자 어떻게 시작해?").category).toBe("finance");
    expect(classifyInput("주식 투자 어떻게 시작해?").commercialAllowed).toBe(false);
  });

  it("일반 질문은 안전 안내 없이 광고 허용", () => {
    const r = classifyInput("부산 여행 숙소 싸게 예약하고 싶어");
    expect(r.category).toBe("none");
    expect(r.commercialAllowed).toBe(true);
    expect(r.safetyNotice).toBeNull();
  });
});
