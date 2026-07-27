// 혜택AI 웹 클라이언트 — 따뜻한 친근 디자인 + 렌탈. 인증: 세션 토큰(Bearer).
const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const idem = () => (crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let TOKEN = localStorage.getItem("hyeaek_token") || "";
function headers() { return { "Content-Type": "application/json", ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}) }; }

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body;
}

// 세션 보장: 저장된 토큰이 없으면 게스트 로그인. 기기ID는 로컬에 유지해 같은 계정 재사용.
async function ensureSession() {
  if (TOKEN) return;
  let deviceId = localStorage.getItem("hyeaek_device");
  if (!deviceId) { deviceId = idem(); localStorage.setItem("hyeaek_device", deviceId); }
  const r = await api("/v1/auth/guest", { method: "POST", body: JSON.stringify({ device_id: deviceId }) });
  TOKEN = r.token; localStorage.setItem("hyeaek_token", TOKEN);
}
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = el(`<div class="toast"></div>`); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

let conversationId = null;
const state = { tab: "ai" };

async function refreshWallet() {
  try {
    const w = await api("/v1/wallet");
    document.querySelector("#walletMini").innerHTML = `사용 가능 <b>${w.available.toLocaleString("ko-KR")}</b>원`;
    return w;
  } catch { return { available: 0, pending: 0, used: 0 }; }
}

document.querySelector("#tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll("#tabbar button").forEach((x) => x.classList.toggle("active", x === b));
  state.tab = b.dataset.tab; render();
});

function render() {
  refreshWallet();
  ({ ai: renderAI, shop: renderShop, mission: renderMission, walk: renderWalk, reward: renderReward, settings: renderSettings })[state.tab]();
}

// ---------- AI 도움 ----------
const QUICK = [
  { e: "💰", t: "생활비 아끼는 법" },
  { e: "🛡️", t: "이거 사기인가요?" },
  { e: "🧳", t: "여행 싸게 가기" },
];
async function renderAI() {
  const w = await refreshWallet();
  const v = document.querySelector("#view");
  v.innerHTML = "";
  v.appendChild(el(`
    <div class="ai-chat">
      <div id="emptyState">
        <div id="proCard"></div>
        <div id="hi"><div class="hello">안녕하세요 👋</div><div class="h-big">무엇이든 편하게<br>물어보세요</div></div>
        <div class="quick-head">이렇게 물어보세요</div>
        <div id="quicks"></div>
      </div>
      <div id="thread"></div>
      <div class="ask chat-input">
        <span class="muted">✎</span>
        <input id="q" placeholder="메시지를 입력하세요" />
        <button class="send-btn" id="send" aria-label="보내기">↑</button>
      </div>
    </div>`));
  const quicks = v.querySelector("#quicks");
  QUICK.forEach((q) => { const b = el(`<button class="quick"><span class="e">${q.e}</span><span class="t">${q.t}</span></button>`); b.addEventListener("click", () => ask(q.t)); quicks.appendChild(b); });
  v.querySelector("#send").addEventListener("click", () => ask());
  v.querySelector("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
  // 오늘의 이야기(선제 대화) — 앱이 먼저 안부를 건넨다.
  api("/v1/proactive").then((p) => {
    const box = v.querySelector("#proCard"); if (!box || !p) return;
    const hi = v.querySelector("#hi"); if (hi) hi.style.display = "none"; // 인사말 중복 제거(카드가 대신)
    box.appendChild(el(`<div class="pro-card">
      <div class="pro-head"><span class="pro-title">오늘의 이야기</span>${p.weather ? `<span class="pro-w">☀️ ${esc(p.weather.label)} ${p.weather.tempC}°</span>` : ""}</div>
      <div class="pro-msg">${esc(p.message)}</div>
      <button class="pro-topic">💬 ${esc(p.topic)}</button>
      ${p.action ? `<button class="pro-action">${esc(p.action.label)} ›</button>` : ""}
    </div>`));
    box.querySelector(".pro-topic").addEventListener("click", () => ask(p.topic));
    const act = box.querySelector(".pro-action");
    if (act) act.addEventListener("click", () => { const map = { "걷기": "walk", "내보상": "reward" }; document.querySelector(`#tabbar button[data-tab="${map[p.action.tab] || p.action.tab}"]`)?.click(); });
  }).catch(() => {});
  // 이미 진행 중인 대화가 있으면(탭 전환 후 복귀) 대화 내용을 유지 렌더
  if (chatLog.length) { document.querySelector("#emptyState").style.display = "none"; chatLog.forEach((node) => document.querySelector("#thread").appendChild(node)); scrollChatToEnd(); }
}

// 탭 전환에도 대화가 유지되도록 렌더된 메시지 노드를 보관
let chatLog = [];
function scrollChatToEnd() {
  const t = document.querySelector("#thread");
  if (t && t.lastElementChild) setTimeout(() => t.lastElementChild.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
}

async function ask(text) {
  const input = document.querySelector("#q");
  const q = (text ?? (input ? input.value : "")).trim(); if (!q) return;
  const thread = document.querySelector("#thread");
  if (input) input.value = "";
  // 첫 메시지에서 홈(빈 상태) 숨기고 채팅 모드로 전환
  const emptyState = document.querySelector("#emptyState");
  if (emptyState) emptyState.style.display = "none";
  // 사용자 말풍선을 먼저 아래에 붙이고 스크롤(채팅처럼 순서대로)
  const userMsg = el(`<div class="msg-row"><div class="user-bubble">${esc(q)}</div></div>`);
  thread.appendChild(userMsg); chatLog.push(userMsg);
  const loading = el(`<div class="msg-row"><div class="card answer typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>`);
  thread.appendChild(loading);
  scrollChatToEnd();
  try {
    if (!conversationId) conversationId = (await api("/v1/conversations", { method: "POST", body: "{}" })).conversation_id;
    const r = await api(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: q }) });
    loading.remove();
    // 무료 대화 소진 → 답변 대신 '광고 보고 이어가기' 카드. 광고 후 방금 질문 자동 전송.
    if (r.gated || !r.answer) {
      const gate = gateCard(r.chat || {}, q);
      thread.appendChild(gate); chatLog.push(gate);
      scrollChatToEnd();
      return;
    }
    const block = answerBlock(r);
    thread.appendChild(block); chatLog.push(block);
    scrollChatToEnd();
  } catch (err) {
    loading.remove();
    const errNode = el(`<div class="msg-row"><div class="card answer"><div>${esc(err.title || "연결이 잠시 불안정해요.")}</div><button class="retry-btn mt">↻ 다시 시도</button></div></div>`);
    errNode.querySelector(".retry-btn").addEventListener("click", () => { errNode.remove(); const idx = chatLog.indexOf(errNode); if (idx >= 0) chatLog.splice(idx, 1); ask(q); });
    thread.appendChild(errNode); chatLog.push(errNode);
    scrollChatToEnd();
  }
}

