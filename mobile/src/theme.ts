// 혜택AI 디자인 토큰 — 토스 디자인 시스템(TDS) 문법 적용, 브랜드 컬러만 그린.
// 원칙: 그레이 배경 + 보더 없는 흰 카드, 8pt 간격 그리드, 잉크/세컨더리 2단 타이포.
export const T = {
  bg: "#F2F4F6", // 토스 그레이 배경
  card: "#FFFFFF",
  inset: "#F6F8FA", // 카드 내부 정보 박스(옅은 그레이)
  ink: "#191F28", // 토스 잉크(진회색 블랙)
  muted: "#6B7684", // 세컨더리 텍스트(흰 배경 대비 4.9:1, AA)
  line: "#EEF1F4", // 헤어라인(거의 안 보이게)

  brand: "#059669", // 그린(주요 버튼·활성 탭·유저 말풍선)
  brandDark: "#047857", // 텍스트용 딥 그린(AA 4.5:1↑)
  brandSoft: "#E8F5EF", // 그린 서피스

  accent: "#B45309", // 앰버(예상 보상·확인 중 강조, AA)
  accentSoft: "#FFF7EB", // 웜 카드 배경 틴트
  accentLine: "#F3E4C8", // 웜 카드 테두리(옅게)
  adLabelBg: "#8B95A1", // 광고 라벨(뉴트럴 그레이 — 명확하되 소란스럽지 않게)

  available: "#047857",
  pending: "#B45309",
  reversed: "#D22030",

  radiusCard: 20,
  radiusBtn: 16,
};

export const won = (n: number | null | undefined) => (n ?? 0).toLocaleString("ko-KR") + "원";
