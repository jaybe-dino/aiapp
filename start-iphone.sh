#!/usr/bin/env bash
# 혜택AI — 맥에서 아이폰 테스트 원터치 실행 스크립트.
# 백엔드 + Expo(아이폰 IP 자동 주입)를 한 번에 띄웁니다.
set -euo pipefail
cd "$(dirname "$0")"

# 1) 이 맥의 와이파이 IP 자동 감지(아이폰 실기기용)
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
echo ""
echo "=================================================="
echo "  이 맥의 IP: $IP"
echo "  (진짜 아이폰으로 테스트하려면 아이폰이 같은 와이파이여야 해요)"
echo "=================================================="
echo ""

# 2) 최초 1회 의존성 설치
[ -d node_modules ] || { echo "▶ 백엔드 패키지 설치중..."; npm install; }
[ -d mobile/node_modules ] || { echo "▶ 앱 패키지 설치중..."; (cd mobile && npm install); }

# 3) 백엔드 실행(백그라운드). 창을 닫으면 같이 종료.
npm run dev >/tmp/hyeaek-backend.log 2>&1 &
BACK=$!
trap 'echo ""; echo "종료 중..."; kill $BACK 2>/dev/null || true' EXIT
sleep 2
echo "▶ 백엔드 실행됨:  웹 http://localhost:3000  /  어드민 http://localhost:3000/admin/"
echo ""

# 4) Expo 실행(포그라운드). 아이폰용 API 주소를 자동 주입.
#    - 아이폰 실기기: 뜨는 QR을 '카메라' 앱으로 스캔
#    - 시뮬레이터:    이 창에서 i 키
cd mobile
EXPO_PUBLIC_API_URL="http://$IP:3000" npx expo start
