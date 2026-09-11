import { auth, db, authPersistenceReady } from "../login/firebase-config.js?v=4";
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

function won(value) { return new Intl.NumberFormat("ko-KR").format(Number(value) || 0) + "원"; }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function localTime(date = new Date()) { return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`; }
function receiptDateTime(r) { return new Date(`${r?.date || "1970-01-01"}T${r?.time || "00:00"}:00`); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function setSyncStatus(text, online=true) { if(!syncBadge)return; syncBadge.textContent=text; syncBadge.style.color=online?"#19905a":"#c24141"; syncBadge.style.background=online?"#f2fdf7":"#fff5f5"; syncBadge.style.borderColor=online?"#d9f4e6":"#f2d7d7"; }

function render(){
  if(!list||!search||!filter)return;
  const q=search.value.trim().toLowerCase(), category=filter.value;
  const filtered=receipts.filter(r=>(category==="all"||r.category===category)&&`${r.store||""} ${r.item||""}`.toLowerCase().includes(q));
  list.innerHTML=filtered.length?filtered.map(r=>`<article class="receipt-row"><div class="receipt-icon">₩</div><div class="receipt-info"><strong>${escapeHtml(r.store)}</strong><span>${escapeHtml(r.item)} · ${escapeHtml(r.category)}</span></div><div class="receipt-date">${escapeHtml(r.date)} ${escapeHtml(r.time||"")}</div><strong class="receipt-amount">${won(r.amount)}</strong><div class="receipt-actions"><button class="edit-receipt" data-id="${escapeHtml(r.id)}" type="button">수정</button><button class="delete-receipt" data-id="${escapeHtml(r.id)}" type="button">삭제</button></div></article>`).join(""):`<div class="empty">아직 영수증이 없습니다.<br><span>영수증 추가 버튼으로 첫 영수증을 저장해보세요.</span></div>`;
  const month=localDate().slice(0,7), monthReceipts=receipts.filter(r=>String(r.date||"").startsWith(month));
  if($("#monthTotal")) $("#monthTotal").textContent=won(monthReceipts.reduce((s,r)=>s+Number(r.amount||0),0));
  if($("#receiptCount")) $("#receiptCount").textContent=`${receipts.length}장`;
  if($("#monthCount")) $("#monthCount").textContent=`${monthReceipts.length}장`;
}

function listenReceipts(uid){
  if(stopReceipts)stopReceipts();
  setSyncStatus("Firebase 연결 중...",false);
  stopReceipts=onValue(ref(db,`users/${uid}/receipts`),snapshot=>{
    const data=snapshot.val()||{};
    receipts=Object.entries(data).map(([id,r])=>({id,...(r||{})})).sort((a,b)=>receiptDateTime(b)-receiptDateTime(a));
    render(); setSyncStatus("Firebase 동기화됨",true);
  },error=>{console.error(error);setSyncStatus("Firebase 연결 실패",false);if(list)list.innerHTML=`<div class="empty">Firebase에서 영수증을 불러오지 못했습니다.<br><span>${escapeHtml(error.message)}</span></div>`;});
}

function closeModal(target){ if(target)target.classList.add("hidden"); }
function closeEdit(){ editingId=null; closeModal(editModal); }
function openAddModal(){
  if(!modal)return;
  const now=new Date(); if($("#dateInput"))$("#dateInput").value=localDate(now); if($("#timeInput"))$("#timeInput").value=localTime(now);
  modal.classList.remove("hidden"); setTimeout(()=>$("#storeInput")?.focus(),0);
}

async function handleSave(){
  if(!currentUser)return window.alert("로그인 상태를 확인해주세요.");
  const store=$("#storeInput")?.value.trim(), amount=Number($("#amountInput")?.value), category=$("#categoryInput")?.value||"기타", item=$("#itemInput")?.value.trim()||"상품 정보 없음", date=$("#dateInput")?.value||localDate(), time=$("#timeInput")?.value||localTime();
  if(!store||!amount)return window.alert("가게명과 금액을 입력해주세요.");
  const button=$("#saveReceipt"); if(button)button.disabled=true;
  try{setSyncStatus("Firebase 저장 중...",false);await set(push(ref(db,`users/${currentUser.uid}/receipts`)),{store,item,amount,category,date,time});["storeInput","amountInput","itemInput"].forEach(id=>{const el=$("#"+id);if(el)el.value=""});closeModal(modal);setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 저장 실패",false);window.alert(`영수증 저장에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}finally{if(button)button.disabled=false;}
}