// 대화 연장 광고 게이트 — 수익화 미션을 대화에 녹인 카드.
function gateCard(chat, question) {
  const reward = chat.adReward ?? 20, per = chat.perUnlock ?? 5;
  const node = el(`
    <div class="msg-row"><div class="card gate">
      <div class="gate-title">무료 대화를 다 쓰셨어요</div>
      <div class="gate-body">짧은 광고를 보면 대화 ${per}회를 더 할 수 있고, 포인트 ${reward}P도 함께 드려요.</div>
      <button class="gate-btn">🎬 광고 보고 이어가기 (+${reward}P)</button>
      <button class="gate-alt">또는 걸어서 포인트 모으기 ›</button>
    </div></div>`);
  const btn = node.querySelector(".gate-btn");
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "광고 보는 중…";
    try {
      await new Promise((r) => setTimeout(r, 1400)); // 광고 재생 대체(실 SDK 연동 지점)
      await api("/v1/chat/ad", { method: "POST", body: "{}" });
      refreshWallet();
      const idx = chatLog.indexOf(node); if (idx >= 0) chatLog.splice(idx, 1);
      node.remove();
      ask(question); // 방금 질문 자동 재전송
    } catch (e) { btn.disabled = false; btn.textContent = `🎬 광고 보고 이어가기 (+${reward}P)`; }
  });
  node.querySelector(".gate-alt").addEventListener("click", () => document.querySelector(`#tabbar button[data-tab="walk"]`)?.click());
  return node;
}

function answerBlock(r) {
  const a = r.answer;
  const sections = a.sections.map((s) => `<div class="section"><div class="h">${esc(s.title)}</div><div>${esc(s.body)}</div></div>`).join("");
  const block = el(`
    <div class="msg-row">
      <div class="card answer">
        <div class="ai-badge-row"><span class="ai-badge">AI</span><span class="muted" style="font-weight:700">AI 답변</span></div>
        <div class="summary">${esc(a.summary)}</div>
        ${sections}
        ${a.uncertainty && a.uncertainty.message ? `<div class="uncertain-note">ⓘ ${esc(a.uncertainty.message)}</div>` : ""}
      </div>
      <div id="ad"></div>
    </div>`);
  const ad = block.querySelector("#ad");
  if (r.safetyNotice) ad.appendChild(safetyCard(r.safetyNotice));
  const need = r.needLevel || (r.matched && r.matched.benefits && r.matched.benefits.length ? "ready" : "none");
  const benefits = (r.matched && r.matched.benefits) || (r.commercial ? [r.commercial] : []);
  const missions = (r.matched && r.matched.missions) || [];

  if (need === "ready") {
    benefits.forEach((o) => ad.appendChild(offerCard(o, r.answerSnapshotId)));
    missions.forEach((o) => ad.appendChild(offerCard(o, r.answerSnapshotId)));
  } else if (need === "exploring" && benefits.length) {
    ad.appendChild(softSuggestion(benefits[0], r.answerSnapshotId));
  }

  if (r.rewardNudge) ad.appendChild(nudgeChip(r.rewardNudge));

  if (need === "none" && !r.rewardNudge && !r.safetyNotice) {
    ad.appendChild(el(`<div class="ai-note">지금은 안내에 집중했어요. 필요한 순간에만 혜택을 연결해 드려요.</div>`));
  }

  // 후속 질문 유도 — 탭하면 이어서 물어봄
  if (Array.isArray(r.followUps) && r.followUps.length) {
    const fw = el(`<div class="follow-wrap"><div class="follow-head">이어서 물어보기</div></div>`);
    r.followUps.slice(0, 2).forEach((q) => {
      const c = el(`<button class="follow-chip"><span>${esc(q)}</span><span class="fa">›</span></button>`);
      c.addEventListener("click", () => ask(q));
      fw.appendChild(c);
    });
    ad.appendChild(fw);
  }
  return block;
}

