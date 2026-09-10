import { auth, db, authPersistenceReady } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const form = document.querySelector("#loginForm");
const nickname = document.querySelector("#nickname");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const signupBtn = document.querySelector("#signupBtn");
const resetBtn = document.querySelector("#resetBtn");
const message = document.querySelector("#message");
let redirecting = false;

function showMessage(text, error = false) {
  message.textContent = text;
  message.className = `message ${error ? "error" : "success"}`;
}

function goMain() {
  if (redirecting) return;
  redirecting = true;
  window.location.replace("../main/");
}

async function waitForAuthPersistence() {
  await authPersistenceReady;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("로그인 중...");
  try {
    await waitForAuthPersistence();
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    showMessage("로그인되었습니다.");
    goMain();
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

signupBtn.addEventListener("click", async () => {
  const nicknameValue = nickname.value.trim();
  const emailValue = email.value.trim();
  if (!nicknameValue || !emailValue || !password.value) {
    showMessage("회원가입할 때는 닉네임, 이메일, 비밀번호를 입력해주세요.", true);
    return;
  }

  try {
    showMessage("회원가입 중...");
    await waitForAuthPersistence();

    const credential = await createUserWithEmailAndPassword(auth, emailValue, password.value);
    const user = credential.user;

    // Firebase Authentication 프로필에도 닉네임 저장
    await updateProfile(user, { displayName: nicknameValue });

    // Realtime Database에도 사용자 정보를 저장
    await set(ref(db, `users/${user.uid}/profile`), {
      nickname: nicknameValue,
      email: user.email || emailValue,
      createdAt: new Date().toISOString()
    });

    showMessage("회원가입되었습니다.");
    goMain();
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

resetBtn.addEventListener("click", async () => {
  const emailValue = email.value.trim();
  if (!emailValue) {
    showMessage("비밀번호를 재설정할 이메일을 입력해주세요.", true);
    return;
  }
  try {
    await sendPasswordResetEmail(auth, emailValue);
    showMessage("비밀번호 재설정 이메일을 보냈습니다.");
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) goMain();
});

function firebaseErrorMessage(code) {
  const messages = {
    "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "auth/user-not-found": "가입된 계정을 찾을 수 없습니다.",
    "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
    "auth/email-already-in-use": "이미 가입된 이메일입니다.",
    "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/too-many-requests": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
    "auth/operation-not-allowed": "Firebase에서 이메일/비밀번호 로그인을 먼저 활성화해주세요.",
    "auth/network-request-failed": "네트워크 연결을 확인해주세요.",
    "auth/unauthorized-domain": "현재 사이트 주소가 Firebase 인증 허용 도메인에 등록되지 않았습니다."
  };
  return messages[code] || `오류가 발생했습니다. (${code})`;
}
