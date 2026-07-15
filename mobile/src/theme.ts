// 혜택AI 디자인 토큰 — 따뜻하고 친근한 시니어 팔레트(예시 UX 기준).
// 크림 배경 + 딥그린 브랜드 + 테라코타 보상 강조 + 그린 체크칩.
export const T = {
  bg: "#f0eee6", // 따뜻한 크림 배경
  card: "#ffffff",
  inset: "#f5f2ec", // 카드 내부 정보 박스
  ink: "#2e2c26", // 웜 다크(거의 검정)
  muted: "#6b6459", // 웜 그레이(크림 배경 대비 4.5:1↑, WCAG AA)
  line: "#e7e3d8",

  brand: "#0E7A5F", // 딥 그린(주요 버튼·활성 탭·유저 말풍선)
  brandDark: "#0a6350",
  brandSoft: "#e3efe9", // 민트 서피스(AI칩·사용가능·체크칩)

  accent: "#c1743c", // 테라코타(예상 보상·확인 중 강조)
  accentSoft: "#faf1e6", // 오퍼 카드 배경 틴트
  accentLine: "#eddcc0", // 오퍼 카드 테두리
  adLabelBg: "#b0703e", // 광고 라벨 배경(테라코타)

  available: "#0E7A5F",
  pending: "#c1743c",
  reversed: "#b00020",

  radiusCard: 22,
  radiusBtn: 16,
};

export const won = (n: number | null | undefined) => (n ?? 0).toLocaleString("ko-KR") + "원";