// 안전 안내 카드(사기·위기·건강·금융). 상담 번호는 tel: 링크.
function safetyCard(n) {
  const critical = n.level === "critical";
  const res = (n.resources || []).map((r) => `<a class="res-btn" href="tel:${esc(r.value.replace(/[^0-9]/g, ""))}"><span class="rl">${esc(r.label)}</span><span class="rv">📞 ${esc(r.value)}</span></a>`).join("");
  return el(`<div class="safety ${critical ? "critical" : "warn"}">
    <div class="safety-title">${critical ? "🛑 " : "ℹ️ "}${esc(n.title)}</div>
    <div class="safety-body">${esc(n.body)}</div>
    ${res ? `<div class="safety-res">${res}</div>` : ""}
  </div>`);
}

// exploring: 부드러운 제안 — 누르면 카드가 펼쳐진다(포인트 앞세움)
function softSuggestion(o, answerSnapshotId) {
  const wrap = el(`<div>
    <button class="soft-sug">
      <span class="e">💡</span>
      <span class="tx"><span class="soft-h"><b>관련해서 도움받을 수 있어요</b><span class="soft-ad">광고·제휴</span></span><span class="sub">${esc(o.title)} · 확정 시 최대 ${won(o.expectedReward)}</span></span>
      <span class="tg">보기</span>
    </button>
    <div class="soft-body" style="display:none"></div>
  </div>`);
  const btn = wrap.querySelector(".soft-sug"), body = wrap.querySelector(".soft-body"), tg = wrap.querySelector(".tg");
  let open = false, built = false;
  btn.addEventListener("click", () => {
    open = !open;
    if (open && !built) { body.appendChild(offerCard(o, answerSnapshotId)); built = true; }
    body.style.display = open ? "block" : "none";
    tg.textContent = open ? "접기" : "보기";
  });
  return wrap;
}

// 대화 맥락 리워드 넛지 — 걷기/미션 탭으로 연결
function nudgeChip(kind) {
  const walk = kind === "walk";
  const c = el(`<button class="nudge-chip"><span class="e">${walk ? "👟" : "🎯"}</span><span class="tx">${walk ? "지금 걸으면 포인트가 쌓여요" : "짧은 미션으로 포인트 모으기"}</span><span class="go">바로가기 ›</span></button>`);
  c.addEventListener("click", () => { const t = walk ? "walk" : "mission"; document.querySelector(`#tabbar button[data-tab="${t}"]`).click(); });
  return c;
}

// ---------- 오퍼 카드 ----------
function offerCard(o, answerSnapshotId) {
  const rental = o.isRental;
  const chips = [
    o.autoRenewal
      ? `<span class="chip warn">⚠︎ ${rental ? "자동결제·의무약정 " + o.mandatoryMonths + "개월" : "자동결제 있음"}</span>`
      : `<span class="chip ok">✓ 자동결제 없음</span>`,
    `<span class="chip ok">✓ ${rental ? "언제든 상담 취소 가능" : "취소·환불 가능"}</span>`,
    o.dataSharing === "없음" ? `<span class="chip ok">✓ 연락처 미전달</span>` : `<span class="chip warn">⚠︎ 연락처 전달</span>`,
  ].join("");
  const inset = rental
    ? `<div class="row"><span class="k">월 렌탈료</span><span class="v accent" style="font-size:1.3rem">${won(o.monthlyFee)}<span class="muted" style="font-size:.8rem;font-weight:600"> /월</span></span></div>
       <div class="divider"></div>
       <div class="row"><span class="k">약정 기간</span><span class="v">${o.contractMonths}개월</span></div>
       <div class="row"><span class="k">의무 사용</span><span class="v">${o.mandatoryMonths}개월</span></div>
       <div class="row"><span class="k">총 예상 비용</span><span class="v">${won(o.totalCost)}</span></div>
       <div class="row"><span class="k">설치 확정 시 보상</span><span class="v accent">최대 ${won(o.expectedReward)}</span></div>`
    : `<div class="row"><span class="k">총비용</span><span class="v" style="font-size:1.3rem">${won(o.totalCost)}</span></div>
       <div class="divider"></div>
       <div class="row"><span class="k">확정 시 최대 보상</span><span class="v accent">${won(o.expectedReward)}</span></div>
       <div class="row"><span class="k">확정 시점</span><span class="v" style="font-weight:600">${esc(o.approvalWindow)}</span></div>`;
  const c = el(`
    <div class="card offer mt">
      <div class="toprow"><span class="ad-label">광고·제휴</span><span class="advertiser">${esc(o.advertiserName)}</span><span class="cat-tag">${rental ? "렌탈 제휴" : o.category === "survey" ? "미션 제휴" : "쇼핑 제휴"}</span></div>
      <h3>${rental ? "🚰 " : ""}${esc(o.title)}</h3>
      <div class="muted" style="margin-bottom:8px">${esc(o.recommendationReason)}</div>
      <div class="inset">${inset}</div>
      <div class="chips">${chips}</div>
      <button class="btn btn-primary mt">${rental ? "설치 상담 신청하기" : "제휴처에서 조건을 확인합니다"}</button>
    </div>`);
  c.querySelector("button").addEventListener("click", () => (rental ? openLeadForm(o) : goExternal(o, answerSnapshotId)));
  return c;
}

