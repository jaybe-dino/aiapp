# 외부에서 테스트하기 (공개 URL)

폰·PC 어디서든 접속해 테스트하는 방법. 두 가지 중 편한 쪽을 고르세요.

---

## 방법 A — Render 배포 (권장 · 항상 켜진 공개 URL)

내 컴퓨터를 켜둘 필요 없이, 인터넷 주소로 언제든 접속됩니다.

1. https://render.com 가입(무료) — GitHub 계정으로 로그인하면 편함
2. 대시보드 → **New +** → **Blueprint**
3. 이 저장소(`jaybe-dino/aiapp`)와 브랜치 `claude/ai-earning-app-korea-7t8ndo` 선택 → **Apply**
   - 루트의 `render.yaml` 을 읽어 자동 구성됩니다(보안 키는 자동 생성).
4. 배포 후 서비스 → **Environment** 에서 `ANTHROPIC_API_KEY` 에 본인 `sk-ant-` 키 입력 → 저장
   - (키를 안 넣으면 '예시 답변'으로 동작. 대화 외 모든 기능은 정상)
5. 상단의 공개 URL(예: `https://hyeaek-ai.onrender.com`) 을 폰·PC 브라우저에서 열기 🎉
   - 운영자 콘솔: `.../admin/`

> 참고(무료 플랜): 15분 미사용 시 잠들었다가 다음 접속 때 **첫 로딩만 30~50초** 걸립니다.
> 데이터(SQLite)는 재배포 때 초기화되며 첫 기동 시 데모 데이터가 자동 시드됩니다.
> 광고 게이트를 빨리 보려면 Environment 에서 `FREE_CHATS_PER_DAY=2` 로 낮추세요.

---

## 방법 B — 내 Mac에서 실행 + 임시 터널 (빠름 · 컴퓨터 켜둔 동안만)

이미 로컬에서 돌아가면(`./test.sh` → `http://localhost:3000`), 별도 터미널에서 터널만 열면
공개 주소가 생깁니다.

**cloudflared (계정 불필요, 가장 깔끔):**
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
# 출력되는 https://....trycloudflare.com 주소를 폰에서 열기
```

**또는 ngrok:**
```bash
brew install ngrok           # 최초 1회 ngrok 계정 authtoken 설정 필요
ngrok http 3000
```

> 터널 주소는 내 Mac이 켜져 있고 서버가 떠 있는 동안만 유효합니다.
> 항상 켜진 주소가 필요하면 방법 A(Render)를 쓰세요.

---

## 어떤 걸 고를까?

| 상황 | 추천 |
|---|---|
| 폰에서 편하게, 남에게도 링크 공유, 항상 접속 | **방법 A (Render)** |
| 지금 잠깐 내 폰으로만 빠르게 확인 | 방법 B (터널) |
