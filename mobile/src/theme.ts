// 시니어 친화 디자인 토큰(큰 글씨·높은 대비). 웹 클라이언트와 일관.
export const T = {
  bg: "#f5f6f8",
  card: "#ffffff",
  ink: "#14181f",
  muted: "#5b6472",
  brand: "#1f6feb",
  line: "#e3e6eb",
  pending: "#b26a00",
  available: "#1a7f37",
  reversed: "#b3261e",
  adBg: "#fff4e5",
  adInk: "#92400e",
  adLine: "#f7c98a",
};

export const won = (n: number) => (n ?? 0).toLocaleString("ko-KR") + "원";