// 렌탈 설치 상담 신청 폼(모달)
function openLeadForm(o) {
  const m = el(`<div class="modal-bg"><div class="lead-modal">
    <h3 style="margin:0 0 4px">설치 상담 신청</h3>
    <div class="muted" style="margin-bottom:14px">${esc(o.title)} · ${esc(o.advertiserName)}</div>
    <label class="fl">이름</label><input id="ln" placeholder="성함" />
    <label class="fl">연락처</label><input id="lp" placeholder="010-0000-0000" inputmode="tel" />
    <label class="fl">설치 주소</label><input id="la" placeholder="설치할 주소" />
    <label class="fl">희망 상담 시간 (선택)</label><input id="lt" placeholder="예: 평일 오후" />
    <div class="lead-disclose">
      <b>개인정보 제3자 제공 안내</b><br>
      · 제공받는 자: ${esc(o.advertiserName)}<br>· 제공 항목: ${esc(o.dataSharing)}<br>· 목적: 렌탈 설치 상담·계약<br>
      · 보유·이용기간: 상담 종료 후 파기<br>· 월 ${won(o.monthlyFee)} · 약정 ${o.contractMonths}개월 · 의무 ${o.mandatoryMonths}개월 · 자동결제 있음
    </div>
    <label class="lead-check"><input type="checkbox" id="lc" /> 위 개인정보 제3자 제공에 동의합니다 (필수)</label>
    <button class="btn btn-primary" id="lsubmit">상담 신청하기</button>
    <button class="btn" id="lcancel" style="width:100%;background:none;color:var(--muted)">닫기</button>
  </div></div>`);
  document.body.appendChild(m);
  m.querySelector("#lcancel").addEventListener("click", () => m.remove());
  m.querySelector("#lsubmit").addEventListener("click", async () => {
    const name = m.querySelector("#ln").value.trim(), phone = m.querySelector("#lp").value.trim(), address = m.querySelector("#la").value.trim();
    const time = m.querySelector("#lt").value.trim(), agree = m.querySelector("#lc").checked;
    if (!name || !phone || !address) return toast("이름·연락처·설치 주소를 입력해주세요.");
    if (!agree) return toast("개인정보 제3자 제공 동의가 필요해요.");
    try {
      await api("/v1/consents/third_party", { method: "PUT", body: JSON.stringify({ granted: true }) });
      const r = await api(`/v1/offers/${o.offerSnapshotId}/lead`, { method: "POST", headers: { "Idempotency-Key": idem() }, body: JSON.stringify({ name, phone, address, preferred_time: time || undefined }) });
      await api(`/v1/dev/simulate-conversion`, { method: "POST", body: JSON.stringify({ supplier: "sup_rental", source: "rental_cpa", click_id: r.click_id, gross_amount: o.totalCost || 0 }) }).catch(() => {});
      m.remove();
      toast(`상담 신청 완료 · ${o.advertiserName}에서 연락 예정`);
      refreshWallet();
    } catch (e) { toast(e.title || "신청 실패"); }
  });
}

async function goExternal(o, answerSnapshotId) {
  const warn = o.isRental ? `이 상품은 정기결제(자동결제)와 의무약정 ${o.mandatoryMonths}개월이 있어요.\n` : "";
  if (!confirm(`제휴처(${o.advertiserName})로 이동합니다.\n${warn}· 개인정보 전달: ${o.dataSharing}\n· 비식별 클릭 ID만 전달됩니다.\n계속할까요?`)) return;
  try {
    await doClickAndConvert(o, answerSnapshotId);
  } catch (err) {
    // 제3자 제공 동의 필요(렌탈 리드 등) → 동의 후 재시도
    if (err.code === "CONSENT_REQUIRED") {
      if (confirm(`${err.detail || "개인정보 제3자 제공 동의가 필요합니다."}\n\n동의하고 계속할까요?`)) {
        await api("/v1/consents/third_party", { method: "PUT", body: JSON.stringify({ granted: true }) });
        try { await doClickAndConvert(o, answerSnapshotId); } catch (e) { toast(e.title || "진행 실패"); }
      }
      return;
    }
    toast(err.title || "이동 링크 생성 실패");
  }
}
async function doClickAndConvert(o, answerSnapshotId) {
  const r = await api(`/v1/offers/${o.offerSnapshotId}/clicks`, { method: "POST", headers: { "Idempotency-Key": idem() }, body: JSON.stringify({ answer_snapshot_id: answerSnapshotId || null }) });
  await simulateConversion(o, r.click_id);
}
async function simulateConversion(o, clickId) {
  const map = o.category === "survey" ? ["sup_offerwall", "offerwall_cpa"] : o.isRental ? ["sup_rental", "rental_cpa"] : ["sup_linkprice", "shopping_cps"];
  // 데모: 서버의 dev 시뮬레이터를 통해 전환 생성(실 postback은 공급사 HMAC 서명 필요)
  await api(`/v1/dev/simulate-conversion`, { method: "POST", body: JSON.stringify({ supplier: map[0], source: map[1], click_id: clickId, gross_amount: o.totalCost || 10000 }) });
  toast(o.isRental ? "상담 접수됨 · 내 보상에서 확인 중 확인" : "전환 접수됨 · 내 보상에서 '확인 중'");
  refreshWallet();
}

