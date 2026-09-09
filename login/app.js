import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Firebase Console > 프로젝트 설정 > 내 앱 > 웹 앱에서 복사한 설정값을 넣으세요.
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "fir-2-f3b80.firebaseapp.com",
  databaseURL: "https://fir-2-f3b80-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fir-2-f3b80"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const form = document.querySelector("#loginForm");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const signupBtn = document.querySelector("#signupBtn");
const resetBtn = document.querySelector("#resetBtn");
const message = document.querySelector("#message");

function showMessage(text, error = false) {
  message.textContent = text;
  message.style.color = error ? "#d93025" : "#188038";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("로그인 중...");

  try {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    showMessage("로그인되었습니다.");
    // 다음 단계에서 메인 화면으로 이동하도록 연결합니다.
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

signupBtn.addEventListener("click", async () => {
  if (!email.value || !password.value) {
    showMessage("이메일과 비밀번호를 입력해주세요.", true);
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    showMessage("회원가입이 완료되었습니다.");
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

resetBtn.addEventListener("click", async () => {
  if (!email.value) {
    showMessage("비밀번호를 재설정할 이메일을 입력해주세요.", true);
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email.value.trim());
    showMessage("비밀번호 재설정 이메일을 보냈습니다.");
  } catch (error) {
    showMessage(firebaseErrorMessage(error.code), true);
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) console.log("로그인 사용자:", user.uid);
});

function firebaseErrorMessage(code) {
  const messages = {
    "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "auth/email-already-in-use": "이미 가입된 이메일입니다.",
    "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/too-many-requests": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
  };
  return messages[code] || `오류가 발생했습니다. (${code})`;
}
