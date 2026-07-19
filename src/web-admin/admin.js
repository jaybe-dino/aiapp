// 혜택AI 운영자 콘솔. 단일 페이지, 섹션별 렌더.
let TOKEN = localStorage.getItem("admin_token") || "";
let ME = null;
const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const $ = (s) => document.querySelector(s);
const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json", "x-admin-token": TOKEN }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw body;
  return body;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2400); }

const SECTIONS = [
  { id: "dashboard", label: "대시보드", render: renderDashboard },
  { id: "offers", label: "오퍼 관리", render: renderOffers },
  { id: "suppliers", label: "공급사", render: renderSuppliers },
  { id: "conversions", label: "전환 대사", render: renderConversions, badge: "review_conversions" },
  { id: "adjustments", label: "보상 조정(이중승인)", render: renderAdjustments, badge: "pending_adjustments" },
  { id: "payouts", label: "지급·대사", render: renderPayouts, badge: "unknown_payouts" },
  { id: "users", label: "사용자·동의", render: renderUsers },
  { id: "guardrails", label: "가드레일", render: renderGuardrails },
  { id: "ledger", label: "원장 뷰어", render: renderLedger },
  { id: "audit", label: "감사 로그", render: renderAudit },
];
let DASH = {};

// ---------- 로그인 ----------
$("#loginBtn").addEventListener("click", () => login());
$("#tokenInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login(useStored = false) {
  if (!useStored) TOKEN = ($("#tokenInput").value.trim()) || $("#tokenPreset").value;
  try {
    ME = await api("/admin/v1/session", { method: "POST", body: "{}" });
    localStorage.setItem("admin_token", TOKEN);
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    boot();
  } catch (e) {
    localStorage.removeItem("admin_token");
    if (!useStored) $("#loginErr").textContent = e.title || "로그인 실패";
  }
}
$("#logout").addEventListener("click", () => { localStorage.removeItem("admin_token"); location.reload(); });

async function boot() {
  $("#who").innerHTML = `${esc(ME.name)}<br><span class="muted">${esc(ME.email)} · ${esc(ME.role)}</span>`;
  try { DASH = await api("/admin/v1/dashboard"); } catch { DASH = {}; }
  renderNav();
  go(location.hash.replace("#", "") || "dashboard");
}
window.addEventListener("hashchange", () => go(location.hash.replace("#", "")));

function renderNav() {
  const nav = $("#nav"); nav.innerHTML = "";
  SECTIONS.forEach((s) => {
    const badge = s.badge && DASH[s.badge] ? `<span class="badge">${DASH[s.badge]}</span>` : "";
    nav.appendChild(el(`<a href="#${s.id}" data-id="${s.id}">${s.label}${badge}</a>`));
  });
}
function go(id) {
  const s = SECTIONS.find((x) => x.id === id) || SECTIONS[0];
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === s.id));
  s.render();
}
async function refreshDash() { try { DASH = await api("/admin/v1/dashboard"); renderNav(); } catch {} }

// ---------- 대시보드 ----------
async function renderDashboard() {
  const d = await api("/admin/v1/dashboard"); DASH = d; renderNav();
  const conv = (d.conversions_by_status || []).map((c) => `<span class="tag mut">${c.status}: ${c.c}건</span>`).join(" ");
  const rewards = (d.rewards_by_state || []).map((r) => `<span class="tag mut">${r.state}: ${r.c}건 · ${won(r.amt)}</span>`).join(" ");
  $("#main").innerHTML = `
    <h1>대시보드</h1><p class="sub">유닛 이코노믹스와 무결성 지표를 한눈에.</p>
    <div class="cards">
      <div class="stat"><div class="l">수수료 수익</div><div class="v ok">${won(d.revenue)}</div></div>
      <div class="stat"><div class="l">보상 비용</div><div class="v">${won(d.reward_expense)}</div></div>
      <div class="stat"><div class="l">공헌이익(수익−보상)</div><div class="v ${d.gross_margin >= 0 ? "ok" : "bad"}">${won(d.gross_margin)}</div></div>
      <div class="stat"><div class="l">쿠폰 지급액</div><div class="v">${won(d.payout_expense)}</div></div>
      <div class="stat"><div class="l">가입자</div><div class="v">${d.users}</div></div>
      <div class="stat"><div class="l">원장 균형</div><div class="v ${d.ledger_balanced ? "ok" : "bad"}">${d.ledger_balanced ? "정상" : "불균형!"}</div></div>
      <div class="stat"><div class="l">검토 대기 전환</div><div class="v ${d.review_conversions ? "warn" : ""}">${d.review_conversions}</div></div>
      <div class="stat"><div class="l">UNKNOWN 지급</div><div class="v ${d.unknown_payouts ? "warn" : ""}">${d.unknown_payouts}</div></div>
      <div class="stat"><div class="l">승인 대기 조정</div><div class="v ${d.pending_adjustments ? "warn" : ""}">${d.pending_adjustments}</div></div>
    </div>
    <h2>전환 상태</h2><div>${conv || '<span class="muted">없음</span>'}</div>
    <h2>보상 상태</h2><div>${rewards || '<span class="muted">없음</span>'}</div>`;
}

