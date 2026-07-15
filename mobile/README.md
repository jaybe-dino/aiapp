# 혜택AI 모바일 앱 (iOS · Android)

Expo(React Native + TypeScript) 기반. **하나의 코드베이스로 iOS와 Android 모두** 빌드됩니다.
루트의 백엔드(`../`)를 REST API로 사용합니다.

## ⚡ 가장 쉬운 테스트 — 데모 모드(백엔드 불필요)

서버를 안 띄워도 앱이 **자동으로 내장 목업**으로 동작합니다. 아이폰에서 바로 체험:

```bash
cd mobile
npm install
npx expo start        # 아이폰 카메라로 QR 스캔 → Expo Go 로 열림
```

- 서버 연결에 실패하면 상단에 **"데모 모드"** 배너가 뜨고 모든 화면이 작동합니다(실제 보상·저장 없음).
- IP 설정·와이파이·백엔드 전부 필요 없음. UX·디자인·흐름 확인용으로 최적.
- 강제로 데모로 켜려면: `EXPO_PUBLIC_DEMO=1 npx expo start`

## 실제 백엔드와 함께 실행(전체 기능)

```bash
# 1) 백엔드 먼저 실행 (루트에서)
cd .. && npm install && npm run dev      # http://localhost:3000

# 2) 모바일 앱 실행 (아이폰 실기기는 맥 IP 지정)
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<맥IP>:3000 npx expo start
```
> 맥+아이폰이면 루트의 `./start-iphone.sh` 가 백엔드+IP주입+Expo를 한 번에 실행합니다.

- `npx expo start` 후 **Expo Go** 앱으로 QR 스캔(실기기) 또는 `i`(iOS 시뮬레이터)/`a`(Android 에뮬레이터).
- 실기기에서 테스트할 땐 `app.json` 의 `extra.apiBaseUrl` 을 **PC의 LAN IP**(예: `http://192.168.0.10:3000`)로 바꾸세요. `localhost` 는 기기 자신을 가리킵니다.

## 화면 (하단 5탭)

| 탭 | 내용 |
|---|---|
| AI 도움 | 질문 → 광고와 분리된 답변 → (관련 시) 광고·제휴 카드 |
| 혜택 | 쇼핑·예약 제휴 오퍼 목록 |
| 미션 | 오퍼월(행동형) 오퍼 목록 |
| 걷기 | 만보기 연동 + 마일스톤 광고 보상 (기기 없으면 데모 버튼) |
| 내 보상 | 사용가능/확인중/사용완료 분리, 쿠폰 교환, 거래 타임라인 |

## 걸음수 연동
`expo-sensors`의 `Pedometer`로 오늘 걸음을 읽어 서버와 동기화합니다.
- iOS: CoreMotion(만보기), Android: `ACTIVITY_RECOGNITION` 권한.
- 시뮬레이터/미지원 기기에서는 "+1,000보 (데모)" 버튼으로 대체.
- 더 정밀한 HealthKit/Google Fit 연동은 로드맵(네이티브 모듈) 참고.

## 스토어 빌드 (EAS)

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build --platform android    # .aab (Google Play)
eas build --platform ios        # .ipa (App Store, Apple 계정 필요)
```

- iOS 빌드는 Apple Developer 계정, Android 빌드는 Google Play Console 등록이 필요합니다.
- `app.json` 의 `bundleIdentifier`(iOS) / `package`(Android) 를 실제 값으로 조정하세요(현재 `kr.dinostudio.hyeaek`).

## 참고
MVP 인증은 `x-user-id: usr_demo` 헤더로 단순화되어 있습니다. 운영 전환 시 로그인/토큰,
결제 강한 인증, 광고 SDK(잠금화면·리워드) 실연동, 푸시 알림을 추가하세요.
