import { auth, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const demoKeyPrefix = "receipt-moa-";
const initialReceipts = [
  { store: "스타벅스", item: "아메리카노", amount: 5500, category: "카페", date: "2026-09-09" },
  { store: "이마트", item: "식료품", amount: 38200, category: "쇼핑", date: "2026-09-08" },
  { store: "올리브영", item: "생활용품", amount: 21900, category: "쇼핑", date: "2026-09-06" }
];

let receipts = [];
let storageKey = demoKeyPrefix + "guest";
let currentUser = null;
const list = document.querySelector("#receiptList");
const search = document.querySelector("#searchInput");
const filter = document.querySelector("#categoryFilter");
const modal = document.querySelector("#scanModal");

function loadReceipts(uid) {
  storageKey = demoKeyPrefix + uid;
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) {
    try { receipts = JSON.parse(saved) || []; } catch { receipts = []; }
  } else {
    receipts = [...initialReceipts];
    save();
  }
}

function save() {
  if (!currentUser) return;
  localStorage.setItem(storageKey, JSON.stringify(receipts));
}

function won(n) {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}

function render() {
  const q = search.value.trim().toLowerCase();
  const category = filter.value;
  const filtered = receipts.filter(r =>
    (category === "all" || r.category === category) &&
    (`${r.store} ${r.item}`.toLowerCase().includes(q))
  );

  list.innerHTML = filtered.length
    ? filtered.map(r => `
      <article class="receipt-row">
        <div class="receipt-icon">▣</div>
        <div class="receipt-info">
          <strong>${escapeHtml(r.store)}</strong>
          <span>${escapeHtml(r.item)} · ${escapeHtml(r.category)}</span>
        </div>
        <div class="receipt-date">${escapeHtml(r.date)}</div>
        <strong class="receipt-amount">${won(r.amount)}</strong>
      </article>`).join("")
    : `<div class="empty">아직 영수증이 없습니다.<br><span>영수증 추가 버튼으로 첫 영수증을 저장해보세요.</span></div>`;

  const month = new Date().toISOString().slice(0, 7);
  const monthReceipts = receipts.filter(r => r.date.startsWith(month));
  document.querySelector("#monthTotal").textContent = won(monthReceipts.reduce((s, r) => s + r.amount, 0));
  document.querySelector("#receiptCount").textContent = `${receipts.length}장`;
  document.querySelector("#monthCount").textContent = `${monthReceipts.length}장`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[c]));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../login/");
    return;
  }
  currentUser = user;
  document.querySelector("#userEmail").textContent = user.email || "로그인 사용자";
  loadReceipts(user.uid);
  render();
});

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  try {
    await authPersistenceReady;
    await signOut(auth);
  } finally {
    window.location.replace("../login/");
  }
});

document.querySelector("#scanBtn").addEventListener("click", () => modal.classList.remove("hidden"));
document.querySelector("#closeModal").addEventListener("click", () => modal.classList.add("hidden"));
search.addEventListener("input", render);
filter.addEventListener("change", render);

document.querySelector("#saveReceipt").addEventListener("click", () => {
  if (!currentUser) return alert("로그인 상태를 확인해주세요.");
  const store = document.querySelector("#storeInput").value.trim();
  const amount = Number(document.querySelector("#amountInput").value);
  const category = document.querySelector("#categoryInput").value;
  const item = document.querySelector("#itemInput").value.trim() || "상품 정보 없음";
  if (!store || !amount) return alert("가게명과 금액을 입력해주세요.");
  receipts.unshift({ store, item, amount, category, date: new Date().toISOString().slice(0, 10) });
  save();
  ["storeInput", "amountInput", "itemInput"].forEach(id => document.querySelector(`#${id}`).value = "");
  modal.classList.add("hidden");
  render();
});

document.querySelector("#clearDemoBtn").addEventListener("click", () => {
  receipts = [];
  save();
  render();
});