// ---------- 오퍼 ----------
async function renderOffers() {
  const { offers } = await api("/admin/v1/offers");
  const rows = offers.map((o) => `
    <tr>
      <td>${esc(o.title)}<div class="muted">${esc(o.advertiser_name)} · ${esc(o.category)}</div></td>
      <td>${o.high_risk ? '<span class="tag bad">고위험</span>' : '<span class="tag ok">일반</span>'}</td>
      <td class="money">${won(o.total_cost)}</td>
      <td class="money" style="color:var(--ok)">${won(o.reward_amount)}</td>
      <td class="money">${won(o.commission_amount)}</td>
      <td>${o.auto_renewal ? '<span class="tag warn">자동결제</span>' : "-"}</td>
      <td><span class="tag ${o.status === "active" ? "ok" : "mut"}">${o.status}</span></td>
      <td><div class="actions">
        ${o.status === "active"
          ? `<button class="btn sm warn" data-stop="${o.offer_id}">중단</button>`
          : `<button class="btn sm ok" data-start="${o.offer_id}">노출</button>`}
      </div></td>
    </tr>`).join("");
  $("#main").innerHTML = `<h1>오퍼 관리</h1><p class="sub">필수 필드(예상보상·승인기간·취소·개인정보)가 없으면 노출이 차단됩니다. 고위험 카테고리는 자동추천 제외.</p>
    <div class="panel"><table><thead><tr><th>오퍼</th><th>등급</th><th>총비용</th><th>보상</th><th>수수료</th><th>결제</th><th>상태</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("#main").querySelectorAll("[data-stop]").forEach((b) => b.addEventListener("click", () => offerStatus(b.dataset.stop, "stopped")));
  $("#main").querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => offerStatus(b.dataset.start, "active")));
}
async function offerStatus(id, status) {
  try { await api(`/admin/v1/offers/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }); toast("반영됨"); renderOffers(); }
  catch (e) { toast(e.title + (e.detail ? ` (${e.detail})` : "")); }
}