// ---------- 혜택(쇼핑/렌탈) & 미션 ----------
async function renderShop() {
  await renderOfferList([{ k: "shopping", l: "쇼핑·예약" }, { k: "rental", l: "렌탈" }], "혜택", "검수된 제휴 상품이에요. 총비용과 조건을 꼭 확인하세요.");
}
async function renderMission() {
  await renderOfferList([{ k: "mission", l: "미션" }], "미션", "설문·가입 등 행동을 완료하면 보상을 받아요. 소요시간과 개인정보 전달을 먼저 확인하세요.");
}
async function renderOfferList(segs, title, sub, seg) {
  const cur = seg || segs[0].k;
  const v = document.querySelector("#view");
  v.innerHTML = `<h2 class="title">${title}</h2><p class="sub">${sub}</p>`;
  if (segs.length > 1) {
    const bar = el(`<div class="segbar"></div>`);
    segs.forEach((s) => { const b = el(`<button class="seg ${s.k === cur ? "active" : ""}">${s.l}</button>`); b.addEventListener("click", () => renderOfferList(segs, title, sub, s.k)); bar.appendChild(b); });
    v.appendChild(bar);
  }
  if (cur === "rental") v.appendChild(el(`<div class="notice">렌탈은 매달 요금이 나가는 정기결제 상품이에요. 월 요금·약정·의무기간을 꼭 확인하세요.</div>`));
  const list = el(`<div id="list" class="muted">불러오는 중…</div>`); v.appendChild(list);
  try {
    const { offers } = await api(`/v1/offers?type=${cur}`);
    list.innerHTML = ""; list.classList.remove("muted");
    if (!offers.length) { list.textContent = "지금은 조건을 만족하는 혜택이 없어요."; list.classList.add("muted"); return; }
    offers.forEach((o) => list.appendChild(offerCard(o, null)));
  } catch { list.textContent = "불러오지 못했어요."; }
}

// ---------- 걷기 ----------
async function renderWalk() {
  const v = document.querySelector("#view");
  v.innerHTML = `<h2 class="title">걷기</h2><p class="sub">걸을수록 마일스톤이 열려요. 광고를 보면 보상을 받습니다.</p><div id="walk" class="muted">불러오는 중…</div>`;
  drawWalk(await api("/v1/cashwalk"));
}
function drawWalk(s) {
  const w = document.querySelector("#walk"); w.classList.remove("muted");
  const pct = Math.min(100, (s.steps / s.dailyCap) * 100);
  const msHtml = Array.from({ length: Math.floor(s.dailyCap / s.stepPerMilestone) }, (_, i) => {
    const m = i + 1;
    const cls = s.claimedMilestones.includes(m) ? "done" : s.claimable.includes(m) ? "claimable" : "locked";
    return `<button class="ms ${cls}" data-m="${m}" ${cls === "claimable" ? "" : "disabled"}>${m}</button>`;
  }).join("");
  w.innerHTML = `
    <div class="card">
      <div class="steps-big">${s.steps.toLocaleString("ko-KR")}</div>
      <div class="center muted">오늘 걸음 (상한 ${s.dailyCap.toLocaleString("ko-KR")}보)</div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="row"><span class="k">오늘 받은 보상</span><span class="v" style="color:var(--brand)">${won(s.earnedToday)}</span></div>
      <div class="row"><span class="k">마일스톤당 보상</span><span class="v">${won(s.rewardPerMilestone)} (${s.stepPerMilestone.toLocaleString("ko-KR")}보마다)</span></div>
      <button class="btn btn-ghost mt" id="add" style="width:100%">+1,000보 (데모 걷기)</button>
    </div>
    <div class="card">
      <h3>마일스톤</h3><p class="muted" style="margin-top:0">주황색은 광고 보고 받기 가능, 초록색은 받음.</p>
      <div class="milestones">${msHtml}</div>
      <div class="disclose">보상 재원은 잠금화면·리워드 광고입니다. 걸음 자체가 아니라 '광고 시청'에 대해 지급돼요.</div>
    </div>`;
  w.querySelector("#add").addEventListener("click", async () => drawWalk(await api("/v1/cashwalk/steps", { method: "POST", body: JSON.stringify({ steps: s.steps + 1000, device_integrity_ok: true }) })));
  w.querySelectorAll(".ms.claimable").forEach((b) => b.addEventListener("click", () => {
    toast("광고 시청 중…(데모 2초)");
    setTimeout(async () => {
      try { await api("/v1/cashwalk/claims", { method: "POST", body: JSON.stringify({ milestone: Number(b.dataset.m), ad_impression_id: "imp_" + idem() }) }); toast("보상 지급! 내 보상에서 확인"); drawWalk(await api("/v1/cashwalk")); refreshWallet(); }
      catch (e) { toast(e.title || "청구 실패"); }
    }, 2000);
  }));
}

