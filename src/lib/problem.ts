// RFC 7807 스타일 문제 상세 객체(기획안 17.1). 사용자 문구는 쉬운 한국어로.
export class ProblemError extends Error {
  status: number;
  code: string;
  detail?: string;
  nextAction?: { label: string; href: string };

  constructor(opts: {
    status: number;
    code: string;
    title: string;
    detail?: string;
    nextAction?: { label: string; href: string };
  }) {
    super(opts.title);
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.nextAction = opts.nextAction;
  }

  toBody(requestId: string) {
    return {
      type: `https://api.hyeaek.ai/problems/${this.code.toLowerCase().replace(/_/g, "-")}`,
      title: this.message,
      status: this.status,
      code: this.code,
      detail: this.detail,
      request_id: requestId,
      next_action: this.nextAction,
    };
  }
}

export const Problems = {
  notFound: (what: string) =>
    new ProblemError({ status: 404, code: "NOT_FOUND", title: `${what}을(를) 찾을 수 없습니다.` }),
  badRequest: (title: string, detail?: string) =>
    new ProblemError({ status: 400, code: "BAD_REQUEST", title, detail }),
  conflict: (title: string, detail?: string) =>
    new ProblemError({ status: 409, code: "CONFLICT", title, detail }),
  rewardNotAvailable: () =>
    new ProblemError({
      status: 409,
      code: "REWARD_NOT_AVAILABLE",
      title: "아직 사용할 수 없는 보상입니다.",
      detail: "광고주 확인이 진행 중입니다.",
    }),
};