// ---------- 공급사 ----------
async function renderSuppliers() {
  const { suppliers } = await api("/admin/v1/suppliers");
  const rows = suppliers.map((s) => `
    <tr><td>${esc(s.name)}<div class="muted">${esc(s.supplier_id)}</div></td><td>${esc(s.type)}</td>
      <td>${s.reward_traffic_allowed ? '<span class="tag ok">승인</span>' : '<span class="tag bad">미승인</span>'}</td>
      <td><button class="btn sm" data-id="${s.supplier_id}" data-to="${s.reward_traffic_allowed ? 0 : 1}">${s.reward_traffic_allowed ? "리워드 중단" : "리워드 승인"}</button></td>
    </tr>`).join("");
  $("#main").innerHTML = `<h1>공급사</h1><p class="sub">리워드 트래픽 미승인 공급사의 오퍼는 사용자에게 노출/보상되지 않습니다(예: 쿠팡파트너스).</p>
    <div class="panel"><table><thead><tr><th>공급사</th><th>유형</th><th>리워드</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("#main").querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", async () => {
    await api(`/admin/v1/suppliers/${b.dataset.id}/reward`, { method: "POST", body: JSON.stringify({ allowed: b.dataset.to === "1" }) });
    toast("반영됨"); renderSuppliers();
  }));
}

// ---------- 가드레일 관리 ----------
const CAT_LABEL = { scam: "사기·보이스피싱", crisis: "정서 위기", health: "건강·의료", finance: "투자·금융", legal: "법률", adult: "성인·선정" };
async function renderGuardrails() {
  const d = await api("/admin/v1/guardrails");
  const statMap = {}; (d.stats || []).forEach((s) => { if (s.category) statMap[s.category] = s.count; });
  const cards = d.rules.map((r) => `
    <div class="panel gr-card">
      <div class="gr-head">
        <div><b>${esc(CAT_LABEL[r.category] || r.category)}</b> <span class="tag ${r.level === "critical" ? "bad" : "warn"}">${r.level}</span>
          ${r.customized ? '<span class="tag">수정됨</span>' : ""}
          <div class="muted">최근 감지 ${statMap[r.category] || 0}건</div>
        </div>
        <label class="gr-toggle"><input type="checkbox" data-cat="${r.category}" ${r.enabled ? "checked" : ""}/> <span>${r.enabled ? "켜짐" : "꺼짐"}</span></label>
      </div>
      <label class="gr-l">안내 제목</label>
      <input class="gr-in" data-title="${r.category}" value="${esc(r.title)}"/>
      <label class="gr-l">안내 내용</label>
      <textarea class="gr-in" data-body="${r.category}" rows="3">${esc(r.body)}</textarea>
      <button class="btn sm primary" data-save="${r.category}">저장</button>
    </div>`).join("");
  $("#main").innerHTML = `<h1>가드레일 관리</h1>
    <p class="sub">위험 주제(사기·위기·건강·금융·법률·성인)를 감지하면 광고를 차단하고 사용자에게 안전 안내를 보여줍니다. 카테고리 켜기/끄기와 안내 문구를 조정할 수 있어요. 패턴 자체는 코드에서 관리됩니다.</p>
    <div class="panel"><b>개인정보(PII) 마스킹</b> — 주민번호·카드·계좌 입력 시 자동으로 가려 저장합니다. 최근 감지 <b>${d.piiCount || 0}건</b>.</div>
    <div class="gr-grid">${cards}</div>
    <h2 style="margin-top:22px">최근 안전 감지</h2>
    <div class="panel"><table><thead><tr><th>시각</th><th>사용자</th><th>카테고리</th><th>수준</th><th>PII</th></tr></thead><tbody>
      ${(d.recent || []).map((e) => `<tr><td class="muted">${new Date(e.created_at).toLocaleString("ko-KR")}</td><td>${esc(e.user_id || "-")}</td><td>${esc(CAT_LABEL[e.category] || e.category || "-")}</td><td>${esc(e.level || "-")}</td><td>${e.pii ? "예" : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">감지 내역이 없습니다.</td></tr>'}
    </tbody></table></div>`;

  $("#main").querySelectorAll("[data-save]").forEach((btn) => btn.addEventListener("click", async () => {
    const cat = btn.dataset.save;
    const enabled = $("#main").querySelector(`[data-cat="${cat}"]`).checked;
    const title = $("#main").querySelector(`[data-title="${cat}"]`).value;
    const body = $("#main").querySelector(`[data-body="${cat}"]`).value;
    try { await api(`/admin/v1/guardrails/${cat}`, { method: "POST", body: JSON.stringify({ enabled, title, body }) }); toast("저장됨"); renderGuardrails(); }
    catch (e) { toast(e.title || "저장 실패"); }
  }));
}

// ---------- 전환 대사 ----------
async function renderConversions() {
  const status = renderConversions._status || "";
  const { conversions } = await api("/admin/v1/conversions" + (status ? `?status=${status}` : ""));
  const rows = conversions.map((c) => `
    <tr><td><code>${esc(c.conversion_id.slice(0, 14))}</code><div class="muted">${esc(c.source)}</div></td>
      <td>${esc(c.user_id || "-")}</td>
      <td class="money">${won(c.gross_amount)}</td><td class="money" style="color:var(--ok)">${won(c.reward_amount)}</td>
      <td>${(c.fraud_score).toFixed(2)}</td>
      <td><span class="tag ${c.status === "attributed" ? "ok" : c.status === "review" ? "warn" : c.status === "rejected" ? "bad" : "mut"}">${c.status}</span></td>
      <td><div class="actions">
        ${c.status === "review" ? `<button class="btn sm ok" data-attr="${c.conversion_id}">귀속 승인</button><button class="btn sm bad" data-rej="${c.conversion_id}">거절</button>` : "-"}
      </div></td></tr>`).join("");
  $("#main").innerHTML = `<h1>전환 대사</h1><p class="sub">사기점수로 자동 분류된 전환. review 큐는 수동 귀속/거절합니다.</p>
    <div class="toolbar">
      ${["", "review", "attributed", "rejected"].map((s) => `<button class="btn sm ${s === status ? "primary" : ""}" data-f="${s}">${s || "전체"}</button>`).join("")}
    </div>
    <div class="panel"><table><thead><tr><th>전환</th><th>사용자</th><th>총액</th><th>보상</th><th>사기</th><th>상태</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan=7 class="muted" style="padding:20px">없음</td></tr>'}</tbody></table></div>`;
  $("#main").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { renderConversions._status = b.dataset.f; renderConversions(); }));
  $("#main").querySelectorAll("[data-attr]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/admin/v1/conversions/${b.dataset.attr}/attribute`, { method: "POST", body: "{}" }); toast("귀속·보상 생성됨"); refreshDash(); renderConversions(); } catch (e) { toast(e.title); } }));
  $("#main").querySelectorAll("[data-rej]").forEach((b) => b.addEventListener("click", async () => { await api(`/admin/v1/conversions/${b.dataset.rej}/reject`, { method: "POST", body: JSON.stringify({ reason: "수동 거절" }) }); toast("거절됨"); refreshDash(); renderConversions(); }));
}

// ---------- 이중승인 조정 ----------
async function renderAdjustments() {
  const { adjustments } = await api("/admin/v1/adjustments");
  const rows = adjustments.map((a) => `
    <tr><td><code>${esc(a.case_id.slice(0, 12))}</code></td><td>${esc(a.user_id)}</td>
      <td class="money">${a.direction === "credit" ? "+" : "−"}${won(a.amount)}</td>
      <td>${esc(a.reason)}</td>
      <td class="muted">요청 ${esc(a.requested_by)}<br>${a.approved_by ? "승인 " + esc(a.approved_by) : ""}</td>
      <td><span class="tag ${a.status === "approved" ? "ok" : a.status === "rejected" ? "bad" : "warn"}">${a.status}</span></td>
      <td><div class="actions">${a.status === "requested"
        ? `<button class="btn sm ok" data-ap="${a.case_id}">승인</button><button class="btn sm bad" data-rj="${a.case_id}">반려</button>`
        : "-"}</div></td></tr>`).join("");
  $("#main").innerHTML = `<h1>보상 조정 (이중 승인)</h1><p class="sub">금액 직접 수정은 금지. 요청자와 승인자가 달라야 하며, 5만원 이상은 finance/owner 승인 필요. 모든 조정은 원장 분개로 기록됩니다.</p>
    <div class="toolbar">
      <button class="btn primary" id="newAdj">+ 조정 요청</button>
      <span class="muted">현재 로그인: ${esc(ME.email)} (${esc(ME.role)})</span>
    </div>
    <div class="panel"><table><thead><tr><th>건</th><th>사용자</th><th>금액</th><th>사유</th><th>담당</th><th>상태</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan=7 class="muted" style="padding:20px">없음</td></tr>'}</tbody></table></div>`;
  $("#newAdj").addEventListener("click", () => adjustModal());
  $("#main").querySelectorAll("[data-ap]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/admin/v1/adjustments/${b.dataset.ap}/approve`, { method: "POST", body: "{}" }); toast("승인·원장 반영됨"); refreshDash(); renderAdjustments(); } catch (e) { toast(e.title + (e.detail ? ` (${e.detail})` : "")); } }));
  $("#main").querySelectorAll("[data-rj]").forEach((b) => b.addEventListener("click", async () => { await api(`/admin/v1/adjustments/${b.dataset.rj}/reject`, { method: "POST", body: JSON.stringify({ reason: "반려" }) }); toast("반려됨"); refreshDash(); renderAdjustments(); }));
}
function adjustModal(userId = "usr_demo") {
  const m = el(`<div class="modal-bg"><div class="modal">
    <h2 style="margin-top:0">보상 조정 요청</h2>
    <div class="form-row"><input id="aUser" placeholder="user_id" value="${esc(userId)}"></div>
    <div class="form-row"><select id="aDir"><option value="credit">지급(+)</option><option value="debit">회수(−)</option></select><input id="aAmt" type="number" placeholder="금액(원)"></div>
    <div class="form-row"><input id="aReason" placeholder="내부 사유(감사용)"></div>
    <div class="form-row"><input id="aMsg" placeholder="사용자 표시 설명(선택)"></div>
    <div class="actions" style="justify-content:flex-end"><button class="btn ghost" id="aCancel">취소</button><button class="btn primary" id="aSubmit">요청</button></div>
  </div></div>`);
  document.body.appendChild(m);
  m.querySelector("#aCancel").addEventListener("click", () => m.remove());
  m.querySelector("#aSubmit").addEventListener("click", async () => {
    try {
      await api("/admin/v1/adjustments", { method: "POST", body: JSON.stringify({ userId: m.querySelector("#aUser").value, direction: m.querySelector("#aDir").value, amount: Number(m.querySelector("#aAmt").value), reason: m.querySelector("#aReason").value, userMessage: m.querySelector("#aMsg").value }) });
      m.remove(); toast("요청 등록됨(다른 운영자 승인 필요)"); refreshDash(); renderAdjustments();
    } catch (e) { toast(e.title); }
  });
}

// ---------- 지급·대사 ----------
async function renderPayouts() {
  const { payouts } = await api("/admin/v1/payouts");
  const rows = payouts.map((p) => `
    <tr><td><code>${esc(p.payout_id.slice(0, 12))}</code></td><td>${esc(p.user_id)}</td><td class="money">${won(p.amount)}</td>
      <td>${esc(p.product_id)}</td>
      <td><span class="tag ${p.status === "paid" ? "ok" : p.status === "reversed" ? "bad" : "warn"}">${p.status}</span> ${p.coupon_code ? `<code>${esc(p.coupon_code)}</code>` : ""}</td>
      <td><div class="actions">${p.status === "unknown"
        ? `<button class="btn sm ok" data-paid="${p.payout_id}">지급확정</button><button class="btn sm bad" data-rev="${p.payout_id}">복구</button>` : "-"}</div></td></tr>`).join("");
  $("#main").innerHTML = `<h1>지급 · 대사</h1><p class="sub">UNKNOWN(응답유실) 지급은 재발급 없이 공급자 조회 후 수동 해결합니다. 대사는 원장 지출과 지급액을 대조합니다.</p>
    <div class="toolbar"><button class="btn primary" id="recon">대사 실행</button><span id="reconRes" class="muted"></span></div>
    <div class="panel"><table><thead><tr><th>지급</th><th>사용자</th><th>금액</th><th>상품</th><th>상태</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan=6 class="muted" style="padding:20px">없음</td></tr>'}</tbody></table></div>`;
  $("#recon").addEventListener("click", async () => { const r = await api("/admin/v1/reconciliation/run", { method: "POST", body: "{}" }); $("#reconRes").innerHTML = r.matched ? `<span class="tag ok">일치</span> 지급 ${won(r.paid_sum)} = 원장 ${won(r.ledger_payout_expense)}` : `<span class="tag bad">불일치</span> 지급 ${won(r.paid_sum)} vs 원장 ${won(r.ledger_payout_expense)}`; });
  $("#main").querySelectorAll("[data-paid]").forEach((b) => b.addEventListener("click", async () => { await api(`/admin/v1/payouts/${b.dataset.paid}/resolve`, { method: "POST", body: JSON.stringify({ resolve: "paid" }) }); toast("지급 확정"); refreshDash(); renderPayouts(); }));
  $("#main").querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", async () => { await api(`/admin/v1/payouts/${b.dataset.rev}/resolve`, { method: "POST", body: JSON.stringify({ resolve: "reversed" }) }); toast("잔액 복구"); refreshDash(); renderPayouts(); }));
}

// ---------- 사용자 ----------
async function renderUsers() {
  const { users } = await api("/admin/v1/users");
  const rows = users.map((u) => `<tr><td>${esc(u.display_name)}<div class="muted">${esc(u.user_id)}</div></td><td>${esc(u.age_band)}</td>
    <td><button class="btn sm" data-u="${u.user_id}">상세</button></td></tr>`).join("");
  $("#main").innerHTML = `<h1>사용자 · 동의</h1><p class="sub">목적별 동의, 지갑, 보상 상태를 조회하고 보상 조정을 요청할 수 있습니다.</p>
    <div class="panel"><table><thead><tr><th>사용자</th><th>연령대</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("#main").querySelectorAll("[data-u]").forEach((b) => b.addEventListener("click", () => userModal(b.dataset.u)));
}
async function userModal(userId) {
  const d = await api(`/admin/v1/users/${userId}`);
  const consents = d.consents.map((c) => `<span class="tag ${c.granted ? "ok" : "mut"}">${c.purpose}: ${c.granted ? "동의" : "거부"}</span>`).join(" ");
  const rewards = d.rewards.map((r) => `<tr><td>${esc(r.title)}</td><td><span class="tag mut">${r.state}</span></td><td class="money">${won(r.approved_amount ?? r.expected_amount)}</td>
    <td><div class="actions">${["pending", "approved"].includes(r.state) ? `<button class="btn sm ok" data-adv="${r.reward_transaction_id}">사용가능</button>` : ""}${r.state !== "reversed" && r.state !== "paid" ? `<button class="btn sm bad" data-rev="${r.reward_transaction_id}">취소</button>` : ""}</div></td></tr>`).join("");
  const m = el(`<div class="modal-bg"><div class="modal" style="width:560px">
    <h2 style="margin-top:0">${esc(d.user.display_name)} <span class="muted">${esc(userId)}</span></h2>
    <div class="cards" style="grid-template-columns:1fr 1fr"><div class="stat"><div class="l">사용 가능</div><div class="v ok">${won(d.wallet.available)}</div></div><div class="stat"><div class="l">확인 중</div><div class="v">${won(d.wallet.pending)}</div></div></div>
    <h2>동의</h2><div>${consents || '<span class="muted">없음</span>'}</div>
    <h2>보상</h2><div class="panel"><table><tbody>${rewards || '<tr><td class="muted">없음</td></tr>'}</tbody></table></div>
    <div class="actions" style="justify-content:space-between;margin-top:16px"><button class="btn warn" id="uAdj">보상 조정 요청</button><button class="btn ghost" id="uClose">닫기</button></div>
  </div></div>`);
  document.body.appendChild(m);
  m.querySelector("#uClose").addEventListener("click", () => m.remove());
  m.querySelector("#uAdj").addEventListener("click", () => { m.remove(); adjustModal(userId); });
  m.querySelectorAll("[data-adv]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/admin/v1/rewards/${b.dataset.adv}/advance`, { method: "POST", body: "{}" }); toast("사용가능 전환"); m.remove(); userModal(userId); } catch (e) { toast(e.title); } }));
  m.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", async () => { await api(`/admin/v1/rewards/${b.dataset.rev}/reverse`, { method: "POST", body: JSON.stringify({ reason: "운영 취소" }) }); toast("취소·원장 반영"); m.remove(); userModal(userId); }));
}

