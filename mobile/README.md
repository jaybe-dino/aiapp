# 혜택AI 모바일 앱 (iOS · Android)

Expo(React Native + TypeScript) 기반. **하나의 코드베이스로 iOS와 Android 모두** 빌드됩니다.
루트의 백엔드(`../`)를 REST API로 사용합니다.

## 개발 실행

```bash
# 1) 백엔드 먼저 실행 (루트에서)
cd .. && npm install && npm run dev      # http://localhost:3000

# 2) 모바일 앱 실행
cd mobile
npm install
npx expo start
```

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
