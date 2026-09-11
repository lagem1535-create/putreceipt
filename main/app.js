import { auth, db, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, push, set, onValue, remove, update } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const $ = (selector) => document.querySelector(selector);
let receipts = [];
let currentUser = null;
let editingId = null;
let stopReceipts = null;

const list = $("#receiptList");
const search = $("#searchInput");
const filter = $("#categoryFilter");
const modal = $("#scanModal");
const editModal = $("#editModal");
const syncBadge = $(".live-badge");

function won(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0) + "원";
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function receiptDateTime(receipt) {
  const date = receipt?.date || "1970-01-01";
  const time = receipt?.time || "00:00";
  return new Date(`${date}T${time}:00`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function setSyncStatus(text, online = true) {
  if (!syncBadge) return;
  syncBadge.textContent = text;
  syncBadge.style.color = online ? "#19905a" : "#c24141";
  syncBadge.style.background = online ? "#f2fdf7" : "#fff5f5";
  syncBadge.style.borderColor = online ? "#d9f4e6" : "#f2d7d7";
}

function render() {
  if (!list || !search || !filter) return;

  const query = search.value.trim().toLowerCase();
  const category = filter.value;
  const filtered = receipts.filter((receipt) => {
    const matchesCategory = category === "all" || receipt.category === category;
    const text = `${receipt.store || ""} ${receipt.item || ""}`.toLowerCase();
    return matchesCategory && text.includes(query);
  });

  list.innerHTML = filtered.length
    ? filtered.map((receipt) => `
      <article class="receipt-row">
        <div class="receipt-icon">₩</div>
        <div class="receipt-info">
          <strong>${escapeHtml(receipt.store)}</strong>
          <span>${escapeHtml(receipt.item)} · ${escapeHtml(receipt.category)}</span>
        </div>
        <div class="receipt-date">${escapeHtml(receipt.date)} ${escapeHtml(receipt.time || "")}</div>
        <strong class="receipt-amount">${won(receipt.amount)}</strong>
        <div class="receipt-actions">
          <button class="edit-receipt" data-id="${escapeHtml(receipt.id)}" type="button">수정</button>
          <button class="delete-receipt" data-id="${escapeHtml(receipt.id)}" type="button">삭제</button>
        </div>
      </article>`).join("")
    : `<div class="empty">아직 영수증이 없습니다.<br><span>영수증 추가 버튼으로 첫 영수증을 저장해보세요.</span></div>`;

  const month = localDate().slice(0, 7);
  const monthReceipts = receipts.filter((receipt) => String(receipt.date || "").startsWith(month));
  const monthTotal = $("#monthTotal");
  const receiptCount = $("#receiptCount");
  const monthCount = $("#monthCount");
  if (monthTotal) monthTotal.textContent = won(monthReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0));
  if (receiptCount) receiptCount.textContent = `${receipts.length}장`;
  if (monthCount) monthCount.textContent = `${monthReceipts.length}장`;
}

function listenReceipts(uid) {
  if (stopReceipts) stopReceipts();

  const receiptsRef = ref(db, `users/${uid}/receipts`);
  setSyncStatus("Firebase 연결 중...", false);

  stopReceipts = onValue(receiptsRef, (snapshot) => {
    const data = snapshot.val() || {};
    receipts = Object.entries(data)
      .map(([id, receipt]) => ({ id, ...(receipt || {}) }))
      .sort((a, b) => receiptDateTime(b) - receiptDateTime(a));
    render();
    setSyncStatus("Firebase 동기화됨", true);
  }, (error) => {
    console.error(error);
    setSyncStatus("Firebase 연결 실패", false);
    if (list) list.innerHTML = `<div class="empty">Firebase에서 영수증을 불러오지 못했습니다.<br><span>${escapeHtml(error.message)}</span></div>`;
  });
}

async function saveReceipt(receipt) {
  if (!currentUser) throw new Error("로그인 상태가 아닙니다.");
  await set(push(ref(db, `users/${currentUser.uid}/receipts`)), receipt);
}

async function deleteReceipt(id) {
  if (!currentUser || !id) return;
  if (!window.confirm("이 영수증을 삭제할까요?")) return;
  try {
    setSyncStatus("Firebase 저장 중...", false);
    await remove(ref(db, `users/${currentUser.uid}/receipts/${id}`));
    setSyncStatus("Firebase 동기화됨", true);
  } catch (error) {
    setSyncStatus("Firebase 연결 실패", false);
    window.alert(`영수증 삭제에 실패했습니다.\n${error.message || "Firebase 설정을 확인해주세요."}`);
  }
}

function openEdit(id) {
  const receipt = receipts.find((item) => item.id === id);
  if (!receipt || !editModal) return;

  editingId = id;
  const store = $("#editStoreInput");
  const amount = $("#editAmountInput");
  const category = $("#editCategoryInput");
  const item = $("#editItemInput");
  const date = $("#editDateInput");
  const time = $("#editTimeInput");

  if (store) store.value = receipt.store || "";
  if (amount) amount.value = Number(receipt.amount) || "";
  if (category) category.value = receipt.category || "기타";
  if (item) item.value = receipt.item || "";
  if (date) date.value = receipt.date || localDate();
  if (time) time.value = receipt.time || "00:00";
  editModal.classList.remove("hidden");
}

function closeModal(target) {
  if (target) target.classList.add("hidden");
}

function closeEdit() {
  editingId = null;
  closeModal(editModal);
}

async function updateReceipt() {
  if (!currentUser || !editingId) return;

  const store = $("#editStoreInput")?.value.trim();
  const amount = Number($("#editAmountInput")?.value);
  const category = $("#editCategoryInput")?.value || "기타";
  const item = $("#editItemInput")?.value.trim() || "상품 정보 없음";
  const date = $("#editDateInput")?.value;
  const time = $("#editTimeInput")?.value || "00:00";

  if (!store || !amount || !date) {
    window.alert("가게명, 금액, 날짜를 입력해주세요.");
    return;
  }

  try {
    setSyncStatus("Firebase 저장 중...", false);
    await update(ref(db, `users/${currentUser.uid}/receipts/${editingId}`), {
      store, amount, category, item, date, time
    });
    closeEdit();
    setSyncStatus("Firebase 동기화됨", true);
  } catch (error) {
    setSyncStatus("Firebase 연결 실패", false);
    window.alert(`영수증 수정에 실패했습니다.\n${error.message || "Firebase 설정을 확인해주세요."}`);
  }
}

function openAddModal() {
  if (!modal) return;
  const now = new Date();
  const date = $("#dateInput");
  const time = $("#timeInput");
  if (date) date.value = localDate(now);
  if (time) time.value = localTime(now);
  modal.classList.remove("hidden");
  setTimeout(() => $("#storeInput")?.focus(), 0);
}

async function handleSave() {
  if (!currentUser) {
    window.alert("로그인 상태를 확인해주세요.");
    return;
  }

  const store = $("#storeInput")?.value.trim();
  const amount = Number($("#amountInput")?.value);
  const category = $("#categoryInput")?.value || "기타";
  const item = $("#itemInput")?.value.trim() || "상품 정보 없음";
  const date = $("#dateInput")?.value || localDate();
  const time = $("#timeInput")?.value || localTime();

  if (!store || !amount) {
    window.alert("가게명과 금액을 입력해주세요.");
    return;
  }

  const button = $("#saveReceipt");
  if (button) button.disabled = true;

  try {
    setSyncStatus("Firebase 저장 중...", false);
    await saveReceipt({ store, item, amount, category, date, time });
    ["storeInput", "amountInput", "itemInput"].forEach((id) => {
      const input = $(`#${id}`);
      if (input) input.value = "";
    });
    closeModal(modal);
    setSyncStatus("Firebase 동기화됨", true);
  } catch (error) {
    setSyncStatus("Firebase 저장 실패", false);
    window.alert(`영수증 저장에 실패했습니다.\n${error.message || "Firebase 설정을 확인해주세요."}`);
  } finally {
    if (button) button.disabled = false;
  }
}

// 인증 상태가 확인된 뒤에만 사용자 영수증을 구독합니다.
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("../login/");
    return;
  }

  currentUser = user;
  const nickname = user.displayName?.trim() || user.email?.split("@")[0] || "사용자";
  const welcome = $("#welcomeMessage");
  const email = $("#userEmail");
  if (welcome) welcome.textContent = `${nickname}님 안녕하세요`;
  if (email) email.textContent = user.email || "";

  const now = new Date();
  const dateInput = $("#dateInput");
  const timeInput = $("#timeInput");
  if (dateInput) dateInput.value = localDate(now);
  if (timeInput) timeInput.value = localTime(now);

  listenReceipts(user.uid);
});

