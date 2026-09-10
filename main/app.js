import { auth, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, push, set, onValue, remove } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const db = getDatabase();
let receipts = [];
let currentUser = null;
const list = document.querySelector("#receiptList");
const search = document.querySelector("#searchInput");
const filter = document.querySelector("#categoryFilter");
const modal = document.querySelector("#scanModal");

function won(n) {
  return new Intl.NumberFormat("ko-KR").format(Number(n) || 0) + "원";
}

function render() {
  const q = search.value.trim().toLowerCase();
  const category = filter.value;
  const filtered = receipts.filter(r =>
    (category === "all" || r.category === category) &&
    (`${r.store || ""} ${r.item || ""}`.toLowerCase().includes(q))
  );

  list.innerHTML = filtered.length ? filtered.map(r => `
    <article class="receipt-row">
      <div class="receipt-icon">▣</div>
      <div class="receipt-info">
        <strong>${escapeHtml(r.store)}</strong>
        <span>${escapeHtml(r.item)} · ${escapeHtml(r.category)}</span>
      </div>
      <div class="receipt-date">${escapeHtml(r.date)}</div>
      <strong class="receipt-amount">${won(r.amount)}</strong>
      <button class="delete-receipt" data-id="${escapeHtml(r.id)}" type="button">삭제</button>
    </article>`).join("") : `<div class="empty">아직 영수증이 없습니다.<br><span>영수증 추가 버튼으로 첫 영수증을 저장해보세요.</span></div>`;

  const month = new Date().toISOString().slice(0, 7);
  const monthReceipts = receipts.filter(r => String(r.date || "").startsWith(month));
  document.querySelector("#monthTotal").textContent = won(monthReceipts.reduce((s, r) => s + Number(r.amount || 0), 0));
  document.querySelector("#receiptCount").textContent = `${receipts.length}장`;
  document.querySelector("#monthCount").textContent = `${monthReceipts.length}장`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[c]));
}

function listenReceipts(uid) {
  const receiptsRef = ref(db, `users/${uid}/receipts`);
  onValue(receiptsRef, snapshot => {
    const data = snapshot.val() || {};
    receipts = Object.entries(data).map(([id, receipt]) => ({ id, ...receipt }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    render();
  }, error => {
    console.error("영수증 불러오기 실패:", error);
    list.innerHTML = `<div class="empty">영수증을 불러오지 못했습니다.<br><span>${escapeHtml(error.message)}</span></div>`;
  });
}

async function saveReceiptToFirebase(receipt) {
  if (!currentUser) throw new Error("로그인 상태가 아닙니다.");
  const receiptRef = push(ref(db, `users/${currentUser.uid}/receipts`));
  await set(receiptRef, receipt);
}

async function deleteReceipt(id) {
  if (!currentUser || !id) return;
  if (!confirm("이 영수증을 삭제할까요?")) return;
  try {
    await remove(ref(db, `users/${currentUser.uid}/receipts/${id}`));
  } catch (error) {
    alert(`영수증 삭제에 실패했습니다.\n${error.message || "Firebase 설정을 확인해주세요."}`);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../login/");
    return;
  }
  currentUser = user;
  const nickname = user.displayName?.trim() || user.email?.split("@")[0] || "사용자";
  document.querySelector("#welcomeMessage").textContent = `${nickname}님 안녕하세요`;
  document.querySelector("#userEmail").textContent = user.email || "";
  listenReceipts(user.uid);
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

list.addEventListener("click", event => {
  const button = event.target.closest(".delete-receipt");
  if (button) deleteReceipt(button.dataset.id);
});

document.querySelector("#saveReceipt").addEventListener("click", async () => {
  if (!currentUser) return alert("로그인 상태를 확인해주세요.");
  const store = document.querySelector("#storeInput").value.trim();
  const amount = Number(document.querySelector("#amountInput").value);
  const category = document.querySelector("#categoryInput").value;
  const item = document.querySelector("#itemInput").value.trim() || "상품 정보 없음";
  if (!store || !amount) return alert("가게명과 금액을 입력해주세요.");

  const receipt = {
    store,
    item,
    amount,
    category,
    date: new Date().toISOString().slice(0, 10)
  };

  try {
    await saveReceiptToFirebase(receipt);
    ["storeInput", "amountInput", "itemInput"].forEach(id => {
      document.querySelector(`#${id}`).value = "";
    });
    modal.classList.add("hidden");
  } catch (error) {
    alert(`영수증 저장에 실패했습니다.\n${error.message || "Firebase 설정을 확인해주세요."}`);
  }
});
