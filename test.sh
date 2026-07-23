#!/usr/bin/env bash
# 혜택AI — 한 번에 테스트 실행.
#   ./test.sh          → 서버 켜고 브라우저에서 바로 대화·수익화 테스트
#   ./test.sh e2e      → 전체 루프를 터미널에서 자동 시연(서버 불필요)
set -e
cd "$(dirname "$0")"

if [ "$1" = "e2e" ]; then
  echo "▶ 전체 루프 자동 시연(대화→추천→전환→보상→걷기→쿠폰)…"
  npm run e2e
  exit 0
fi

# 1) 준비
[ -d node_modules ] || npm install
[ -f .env ] || { cp .env.example .env; echo "ℹ️  .env 를 새로 만들었어요."; }

# 2) 실제 Claude 대화 여부 안내(키 없으면 예시 답변으로도 전 기능 동작)
if grep -q "^ANTHROPIC_API_KEY=sk-ant" .env; then
  echo "✅ 실제 Claude 대화가 켜집니다."
else
  echo "⚠️  ANTHROPIC_API_KEY 가 비어 있어요 → '예시 답변'으로 동작(대화 외 모든 기능은 정상)."
  echo "   실제 대화를 원하면 .env 의 ANTHROPIC_API_KEY 에 sk-ant- 키를 넣고 다시 실행하세요."
fi

# 3) 데이터 시드 + 서버 실행
npm run seed >/dev/null 2>&1 || true
echo ""
echo "────────────────────────────────────────────"
echo "  👉 브라우저에서 열기:  http://localhost:3000"
echo "     운영자 콘솔:        http://localhost:3000/admin/"
echo ""
echo "  테스트 순서 추천:"
echo "   1) AI 도움 탭에서 '전기요금 아끼는 법' 질문 → 진짜 답변 확인"
echo "   2) '정수기 렌탈 추천해줘' → 관련 혜택 카드가 뜨는지"
echo "   3) 무료 대화 5회 소진 → '광고 보고 이어가기(+20P)' 카드 → 시청 후 계속"
echo "   4) 내 보상 탭에서 적립·쿠폰 교환 확인"
echo "   (게이트를 빨리 보려면 .env 의 FREE_CHATS_PER_DAY=2 로)"
echo "────────────────────────────────────────────"
echo ""
exec npm start