function openEdit(id){
  const r=receipts.find(item=>item.id===id); if(!r||!editModal)return; editingId=id;
  if($("#editStoreInput"))$("#editStoreInput").value=r.store||""; if($("#editAmountInput"))$("#editAmountInput").value=Number(r.amount)||""; if($("#editCategoryInput"))$("#editCategoryInput").value=r.category||"기타"; if($("#editItemInput"))$("#editItemInput").value=r.item||""; if($("#editDateInput"))$("#editDateInput").value=r.date||localDate(); if($("#editTimeInput"))$("#editTimeInput").value=r.time||"00:00";
  editModal.classList.remove("hidden");
}
async function updateReceipt(){
  if(!currentUser||!editingId)return;
  const store=$("#editStoreInput")?.value.trim(), amount=Number($("#editAmountInput")?.value), category=$("#editCategoryInput")?.value||"기타", item=$("#editItemInput")?.value.trim()||"상품 정보 없음", date=$("#editDateInput")?.value, time=$("#editTimeInput")?.value||"00:00";
  if(!store||!amount||!date)return window.alert("가게명, 금액, 날짜를 입력해주세요.");
  try{setSyncStatus("Firebase 저장 중...",false);await update(ref(db,`users/${currentUser.uid}/receipts/${editingId}`),{store,amount,category,item,date,time});closeEdit();setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 연결 실패",false);window.alert(`영수증 수정에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}
}
async function deleteReceipt(id){
  if(!currentUser||!id)return; if(!window.confirm("이 영수증을 삭제할까요?"))return;
  try{setSyncStatus("Firebase 저장 중...",false);await remove(ref(db,`users/${currentUser.uid}/receipts/${id}`));setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 연결 실패",false);window.alert(`영수증 삭제에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}
}

onAuthStateChanged(auth,user=>{
  if(!user){window.location.replace("../login/");return;}
  currentUser=user; const nickname=user.displayName?.trim()||user.email?.split("@")[0]||"사용자";
  if($("#welcomeMessage"))$("#welcomeMessage").textContent=`${nickname}님 안녕하세요`; if($("#userEmail"))$("#userEmail").textContent=user.email||"";
  const now=new Date(); if($("#dateInput"))$("#dateInput").value=localDate(now); if($("#timeInput"))$("#timeInput").value=localTime(now); listenReceipts(user.uid);
});
onValue(ref(db,".info/connected"),snapshot=>setSyncStatus(snapshot.val()===true?"Firebase 연결됨":"Firebase 오프라인",snapshot.val()===true),()=>setSyncStatus("Firebase 연결 확인 실패",false));

$("#logoutBtn")?.addEventListener("click",async()=>{try{await authPersistenceReady;await signOut(auth);window.location.replace("../login/");}catch(error){window.alert(`로그아웃에 실패했습니다.\n${error.message||"잠시 후 다시 시도해주세요."}`);}});
$("#scanBtn")?.addEventListener("click",openAddModal);
$("#closeModal")?.addEventListener("click",()=>closeModal(modal)); $("#closeEditModal")?.addEventListener("click",closeEdit); $("#cancelEdit")?.addEventListener("click",closeEdit); $("#saveReceipt")?.addEventListener("click",handleSave); $("#updateReceipt")?.addEventListener("click",updateReceipt);
search?.addEventListener("input",render); filter?.addEventListener("change",render);
list?.addEventListener("click",event=>{const editButton=event.target.closest(".edit-receipt"),deleteButton=event.target.closest(".delete-receipt");if(editButton)openEdit(editButton.dataset.id);if(deleteButton)deleteReceipt(deleteButton.dataset.id);});
modal?.addEventListener("click",event=>{if(event.target===modal)closeModal(modal);}); editModal?.addEventListener("click",event=>{if(event.target===editModal)closeEdit();}); document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeModal(modal);closeEdit();}});
render();