// ---------- 내 보상 ----------
async function renderReward() {
  const v = document.querySelector("#view");
  const w = await refreshWallet();
  const { rewards } = await api("/v1/rewards");
  v.innerHTML = `<h2 class="title">내 보상</h2>`;
  v.appendChild(el(`
    <div class="card">
      <div class="center"><div class="muted" style="font-weight:700">사용 가능</div><div class="big-amount" style="color:var(--brand)">${won(w.available)}</div></div>
      <div class="row mt"><span class="pill pending">확인 중</span><span class="v">${won(w.pending)}</span></div>
      <div class="row"><span class="pill paid">사용 완료</span><span class="v">${won(w.used)}</span></div>
      <button class="btn btn-primary mt" id="exchange" ${w.available < 3000 ? "disabled" : ""}>3,000원 쿠폰으로 교환하기</button>
      <div class="disclose">확인 중 금액은 아직 사용할 수 없어요. 광고주 확인이 끝나면 '사용 가능'으로 바뀝니다.</div>
    </div>`));
  const list = el(`<div><h3 class="title" style="font-size:1.2rem">거래 내역</h3></div>`);
  if (!rewards.length) list.appendChild(el(`<div class="card muted">아직 거래가 없어요. AI 도움·혜택·미션·걷기로 보상을 모아보세요.</div>`));
  rewards.forEach((r) => {
    const cls = r.state === "available" ? "available" : r.state === "reversed" ? "reversed" : r.state === "paid" ? "paid" : "pending";
    const card = el(`<div class="card">
        <div class="row"><span style="font-weight:800">${esc(r.title)}</span><span class="pill ${cls}">${r.state_label}</span></div>
        <div class="row"><span class="k">${esc(sourceLabel(r.source))}</span><span class="v">${won(r.amount)}</span></div>
        <button class="btn btn-ghost" data-id="${r.reward_transaction_id}" style="width:100%">진행 상태 보기</button>
      </div>`);
    card.querySelector("button").addEventListener("click", () => showTimeline(r.reward_transaction_id));
    list.appendChild(card);
  });
  v.appendChild(list);
  v.querySelector("#exchange")?.addEventListener("click", () => exchange(w.available));
}
async function showTimeline(rid) {
  const r = await api(`/v1/rewards/${rid}`);
  alert(`${r.title}\n상태: ${r.state_label} · ${won(r.amount)}\n\n[타임라인]\n` + r.timeline.map((t) => `• ${t.reason} (${new Date(t.created_at).toLocaleString("ko-KR")})`).join("\n"));
}
async function exchange(available) {
  // 상품 카탈로그가 3,000원 쿠폰 1종 → 상품과 금액 일치.
  const amount = 3000;
  if (available < amount) return toast("3,000원 쿠폰 교환에는 최소 3,000원이 필요해요.");
  if (!confirm(`${won(amount)}을 모바일 쿠폰으로 교환할까요?`)) return;
  try {
    const r = await api("/v1/payouts", { method: "POST", headers: { "Idempotency-Key": idem() }, body: JSON.stringify({ amount, product_id: "coupon_3000" }) });
    if (r.status === "paid") toast(`교환 완료! 쿠폰번호 ${r.coupon_code}`);
    else if (r.status === "unknown") toast("확인 중이에요. 잔액은 보호됩니다.");
    else toast("교환 실패 · 잔액이 복구됐어요.");
    renderReward();
  } catch (e) { toast(e.title || "교환 실패"); }
}

function sourceLabel(s) { return ({ shopping_cps: "쇼핑 적립", offerwall_cpa: "미션 보상", cashwalk_ad: "걷기 보상", rental_cpa: "렌탈 보상", chat_ad: "대화 연장 보상", sponsor_chat: "대화 미션 보상" })[s] || s; }

// ---------- 온보딩(첫 실행) ----------
const ONB_STEPS = [
  { emoji: "💬", title: "무엇이든 편하게<br>물어보세요", body: "생활비, 여행, 쇼핑, 렌탈까지. 궁금한 걸 말하듯 물어보면 핵심부터 쉽게 정리해 드려요.", point: "답변은 광고와 상관없이 완결돼요." },
  { emoji: "🎁", title: "필요할 때만<br>혜택을 연결해요", body: "대화 속에 필요가 보일 때만 관련 혜택·미션을 보여드려요. 원치 않으면 안 봐도 됩니다. 광고는 늘 ‘광고·제휴’로 표시돼요.", point: "필요 없으면 답변만 받아도 괜찮아요." },
  { emoji: "👛", title: "걷고 참여하면<br>포인트가 쌓여요", body: "걷기·간단한 미션·혜택 참여로 포인트를 모아 모바일 쿠폰으로 바꿔요. 비용은 광고주가 부담하고, 위치 정보는 수집하지 않아요.", point: "내 이름·번호는 동의한 경우에만 전달돼요." },
];
function showOnboarding() {
  let i = 0;
  const ov = el(`<div class="onb"></div>`);
  function draw() {
    const st = ONB_STEPS[i], last = i === ONB_STEPS.length - 1;
    ov.innerHTML = `
      <button class="onb-skip">건너뛰기</button>
      <div class="onb-body">
        <div class="onb-emoji">${st.emoji}</div>
        <div class="onb-title">${st.title}</div>
        <div class="onb-desc">${esc(st.body)}</div>
        <div class="onb-point">✓ ${esc(st.point)}</div>
      </div>
      <div class="onb-dots">${ONB_STEPS.map((_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("")}</div>
      <button class="onb-cta">${last ? "시작하기" : "다음"}</button>`;
    ov.querySelector(".onb-skip").addEventListener("click", done);
    ov.querySelector(".onb-cta").addEventListener("click", () => { if (last) done(); else { i++; draw(); } });
  }
  function done() { localStorage.setItem("hyeaek_onboarded", "1"); ov.remove(); }
  draw();
  document.body.appendChild(ov);
}

