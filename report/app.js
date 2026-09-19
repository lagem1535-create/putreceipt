import { auth, db, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { summarizeExpenses } from "../ai/engine.js";

const $ = (selector) => document.querySelector(selector);
const DOC_TYPE_KOREAN = { receipt: "영수증", medicine: "약 봉투", warranty: "보증서" };
let receipts = [];
let preset = "thisMonth";

function won(value) { return new Intl.NumberFormat("ko-KR").format(Number(value) || 0) + "원"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function receiptDateTime(r) { return new Date(`${r?.date || "1970-01-01"}T${r?.time || "00:00"}:00`); }

function presetRange(name) {
  const now = new Date();
  if (name === "thisMonth") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: localDate(from), to: localDate(now) };
  }
  if (name === "lastMonth") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: localDate(from), to: localDate(to) };
  }
  if (name === "thisYear") {
    return { from: `${now.getFullYear()}-01-01`, to: localDate(now) };
  }
  return { from: "", to: "" };
}

function currentRange() {
  return { from: $("#rangeFrom")?.value || "", to: $("#rangeTo")?.value || "" };
}

function filteredReceipts() {
  const { from, to } = currentRange();
  const settlementOnly = $("#settlementOnlyInput")?.checked;
  return receipts.filter(r => {
    if (from && (r.date || "") < from) return false;
    if (to && (r.date || "") > to) return false;
    if (settlementOnly && !r.settlement) return false;
    return true;
  }).sort((a, b) => receiptDateTime(a) - receiptDateTime(b));
}

function updateSettlementSummary() {
  const { from, to } = currentRange();
  const inRange = receipts.filter(r => (!from || (r.date||"") >= from) && (!to || (r.date||"") <= to));
  const settleList = inRange.filter(r => r.settlement);
  const total = settleList.reduce((s,r)=>s+Number(r.amount||0),0);
  const el = $("#reportSettlementSummary");
  if (!el) return;
  el.textContent = settleList.length ? `정산 대상 ${settleList.length}건 · ${won(total)}` : "정산 대상으로 표시된 영수증이 없습니다.";
}

function computeStats(list, total) {
  const byCategory = {};
  list.forEach(r => { const c = r.category || "기타"; byCategory[c] = (byCategory[c]||0) + Number(r.amount||0); });
  const sorted = Object.entries(byCategory).map(([c, v]) => ({ c, v })).sort((a, b) => b.v - a.v);
  const { from, to } = currentRange();
  return { from: from || "전체", to: to || "전체", total, count: list.length, avg: list.length ? Math.round(total / list.length) : 0, byCategory: sorted };
}

function buildSummaryText(list, total) {
  if (!list.length) return "이 기간에 저장된 영수증이 없습니다.";
  const stats = computeStats(list, total);
  const top = stats.byCategory[0];
  const { from, to } = currentRange();
  const periodText = from && to ? `${from}부터 ${to}까지` : "선택한 기간 동안";
  const topText = top ? ` 가장 지출이 큰 카테고리는 ${top.c}(${won(top.v)})입니다.` : "";
  return `${periodText} 총 ${list.length}건의 영수증에서 ${won(total)}을 지출했습니다. 평균 결제 금액은 ${won(stats.avg)}입니다.${topText}`;
}

function formatIssueDate(date = new Date()) { return `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일`; }

function updateDocMeta() {
  if ($("#reportIssueDate")) $("#reportIssueDate").textContent = formatIssueDate();
  const { from, to } = currentRange();
  let periodLabel = "전체 기간";
  if (from && to) periodLabel = `${from} ~ ${to}`;
  else if (from) periodLabel = `${from} 이후`;
  else if (to) periodLabel = `${to} 까지`;
  if ($("#reportPeriodLabel")) $("#reportPeriodLabel").textContent = periodLabel;
}

function render() {
  updateDocMeta();
  updateSettlementSummary();
  const list = filteredReceipts();
  const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);
  if ($("#reportTotal")) $("#reportTotal").textContent = won(total);
  if ($("#reportCount")) $("#reportCount").textContent = `${list.length}장`;
  if ($("#reportAvg")) $("#reportAvg").textContent = won(list.length ? total / list.length : 0);
  if ($("#reportSummaryText")) $("#reportSummaryText").textContent = buildSummaryText(list, total);
  if ($("#aiSummaryStatus")) $("#aiSummaryStatus").classList.add("hidden");

  renderBreakdown("#reportCategoryBreakdown", list, r => r.category || "기타");
  renderBreakdown("#reportPaymentBreakdown", list, r => r.paymentMethod || "미입력");

  const body = $("#reportTableBody");
  if (body) {
    body.innerHTML = list.length ? list.map(r => `<tr><td>${escapeHtml(r.date)} ${escapeHtml(r.time || "")}</td><td>${escapeHtml(r.store)}</td><td>${escapeHtml(r.category)}</td><td>${DOC_TYPE_KOREAN[r.docType||"receipt"]||"영수증"}</td><td>${escapeHtml(r.paymentMethod || "-")}</td><td class="num">${won(r.amount)}</td></tr>`).join("")
      : `<tr><td colspan="6"><div class="report-empty">이 기간에 저장된 영수증이 없습니다.</div></td></tr>`;
  }
  if ($("#reportTableTotal")) $("#reportTableTotal").textContent = won(total);
}