// Firebase 자체 연결 상태도 별도로 표시합니다.
onValue(ref(db, ".info/connected"), (snapshot) => {
  if (snapshot.val() === true) setSyncStatus("Firebase 연결됨", true);
  else setSyncStatus("Firebase 오프라인", false);
});

$("#logoutBtn")?.addEventListener("click", async () => {
  const button = $("#logoutBtn");
  if (button) button.disabled = true;
  try {
    await authPersistenceReady;
    await signOut(auth);
    window.location.replace("../login/");
  } catch (error) {
    if (button) button.disabled = false;
    window.alert(`로그아웃에 실패했습니다.\n${error.message || "잠시 후 다시 시도해주세요."}`);
  }
});

$("#scanBtn")?.addEventListener("click", openAddModal);
$("#closeModal")?.addEventListener("click", () => closeModal(modal));
$("#closeEditModal")?.addEventListener("click", closeEdit);
$("#cancelEdit")?.addEventListener("click", closeEdit);
$("#saveReceipt")?.addEventListener("click", handleSave);
$("#updateReceipt")?.addEventListener("click", updateReceipt);
search?.addEventListener("input", render);
filter?.addEventListener("change", render);

list?.addEventListener("click", (event) => {
  const editButton = event.target.closest(".edit-receipt");
  const deleteButton = event.target.closest(".delete-receipt");
  if (editButton) openEdit(editButton.dataset.id);
  if (deleteButton) deleteReceipt(deleteButton.dataset.id);
});

modal?.addEventListener("click", (event) => {
  if (event.target === modal) closeModal(modal);
});
editModal?.addEventListener("click", (event) => {
  if (event.target === editModal) closeEdit();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal(modal);
    closeEdit();
  }
});

render();