// ---------- 설정 ----------
const FAQ_ITEMS = [
  { q: "포인트는 어떻게 받나요?", a: "걷기, 간단한 미션, 혜택 참여로 포인트가 쌓여요. ‘내 보상’에서 확인하고 3,000원부터 모바일 쿠폰으로 바꿀 수 있어요." },
  { q: "‘확인 중’은 무슨 뜻인가요?", a: "적립이 제휴사 확인을 기다리는 상태예요. 보통 며칠 안에 ‘사용 가능’으로 바뀌고, 취소·반품되면 회수될 수 있어요." },
  { q: "정말 안전한가요? 비용이 드나요?", a: "이용료는 없어요. 비용은 광고주가 부담합니다. 위치 정보는 수집하지 않고, 이름·연락처는 상담을 신청하고 동의했을 때만 전달돼요." },
  { q: "광고를 꼭 봐야 하나요?", a: "아니요. 답변은 광고와 무관하게 완결돼요. 필요할 때만 ‘광고·제휴’ 표시와 함께 혜택을 보여드려요." },
  { q: "쿠폰은 어떻게 쓰나요?", a: "‘내 보상’에서 교환하면 쿠폰번호가 나와요. 편의점·온라인에서 사용할 수 있어요." },
];
const OPTIONAL_CONSENTS = [
  { purpose: "location", title: "위치(동네) 사용", desc: "동네 날씨 등 '오늘의 이야기'를 더 맞춤으로 건네드려요. 정밀 위치가 아니라 동네만 사용해요." },
  { purpose: "third_party", title: "개인정보 제3자 제공", desc: "렌탈 등 상담 신청 시 이름·연락처·주소를 제휴사에 전달합니다. 끄면 상담 신청이 제한됩니다." },
  { purpose: "personalized_ads", title: "맞춤 혜택 추천", desc: "대화 맥락에 맞는 혜택·미션을 추천받습니다. 끄면 일반 안내만 제공됩니다." },
  { purpose: "marketing", title: "혜택·이벤트 알림", desc: "새로운 혜택·이벤트 소식을 받습니다." },
];
const DOC_TERMS = "제1조(목적) 본 약관은 혜택AI(이하 \"서비스\")의 이용 조건과 절차를 규정합니다.\n제2조(서비스) AI 대화 안내와 함께, 필요가 있을 때 검수된 제휴 혜택·미션·렌탈·걷기 리워드를 연결합니다. 답변은 광고와 무관하게 완결됩니다.\n제3조(리워드) 적립 보상은 제휴사의 유효 전환 확인 후 '사용 가능'으로 확정되며, 취소·반품 시 회수될 수 있습니다.\n제4조(유의) 가격·조건 등 변동 정보는 진행 전 원문에서 다시 확인해야 합니다.\n※ 본 문안은 데모용 예시이며, 실제 출시 전 법률 검토를 거쳐 확정됩니다.";
const DOC_PRIVACY = "1. 수집 항목: 기기 식별자, 대화 내용, 걸음수(위치 미수집). 상담 신청 시에만 이름·연락처·주소를 수집합니다.\n2. 이용 목적: 서비스 제공, 리워드 정산, 맞춤 혜택 추천(동의 시).\n3. 보관·파기: 상담 정보는 상담 종료 후 파기하며, 연락처·주소는 암호화 저장합니다.\n4. 이용자 권리: 동의는 설정에서 언제든 철회할 수 있고, 열람·삭제를 요청할 수 있습니다.\n5. 제3자 제공: 이용자가 신청한 경우에 한해 동의한 항목만 해당 제휴사에 제공합니다.\n※ 본 문안은 데모용 예시이며, 실제 출시 전 개인정보 영향평가·법률 검토를 거쳐 확정됩니다.";

