import { auth, db, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const $ = (selector) => document.querySelector(selector);
const DEFAULT_SETTINGS = { defaultCategory: "식비", defaultPaymentMethod: "", reminderDays: 3, notificationsEnabled: true };
let currentUser = null;

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
    if ($("#reminderDaysInput")) $("#reminderDaysInput").value = String(settings.reminderDays);
    if ($("#notificationsEnabledInput")) $("#notificationsEnabledInput").checked = !!settings.notificationsEnabled;
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
    reminderDays: Number($("#reminderDaysInput")?.value) || 3,
    notificationsEnabled: !!$("#notificationsEnabledInput")?.checked,
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