function renderBreakdown(selector, list, keyFn) {
  const el = $(selector); if (!el) return;
  const groups = {};
  list.forEach(r => { const key = keyFn(r); groups[key] = (groups[key] || 0) + Number(r.amount || 0); });
  const totals = Object.entries(groups).map(([c, v]) => ({ c, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (!totals.length) { el.innerHTML = `<div class="report-empty">데이터가 없습니다.</div>`; return; }
  const max = Math.max(...totals.map(x => x.v));
  el.innerHTML = totals.map(x => `<div class="cat-row"><span class="cat-name">${escapeHtml(x.c)}</span><div class="cat-track"><div class="cat-fill" style="width:${Math.max(x.v / max * 100, 4)}%"></div></div><span class="cat-amount">${won(x.v)}</span></div>`).join("");
}

function applyPreset(name) {
  preset = name;
  document.querySelectorAll(".preset-btn").forEach(b => b.classList.toggle("active", b.dataset.preset === name));
  const { from, to } = presetRange(name);
  if ($("#rangeFrom")) $("#rangeFrom").value = from;
  if ($("#rangeTo")) $("#rangeTo").value = to;
  render();
}

function toCsvValue(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function exportCsv() {
  const list = filteredReceipts();
  if (!list.length) return window.alert("내보낼 영수증이 없습니다.");
  const header = ["날짜", "시간", "가게명", "카테고리", "문서종류", "결제수단", "금액", "정산대상"];
  const lines = [header.map(toCsvValue).join(",")];
  list.forEach(r => lines.push([r.date || "", r.time || "", r.store || "", r.category || "", DOC_TYPE_KOREAN[r.docType||"receipt"]||"영수증", r.paymentMethod || "", Number(r.amount) || 0, r.settlement?"Y":"N"].map(toCsvValue).join(",")));
  const { from, to } = currentRange();
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `영수증모아_보고서_${from || "전체"}_${to || "전체"}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

document.querySelectorAll(".preset-btn").forEach(btn => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
$("#rangeFrom")?.addEventListener("change", () => { document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active")); render(); });
$("#rangeTo")?.addEventListener("change", () => { document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active")); render(); });
$("#printReportBtn")?.addEventListener("click", () => window.print());
$("#exportReportCsvBtn")?.addEventListener("click", exportCsv);
$("#settlementOnlyInput")?.addEventListener("change", render);

$("#aiSummaryBtn")?.addEventListener("click", async () => {
  const list = filteredReceipts();
  if (!list.length) return window.alert("이 기간에는 요약할 영수증이 없습니다.");
  const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);
  const stats = computeStats(list, total);
  const btn = $("#aiSummaryBtn"), status = $("#aiSummaryStatus");
  if (btn) btn.disabled = true;
  status?.classList.remove("hidden");
  if (status) status.textContent = "AI 모델을 불러오는 중입니다 (처음 실행 시 다소 시간이 걸릴 수 있어요)...";
  try {
    const text = await summarizeExpenses(stats, (pct, label) => { if (status) status.textContent = `${label} 다운로드 중... ${pct}%`; });
    if (text && $("#reportSummaryText")) $("#reportSummaryText").textContent = text;
    if (status) status.textContent = "AI 요약이 생성되었습니다.";
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "AI 모델을 불러오지 못해 기본 요약을 표시합니다. (네트워크 상태나 브라우저 호환성을 확인해주세요)";
  } finally {
    if (btn) btn.disabled = false;
  }
});

async function handleLogout() { try { await authPersistenceReady; await signOut(auth); window.location.replace("../login/"); } catch (error) { window.alert(`로그아웃에 실패했습니다.\n${error.message || "잠시 후 다시 시도해주세요."}`); } }
$("#logoutBtn")?.addEventListener("click", handleLogout);
$("#mobileLogoutBtn")?.addEventListener("click", handleLogout);

let stopReceipts = null;
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.replace("../login/"); return; }
  if ($("#reportAuthor")) $("#reportAuthor").textContent = user.displayName || user.email || "-";
  if (stopReceipts) stopReceipts();
  stopReceipts = onValue(ref(db, `users/${user.uid}/receipts`), (snapshot) => {
    const data = snapshot.val() || {};
    receipts = Object.entries(data).map(([id, r]) => ({ id, ...(r || {}) }));
    render();
  });
});

applyPreset("thisMonth");