// ---------- 원장 ----------
async function renderLedger() {
  const { accounts } = await api("/admin/v1/ledger");
  const total = accounts.reduce((s, a) => s + (a.owner_type === "platform" ? 0 : 0), 0);
  const rows = accounts.map((a) => `<tr><td><code>${esc(a.account_id)}</code></td><td>${esc(a.account_type)}</td>
    <td class="money">${won(a.cr)}</td><td class="money">${won(a.dr)}</td><td class="money" style="color:${a.balance >= 0 ? "var(--ok)" : "var(--bad)"}">${won(a.balance)}</td></tr>`).join("");
  $("#main").innerHTML = `<h1>원장 뷰어</h1><p class="sub">복식부기 계정별 차변·대변·잔액. 모든 거래는 균형(차변합=대변합)을 유지합니다.</p>
    <div class="panel"><table><thead><tr><th>계정</th><th>유형</th><th>대변(credit)</th><th>차변(debit)</th><th>잔액</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- 감사 로그 ----------
async function renderAudit() {
  const { audit } = await api("/admin/v1/audit");
  const rows = audit.map((a) => `<tr><td class="muted">${new Date(a.created_at).toLocaleString("ko-KR")}</td><td>${esc(a.actor)}</td><td><span class="tag mut">${esc(a.action)}</span></td><td><code>${esc(a.target || "")}</code></td><td class="muted">${esc((a.detail || "").slice(0, 80))}</td></tr>`).join("");
  $("#main").innerHTML = `<h1>감사 로그</h1><p class="sub">모든 운영 행위는 변경 불가로 기록됩니다.</p>
    <div class="panel"><table><thead><tr><th>시각</th><th>행위자</th><th>행위</th><th>대상</th><th>상세</th></tr></thead><tbody>${rows || '<tr><td colspan=5 class="muted" style="padding:20px">없음</td></tr>'}</tbody></table></div>`;
}

// 자동 로그인(저장된 토큰)
if (TOKEN) { login(true); }
