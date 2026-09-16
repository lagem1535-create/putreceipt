import { auth, db, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const $ = (selector) => document.querySelector(selector);
const CARD_LABELS = { monthTotal: "이번 달 지출", receiptCount: "저장된 영수증", monthCount: "이번 달 영수증" };
const DEFAULT_SETTINGS = { defaultCategory: "식비", defaultPaymentMethod: "", reminderDays: 3, notificationsEnabled: true, sortOrder: "newest", savePhoto: true, monthlyBudget: 0, cardBannerMode: false, cardOrder: ["monthTotal","receiptCount","monthCount"] };
let currentUser = null;
let cardOrder = [...DEFAULT_SETTINGS.cardOrder];

function renderCardOrderList(){
  const list = $("#cardOrderList"); if (!list) return;
  list.innerHTML = cardOrder.map((key, i) => `<li class="reorder-item" data-card="${key}"><span>${CARD_LABELS[key]}</span><div class="reorder-btns"><button class="reorder-btn" data-dir="up" data-index="${i}" type="button" ${i===0?"disabled":""}>▲</button><button class="reorder-btn" data-dir="down" data-index="${i}" type="button" ${i===cardOrder.length-1?"disabled":""}>▼</button></div></li>`).join("");
}
$("#cardOrderList")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".reorder-btn"); if (!btn) return;
  const i = Number(btn.dataset.index);
  const j = btn.dataset.dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= cardOrder.length) return;
  [cardOrder[i], cardOrder[j]] = [cardOrder[j], cardOrder[i]];
  renderCardOrderList();
});

function showStatus(text, error = false) {
  const el = $("#saveStatus"); if (!el) return;
  el.textContent = text;
  el.className = `message ${error ? "error" : "success"}`;
}

async function loadSettings(uid) {
  try {
    const snapshot = await get(ref(db, `users/${uid}/settings`));
    const settings = { ...DEFAULT_SETTINGS, ...(snapshot.val() || {}) };
    if ($("#defaultCategoryInput")) $("#defaultCategoryInput").value = settings.defaultCategory;
    if ($("#defaultPaymentInput")) $("#defaultPaymentInput").value = settings.defaultPaymentMethod;
    if ($("#sortOrderInput")) $("#sortOrderInput").value = settings.sortOrder;
    if ($("#savePhotoInput")) $("#savePhotoInput").checked = !!settings.savePhoto;
    if ($("#monthlyBudgetInput")) $("#monthlyBudgetInput").value = settings.monthlyBudget > 0 ? settings.monthlyBudget : "";
    if ($("#reminderDaysInput")) $("#reminderDaysInput").value = String(settings.reminderDays);
    if ($("#notificationsEnabledInput")) $("#notificationsEnabledInput").checked = !!settings.notificationsEnabled;
    if ($("#cardBannerModeInput")) $("#cardBannerModeInput").checked = !!settings.cardBannerMode;
    const known = DEFAULT_SETTINGS.cardOrder;
    cardOrder = Array.isArray(settings.cardOrder) && settings.cardOrder.length === known.length && known.every(k => settings.cardOrder.includes(k)) ? [...settings.cardOrder] : [...known];
    renderCardOrderList();
  } catch (error) {
    showStatus(`설정을 불러오지 못했습니다.\n${error.message || ""}`, true);
  }
}

async function saveSettings() {
  if (!currentUser) return;
  const nickname = $("#nicknameInput")?.value.trim() || "";
  const payload = {
    defaultCategory: $("#defaultCategoryInput")?.value || "식비",
    defaultPaymentMethod: $("#defaultPaymentInput")?.value.trim() || "",
    sortOrder: $("#sortOrderInput")?.value || "newest",
    savePhoto: !!$("#savePhotoInput")?.checked,
    monthlyBudget: Number($("#monthlyBudgetInput")?.value) || 0,
    reminderDays: Number($("#reminderDaysInput")?.value) || 3,
    notificationsEnabled: !!$("#notificationsEnabledInput")?.checked,
    cardBannerMode: !!$("#cardBannerModeInput")?.checked,
    cardOrder: [...cardOrder],
  };
  const button = $("#saveSettingsBtn"); if (button) button.disabled = true;
  showStatus("저장하는 중...");
  try {
    await update(ref(db, `users/${currentUser.uid}/settings`), payload);
    if (nickname !== (currentUser.displayName || "")) {
      await updateProfile(currentUser, { displayName: nickname });
    }
    showStatus("설정이 저장되었습니다.");
  } catch (error) {
    showStatus(`저장에 실패했습니다.\n${error.message || "잠시 후 다시 시도해주세요."}`, true);
  } finally {
    if (button) button.disabled = false;
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.replace("../login/"); return; }
  currentUser = user;
  if ($("#emailDisplay")) $("#emailDisplay").value = user.email || "";
  if ($("#nicknameInput")) $("#nicknameInput").value = user.displayName || "";
  loadSettings(user.uid);
});

$("#saveSettingsBtn")?.addEventListener("click", saveSettings);
$("#logoutBtn")?.addEventListener("click", async () => {
  try { await authPersistenceReady; await signOut(auth); window.location.replace("../login/"); }
  catch (error) { window.alert(`로그아웃에 실패했습니다.\n${error.message || "잠시 후 다시 시도해주세요."}`); }
});