async function renderSettings() {
  const v = document.querySelector("#view");
  v.innerHTML = `<h2 class="title">설정</h2>`;
  let granted = {};
  try { const r = await api("/v1/consents"); r.consents.forEach((c) => { granted[c.purpose] = !!c.granted; }); } catch { /* noop */ }

  v.appendChild(el(`<div class="set-sec">개인정보·동의 관리</div>`));
  const card = el(`<div class="card set-card"></div>`);
  OPTIONAL_CONSENTS.forEach((c, i) => {
    const row = el(`<div class="set-consent${i < OPTIONAL_CONSENTS.length - 1 ? " rdiv" : ""}">
      <div class="tx"><div class="ct">${esc(c.title)}</div><div class="cd">${esc(c.desc)}</div></div>
      <button class="toggle ${granted[c.purpose] ? "on" : ""}" role="switch" aria-checked="${!!granted[c.purpose]}"><span class="knob"></span></button>
    </div>`);
    const btn = row.querySelector(".toggle");
    btn.addEventListener("click", async () => {
      const next = !btn.classList.contains("on");
      btn.classList.toggle("on", next); btn.setAttribute("aria-checked", String(next));
      try { await api(`/v1/consents/${c.purpose}`, { method: "PUT", body: JSON.stringify({ granted: next }) }); }
      catch { btn.classList.toggle("on", !next); toast("잠시 후 다시 시도해주세요."); }
    });
    card.appendChild(row);
  });
  v.appendChild(card);
  v.appendChild(el(`<div class="sub" style="margin-top:8px">동의는 언제든 켜고 끌 수 있어요. 끄면 즉시 반영됩니다.</div>`));

  // 동네(위치) 설정 — 오늘의 이야기 날씨 맥락.
  let me = {};
  try { me = await api("/v1/me"); } catch { /* noop */ }
  v.appendChild(el(`<div class="set-sec">내 동네</div>`));
  const regionCard = el(`<div class="card set-card">
    <div class="set-consent"><div class="tx"><div class="ct">동네 설정</div><div class="cd">날씨 등 오늘의 이야기를 동네에 맞춰 드려요.</div></div></div>
    <div style="display:flex;gap:8px;padding:0 0 14px"><input id="regionInput" placeholder="예: 서울 마포구" value="${esc(me.region || "")}" style="flex:1;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)"/><button class="btn" id="regionSave" style="width:auto;min-height:auto;padding:10px 16px;background:var(--brand);color:#fff">저장</button></div>
  </div>`);
  regionCard.querySelector("#regionSave").addEventListener("click", async () => {
    try { await api("/v1/me/region", { method: "PUT", body: JSON.stringify({ region: regionCard.querySelector("#regionInput").value.trim() || null }) }); toast("동네 저장됨"); }
    catch { toast("저장 실패"); }
  });
  v.appendChild(regionCard);

  v.appendChild(el(`<div class="set-sec">도움말 · 자주 묻는 질문</div>`));
  const faq = el(`<div class="card set-card"></div>`);
  FAQ_ITEMS.forEach((f, i) => {
    const row = el(`<div class="${i < FAQ_ITEMS.length - 1 ? "rdiv" : ""}">
      <button class="faq-q"><span>${esc(f.q)}</span><span class="chev">›</span></button>
      <div class="faq-a" style="display:none">${esc(f.a)}</div>
    </div>`);
    const q = row.querySelector(".faq-q"), a = row.querySelector(".faq-a"), chev = row.querySelector(".chev");
    q.addEventListener("click", () => { const open = a.style.display === "none"; a.style.display = open ? "block" : "none"; chev.textContent = open ? "∨" : "›"; });
    faq.appendChild(row);
  });
  v.appendChild(faq);
  const replay = el(`<button class="set-replay">📖 앱 소개 다시 보기</button>`);
  replay.addEventListener("click", showOnboarding);
  v.appendChild(replay);

  v.appendChild(el(`<div class="set-sec">약관·정책</div>`));
  const docs = el(`<div class="card set-card">
    <button class="set-link rdiv" id="t-terms">이용약관 <span class="chev">›</span></button>
    <button class="set-link" id="t-privacy">개인정보처리방침 <span class="chev">›</span></button>
  </div>`);
  docs.querySelector("#t-terms").addEventListener("click", () => openDoc("이용약관", DOC_TERMS));
  docs.querySelector("#t-privacy").addEventListener("click", () => openDoc("개인정보처리방침", DOC_PRIVACY));
  v.appendChild(docs);

  v.appendChild(el(`<div class="set-sec">계정</div>`));
  const acct = el(`<div class="card set-card"><button class="set-link danger" id="logout">로그아웃 <span class="chev">›</span></button></div>`);
  acct.querySelector("#logout").addEventListener("click", () => {
    if (!confirm("로그아웃하면 이 기기의 게스트 세션이 초기화돼요. 계속할까요?")) return;
    TOKEN = ""; localStorage.removeItem("hyeaek_token"); localStorage.removeItem("hyeaek_device");
    toast("로그아웃했어요. 새 세션으로 다시 시작합니다.");
    ensureSession().then(render).catch(() => render());
  });
  v.appendChild(acct);
  v.appendChild(el(`<div class="app-info">혜택AI · 버전 0.1.0</div>`));
}

function openDoc(title, body) {
  const m = el(`<div class="modal-bg"><div class="lead-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">${esc(title)}</h3><button class="btn" id="dc" style="width:auto;min-height:auto;background:none;color:var(--brand);padding:6px 10px">닫기</button></div><div style="max-height:56vh;overflow:auto;white-space:pre-line;line-height:1.7;font-size:.95rem">${esc(body)}</div></div></div>`);
  document.body.appendChild(m);
  m.querySelector("#dc").addEventListener("click", () => m.remove());
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
}

// 세션 보장 후 첫 렌더
ensureSession().then(render).catch(() => render());
// 첫 실행 온보딩(1회)
if (!localStorage.getItem("hyeaek_onboarded")) showOnboarding();
