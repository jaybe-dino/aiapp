// 혜택AI 웹 클라이언트(바닐라 JS). 5개 탭을 API에 연결.
const API = "";
const H = { "Content-Type": "application/json", "x-user-id": "usr_demo" };
const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const idem = () => (crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random());

async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: H, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body;
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

// ---------- 탭 라우팅 ----------
document.querySelector("#tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  document.querySelectorAll("#tabbar button").forEach((x) => x.classList.toggle("active", x === b));
  state.tab = b.dataset.tab; render();
});

function render() {
  refreshWallet();
  ({ ai: renderAI, shop: renderShop, mission: renderMission, walk: renderWalk, reward: renderReward })[state.tab]();
}

// ---------- AI 도움 ----------
function renderAI() {
  const v = document.querySelector("#view");
  v.innerHTML = "";
  v.appendChild(el(`
    <div>
      <h2 class="title">무엇을 도와드릴까요?</h2>
      <p class="sub">생활 질문을 편하게 말하거나 적어주세요. 답변은 광고와 분리됩니다.</p>
      <div class="quick">
        <button>다음 달 부산 여행 교통·숙박 비교해줘</button>
        <button>공기청정기 필터 싸게 사는 법</button>
        <button>이번 주 절약 팁 알려줘</button>
      </div>
      <div class="ask">
        <input id="q" placeholder="예: 부산 여행 어떻게 준비해요?" />
        <button class="btn btn-primary" id="send" style="width:auto">보내기</button>
      </div>
      <div id="thread" class="mt"></div>
    </div>`));
  v.querySelectorAll(".quick button").forEach((b) => b.addEventListener("click", () => { v.querySelector("#q").value = b.textContent; ask(); }));
  v.querySelector("#send").addEventListener("click", ask);
  v.querySelector("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
}

async function ask() {
  const input = document.querySelector("#q");
  const text = input.value.trim(); if (!text) return;
  const thread = document.querySelector("#thread");
  input.value = "";
  thread.prepend(el(`<div class="card"><div class="muted">질문</div><div style="font-weight:700">${escapeHtml(text)}</div><div class="muted mt">답변을 준비하고 있어요…</div></div>`));
  try {
    if (!conversationId) conversationId = (await api("/v1/conversations", { method: "POST", body: "{}" })).conversation_id;
    const r = await api(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    thread.firstElementChild.remove();
    thread.prepend(answerCard(text, r));
  } catch (err) {
    thread.firstElementChild.remove();
    thread.prepend(el(`<div class="card"><div class="pill reversed">오류</div><div class="mt">${escapeHtml(err.title || "잠시 후 다시 시도해주세요.")}</div></div>`));
  }
}

function answerCard(question, r) {
  const a = r.answer;
  const sections = a.sections.map((s) => `<div class="section"><div class="h">${escapeHtml(s.title)}</div><div>${escapeHtml(s.body)}</div></div>`).join("");
  const card = el(`
    <div class="card answer">
      <div class="muted">질문</div><div style="font-weight:700;margin-bottom:10px">${escapeHtml(question)}</div>
      <div class="summary">${escapeHtml(a.summary)}</div>
      ${sections}
      <div class="uncertain">⚠️ ${escapeHtml(a.uncertainty.message)}</div>
      <div id="ad"></div>
    </div>`);
  const ad = card.querySelector("#ad");
  if (r.commercial) ad.appendChild(offerCard(r.commercial, r.answerSnapshotId));
  else ad.appendChild(el(`<div class="disclose mt">이 질문과 관련해 조건을 만족하는 광고·제휴 혜택이 없어 표시하지 않았어요. (답변은 광고와 무관하게 완결됩니다.)</div>`));
  return card;
}

// ---------- 오퍼 카드(공통) ----------
function offerCard(o, answerSnapshotId) {
  const c = el(`
    <div class="card" style="margin-top:14px;border-color:#f0d7ad">
      <span class="ad-label">광고·제휴 혜택</span>
      <h3>${escapeHtml(o.title)}</h3>
      <div class="muted" style="margin-bottom:8px">${escapeHtml(o.advertiserName)} · ${escapeHtml(o.recommendationReason)}</div>
      <div class="row"><span class="k">총비용</span><span class="v">${won(o.totalCost)}</span></div>
      <div class="row"><span class="k">확정 시 최대 보상</span><span class="v" style="color:var(--available)">${won(o.expectedReward)}</span></div>
      <div class="row"><span class="k">보상 확정</span><span class="v">${escapeHtml(o.approvalWindow)}</span></div>
      <div class="row"><span class="k">취소·반품</span><span class="v" style="font-weight:500">${escapeHtml(o.cancelTerms)}</span></div>
      <div class="row"><span class="k">자동결제</span><span class="v">${o.autoRenewal ? "있음 ⚠️" : "없음"}</span></div>
      <div class="row"><span class="k">개인정보 전달</span><span class="v">${escapeHtml(o.dataSharing)}</span></div>
      <button class="btn btn-line mt" style="width:100%">제휴처에서 조건 확인하기</button>
    </div>`);
  c.querySelector("button").addEventListener("click", () => goExternal(o, answerSnapshotId));
  return c;
}

async function goExternal(o, answerSnapshotId) {
  if (!confirm(`제휴처(${o.advertiserName})로 이동합니다.\n· 개인정보 전달: ${o.dataSharing}\n· 비식별 클릭 ID만 전달됩니다.\n계속할까요?`)) return;
  try {
    const r = await api(`/v1/offers/${o.offerSnapshotId}/clicks`, {
      method: "POST", headers: { ...H, "Idempotency-Key": idem() },
      body: JSON.stringify({ answer_snapshot_id: answerSnapshotId || null }),
    });
    toast("이동 링크를 생성했어요 (데모: 전환 시뮬레이터로 연결)");
    // 데모: 실제 외부 이동 대신, 며칠 뒤 전환이 오는 상황을 즉시 시뮬레이션
    await simulateConversion(o, r.click_id);
  } catch (err) { toast(err.title || "이동 링크 생성 실패"); }
}

// 데모 편의: 공급사 postback을 대신 호출해 "확인 중 → 사용 가능" 흐름을 보여줌
async function simulateConversion(o, clickId) {
  const supplier = o.category === "survey" ? "sup_offerwall" : "sup_linkprice";
  const source = o.category === "survey" ? "offerwall_cpa" : "shopping_cps";
  const conv = await api(`/v1/suppliers/${supplier}/postbacks`, {
    method: "POST",
    body: JSON.stringify({ external_conversion_id: "demo_" + idem(), click_id: clickId, source, gross_amount: o.totalCost || 10000 }),
  });
  toast("전환 접수됨 · 내 보상에서 '확인 중'으로 확인하세요");
  refreshWallet();
  return conv;
}

// ---------- 혜택(쇼핑) ----------
async function renderShop() { await renderOfferList("shopping", "혜택 (쇼핑·예약)", "검수된 제휴 상품이에요. 총비용과 조건을 꼭 확인하세요."); }
// ---------- 미션(오퍼월) ----------
async function renderMission() { await renderOfferList("mission", "미션 (행동형)", "설문·가입 등 행동을 완료하면 보상을 받아요. 소요시간과 개인정보 전달을 먼저 확인하세요."); }

async function renderOfferList(type, title, sub) {
  const v = document.querySelector("#view");
  v.innerHTML = `<h2 class="title">${title}</h2><p class="sub">${sub}</p><div id="list" class="muted">불러오는 중…</div>`;
  try {
    const { offers } = await api(`/v1/offers?type=${type}`);
    const list = v.querySelector("#list"); list.innerHTML = "";
    if (!offers.length) { list.textContent = "지금은 조건을 만족하는 혜택이 없어요."; return; }
    offers.forEach((o) => list.appendChild(offerCard(o, null)));
  } catch { v.querySelector("#list").textContent = "불러오지 못했어요."; }
}

// ---------- 걷기(캐시워크) ----------
async function renderWalk() {
  const v = document.querySelector("#view");
  v.innerHTML = `<h2 class="title">걷기</h2><p class="sub">걸을수록 마일스톤이 열려요. 광고를 보면 보상을 받습니다.</p><div id="walk" class="muted">불러오는 중…</div>`;
  const s = await api("/v1/cashwalk");
  drawWalk(s);
}

function drawWalk(s) {
  const w = document.querySelector("#walk");
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
      <div class="row"><span class="k">오늘 받은 보상</span><span class="v" style="color:var(--available)">${won(s.earnedToday)}</span></div>
      <div class="row"><span class="k">마일스톤당 보상</span><span class="v">${won(s.rewardPerMilestone)} (${s.stepPerMilestone.toLocaleString("ko-KR")}보마다)</span></div>
      <div class="ask mt"><button class="btn btn-ghost" id="add">+1,000보 (데모 걷기)</button></div>
    </div>
    <div class="card">
      <h3>마일스톤</h3>
      <p class="muted" style="margin-top:0">주황색은 광고 보고 받기 가능, 초록색은 받음.</p>
      <div class="milestones">${msHtml}</div>
      <div class="disclose">보상 재원은 잠금화면·리워드 광고입니다. 걸음 자체가 아니라 '광고 시청'에 대해 지급돼요.</div>
    </div>`;
  w.querySelector("#add").addEventListener("click", async () => {
    const r = await api("/v1/cashwalk/steps", { method: "POST", body: JSON.stringify({ steps: s.steps + 1000, device_integrity_ok: true }) });
    drawWalk(r);
  });
  w.querySelectorAll(".ms.claimable").forEach((b) =>
    b.addEventListener("click", async () => {
      toast("광고 시청 중…(데모 2초)");
      setTimeout(async () => {
        try {
          await api("/v1/cashwalk/claims", { method: "POST", body: JSON.stringify({ milestone: Number(b.dataset.m), ad_impression_id: "imp_" + idem() }) });
          toast("보상 지급! 내 보상에서 확인하세요");
          drawWalk(await api("/v1/cashwalk"));
          refreshWallet();
        } catch (e) { toast(e.title || "청구 실패"); }
      }, 2000);
    })
  );
}

// ---------- 내 보상 ----------
async function renderReward() {
  const v = document.querySelector("#view");
  const w = await refreshWallet();
  const { rewards } = await api("/v1/rewards");
  v.innerHTML = `<h2 class="title">내 보상</h2>`;
  v.appendChild(el(`
    <div class="card">
      <div class="center"><div class="muted">사용 가능</div><div class="big-amount" style="color:var(--available)">${won(w.available)}</div></div>
      <div class="row mt"><span class="k"><span class="pill pending">확인 중</span></span><span class="v">${won(w.pending)}</span></div>
      <div class="row"><span class="k"><span class="pill paid">사용 완료</span></span><span class="v">${won(w.used)}</span></div>
      <button class="btn btn-primary mt" id="exchange" ${w.available < 100 ? "disabled" : ""}>쿠폰으로 교환하기</button>
      <div class="disclose">확인 중 금액은 아직 사용할 수 없어요. 광고주 확인이 끝나면 '사용 가능'으로 바뀝니다.</div>
    </div>`));
  const list = el(`<div><h3 class="title" style="font-size:1.15rem">거래 내역</h3></div>`);
  if (!rewards.length) list.appendChild(el(`<div class="card muted">아직 거래가 없어요. AI 도움/혜택/미션/걷기로 보상을 모아보세요.</div>`));
  rewards.forEach((r) => {
    const cls = r.state === "available" ? "available" : r.state === "reversed" ? "reversed" : r.state === "paid" ? "paid" : "pending";
    const card = el(`<div class="card">
        <div class="row"><span style="font-weight:700">${escapeHtml(r.title)}</span><span class="pill ${cls}">${r.state_label}</span></div>
        <div class="row"><span class="k">${escapeHtml(sourceLabel(r.source))}</span><span class="v">${won(r.amount)}</span></div>
        <button class="btn btn-ghost" data-id="${r.reward_transaction_id}">진행 상태 보기</button>
      </div>`);
    card.querySelector("button").addEventListener("click", () => showTimeline(r.reward_transaction_id));
    list.appendChild(card);
  });
  v.appendChild(list);
  v.querySelector("#exchange")?.addEventListener("click", () => exchange(w.available));
}

async function showTimeline(rid) {
  const r = await api(`/v1/rewards/${rid}`);
  const steps = r.timeline.map((t) => `<div class="row"><span class="k">${escapeHtml(t.reason)}</span><span class="v" style="font-weight:500">${new Date(t.created_at).toLocaleString("ko-KR")}</span></div>`).join("");
  alert(`${r.title}\n상태: ${r.state_label} · ${won(r.amount)}\n\n[타임라인]\n` + r.timeline.map((t) => `• ${t.reason} (${new Date(t.created_at).toLocaleString("ko-KR")})`).join("\n"));
}

async function exchange(available) {
  const amount = Math.min(3000, Math.floor(available / 100) * 100);
  if (amount < 100) return toast("교환 가능한 금액이 부족해요.");
  if (!confirm(`${won(amount)}을 모바일 쿠폰으로 교환할까요?`)) return;
  try {
    const r = await api("/v1/payouts", {
      method: "POST", headers: { ...H, "Idempotency-Key": idem() },
      body: JSON.stringify({ amount, product_id: "coupon_3000" }),
    });
    if (r.status === "paid") toast(`교환 완료! 쿠폰번호 ${r.coupon_code}`);
    else if (r.status === "unknown") toast("확인 중이에요. 잔액은 보호됩니다.");
    else toast("교환 실패 · 잔액이 복구됐어요.");
    renderReward();
  } catch (e) { toast(e.title || "교환 실패"); }
}

function sourceLabel(s) { return ({ shopping_cps: "쇼핑 적립", offerwall_cpa: "미션 보상", cashwalk_ad: "걷기 보상" })[s] || s; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

render();
