import { auth, db, authPersistenceReady } from "../login/firebase-config.js?v=4";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, push, set, onValue, remove, update } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const $ = (selector) => document.querySelector(selector);
let receipts = [];
let currentUser = null;
let editingId = null;
let stopReceipts = null;
let categoryManuallySet = false;
let ocrPhotoDataUrl = null;
let thumbPhotoDataUrl = null;
let tesseractLoading = null;

const list = $("#receiptList");
const search = $("#searchInput");
const filter = $("#categoryFilter");
const modal = $("#scanModal");
const editModal = $("#editModal");
const photoModal = $("#photoModal");
const syncBadge = $(".live-badge");
const photoInput = $("#photoInput");
const photoPreview = $("#photoPreview");
const photoDropText = $("#photoDropText");
const recognizeBtn = $("#recognizeBtn");
const ocrStatus = $("#ocrStatus");
const notifyBtn = $("#notifyBtn");

const DEADLINE_LABEL = { refund: "환불", exchange: "교환", warranty: "보증" };
const CATEGORY_RULES = [
  [/스타벅스|starbucks|커피|카페|이디야|투썸|빽다방|메가커피|커피빈|커피숍/i, "카페"],
  [/택시|버스|지하철|주유|주차|톨게이트|카카오\s*t|티맵|교통카드/i, "교통"],
  [/약국|병원|의원|한의원|치과|클리닉|clinic|pharmacy/i, "의료"],
  [/마트|편의점|이마트|홈플러스|롯데마트|gs25|씨유|cu\b|세븐일레븐|다이소/i, "생필품"],
  [/백화점|올리브영|쿠팡|무신사|zara|유니클로|아울렛|스토어|샵/i, "쇼핑"],
  [/식당|분식|국밥|치킨|피자|버거|김밥|중국집|고깃집|고기|레스토랑|restaurant|푸드/i, "식비"],
];

function won(value) { return new Intl.NumberFormat("ko-KR").format(Number(value) || 0) + "원"; }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function localTime(date = new Date()) { return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`; }
function receiptDateTime(r) { return new Date(`${r?.date || "1970-01-01"}T${r?.time || "00:00"}:00`); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function setSyncStatus(text, online=true) { if(!syncBadge)return; syncBadge.textContent=text; syncBadge.style.color=online?"#19905a":"#c24141"; syncBadge.style.background=online?"#f2fdf7":"#fff5f5"; syncBadge.style.borderColor=online?"#d9f4e6":"#f2d7d7"; }
function guessCategory(text) { const t=String(text||""); for(const [re,cat] of CATEGORY_RULES){ if(re.test(t)) return cat; } return "기타"; }
function daysUntil(date) { const now=new Date(); now.setHours(0,0,0,0); const d=new Date(date); d.setHours(0,0,0,0); return Math.round((d-now)/86400000); }

function computeDeadlines(r) {
  const base = receiptDateTime(r);
  const out = {};
  if (Number(r.refundDays) > 0) out.refund = new Date(base.getTime() + Number(r.refundDays) * 86400000);
  if (Number(r.exchangeDays) > 0) out.exchange = new Date(base.getTime() + Number(r.exchangeDays) * 86400000);
  if (Number(r.warrantyMonths) > 0) { const d = new Date(base); d.setMonth(d.getMonth() + Number(r.warrantyMonths)); out.warranty = d; }
  return out;
}

function getFilters() {
  return {
    q: search?.value.trim().toLowerCase() || "",
    category: filter?.value || "all",
    payment: $("#paymentFilter")?.value || "all",
    dateFrom: $("#dateFromInput")?.value || "",
    dateTo: $("#dateToInput")?.value || "",
    minAmount: Number($("#minAmountInput")?.value) || 0,
    maxAmount: $("#maxAmountInput")?.value ? Number($("#maxAmountInput").value) : Infinity,
  };
}
function filterReceipts() {
  const f = getFilters();
  return receipts.filter(r => {
    if (f.category !== "all" && r.category !== f.category) return false;
    if (f.payment !== "all" && (r.paymentMethod||"미입력") !== f.payment) return false;
    if (f.q && !`${r.store||""} ${r.item||""} ${r.paymentMethod||""}`.toLowerCase().includes(f.q)) return false;
    if (f.dateFrom && (r.date||"") < f.dateFrom) return false;
    if (f.dateTo && (r.date||"") > f.dateTo) return false;
    const amt = Number(r.amount) || 0;
    if (amt < f.minAmount || amt > f.maxAmount) return false;
    return true;
  });
}
function renderPaymentFilterOptions(){
  const el=$("#paymentFilter"); if(!el) return;
  const current=el.value||"all";
  const methods=[...new Set(receipts.map(r=>r.paymentMethod||"미입력"))].sort();
  el.innerHTML=`<option value="all">전체 결제수단</option>`+methods.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  if(methods.includes(current)||current==="all") el.value=current;
}

function render(){
  if(!list||!search||!filter)return;
  const filtered = filterReceipts();
  list.innerHTML = filtered.length ? filtered.map(r=>{
    const deadlines = computeDeadlines(r);
    const soonest = Object.entries(deadlines).map(([type,date])=>({type,days:daysUntil(date)})).filter(d=>d.days>=0).sort((a,b)=>a.days-b.days)[0];
    const badge = soonest ? `<span class="deadline-badge ${soonest.days<=3?"soon":"later"}">${DEADLINE_LABEL[soonest.type]} D-${soonest.days}</span>` : "";
    const thumb = r.photo ? `<img class="receipt-thumb" src="${escapeHtml(r.photo)}" alt="영수증 사진">` : `<div class="receipt-icon">₩</div>`;
    const paymentTag = r.paymentMethod ? ` · ${escapeHtml(r.paymentMethod)}` : "";
    return `<article class="receipt-row">${thumb}<div class="receipt-info"><strong>${escapeHtml(r.store)}</strong><span>${escapeHtml(r.item)} · ${escapeHtml(r.category)}${paymentTag}</span>${badge}</div><div class="receipt-date">${escapeHtml(r.date)} ${escapeHtml(r.time||"")}</div><strong class="receipt-amount">${won(r.amount)}</strong><div class="receipt-actions"><button class="edit-receipt" data-id="${escapeHtml(r.id)}" type="button">수정</button><button class="delete-receipt" data-id="${escapeHtml(r.id)}" type="button">삭제</button></div></article>`;
  }).join("") : `<div class="empty">아직 영수증이 없습니다.<br><span>영수증 스캔 버튼으로 첫 영수증을 저장해보세요.</span></div>`;
  const month=localDate().slice(0,7), monthReceipts=receipts.filter(r=>String(r.date||"").startsWith(month));
  const monthTotal=monthReceipts.reduce((s,r)=>s+Number(r.amount||0),0);
  if($("#monthTotal")) $("#monthTotal").textContent=won(monthTotal);
  if($("#receiptCount")) $("#receiptCount").textContent=`${receipts.length}장`;
  if($("#monthCount")) $("#monthCount").textContent=`${monthReceipts.length}장`;
  renderMonthDelta(monthTotal);
  renderBreakdown(monthReceipts);
  renderPaymentFilterOptions();
  renderUpcoming();
}

function monthKey(offset){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

function renderMonthDelta(monthTotal){
  const el=$("#monthDelta"); if(!el) return;
  const lastMonth=monthKey(-1);
  const lastTotal=receipts.filter(r=>String(r.date||"").startsWith(lastMonth)).reduce((s,r)=>s+Number(r.amount||0),0);
  if(!lastTotal){ el.textContent=""; el.className="delta"; return; }
  const pct=Math.round((monthTotal-lastTotal)/lastTotal*100);
  if(pct===0){ el.textContent="전월과 동일"; el.className="delta flat"; return; }
  el.textContent=`전월 대비 ${Math.abs(pct)}% ${pct>0?"증가":"감소"}`;
  el.className=`delta ${pct>0?"up":"down"}`;
}

let breakdownTab="category";
function renderBreakdown(monthReceipts){
  const el=$("#breakdownList"); if(!el) return;
  let totals;
  if(breakdownTab==="payment"){
    const groups={};
    monthReceipts.forEach(r=>{ const key=r.paymentMethod||"미입력"; groups[key]=(groups[key]||0)+Number(r.amount||0); });
    totals=Object.entries(groups).map(([c,v])=>({c,v})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,6);
  }else{
    const cats=["식비","카페","교통","생필품","쇼핑","의료","기타"];
    totals=cats.map(c=>({ c, v: monthReceipts.filter(r=>r.category===c).reduce((s,r)=>s+Number(r.amount||0),0) })).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  }
  if(!totals.length){ el.innerHTML=`<div class="category-empty">이번 달 지출 내역이 아직 없습니다.</div>`; return; }
  const max=Math.max(...totals.map(x=>x.v));
  el.innerHTML=totals.map(x=>`<div class="cat-row"><span class="cat-name">${escapeHtml(x.c)}</span><div class="cat-track"><div class="cat-fill" style="width:${Math.max(x.v/max*100,4)}%"></div></div><span class="cat-amount">${won(x.v)}</span></div>`).join("");
}

function renderUpcoming(){
  const upcomingEl = $("#upcomingList"); if(!upcomingEl) return;
  const items = [];
  receipts.forEach(r=>{
    const deadlines = computeDeadlines(r);
    Object.entries(deadlines).forEach(([type,date])=>{
      const days = daysUntil(date);
      if (days >= 0 && days <= 30) items.push({ r, type, date, days });
    });
  });
  items.sort((a,b)=>a.days-b.days);
  const section=$("#upcomingSection");
  if (!items.length) {
    section?.classList.add("hidden");
    return;
  }
  section?.classList.remove("hidden");
  upcomingEl.innerHTML = items.slice(0,8).map(({r,type,days})=>{
    const badge = days<=3 ? "soon" : "later";
    const dday = days===0 ? "D-DAY" : `D-${days}`;
    return `<div class="upcoming-item"><div class="receipt-icon">₩</div><div><strong>${escapeHtml(r.store)} · ${DEADLINE_LABEL[type]} 마감</strong><span>${escapeHtml(r.date)} 구매 · ${dday}</span></div><span class="upcoming-badge ${badge}">${dday}</span></div>`;
  }).join("");
}

function checkDeadlineNotifications(){
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const storageKey = `receiptmoa_notified_${localDate()}`;
  let notified = [];
  try { notified = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { notified = []; }
  let changed = false;
  receipts.forEach(r=>{
    const deadlines = computeDeadlines(r);
    Object.entries(deadlines).forEach(([type,date])=>{
      const days = daysUntil(date);
      const flagId = `${r.id}_${type}`;
      if (days >= 0 && days <= 3 && !notified.includes(flagId)) {
        try { new Notification("영수증모아 마감 알림", { body: `${r.store} · ${DEADLINE_LABEL[type]} 마감 D-${days===0?"DAY":days}` }); } catch {}
        notified.push(flagId); changed = true;
      }
    });
  });
  if (changed) { try { localStorage.setItem(storageKey, JSON.stringify(notified)); } catch {} }
}

function listenReceipts(uid){
  if(stopReceipts)stopReceipts();
  setSyncStatus("Firebase 연결 중...",false);
  stopReceipts=onValue(ref(db,`users/${uid}/receipts`),snapshot=>{
    const data=snapshot.val()||{};
    receipts=Object.entries(data).map(([id,r])=>({id,...(r||{})})).sort((a,b)=>receiptDateTime(b)-receiptDateTime(a));
    render(); setSyncStatus("Firebase 동기화됨",true); checkDeadlineNotifications();
  },error=>{console.error(error);setSyncStatus("Firebase 연결 실패",false);if(list)list.innerHTML=`<div class="empty">Firebase에서 영수증을 불러오지 못했습니다.<br><span>${escapeHtml(error.message)}</span></div>`;});
}

function closeModal(target){ if(target)target.classList.add("hidden"); }
function closeEdit(){ editingId=null; closeModal(editModal); }

function resetScanForm(){
  ["storeInput","amountInput","itemInput","paymentMethodInput","refundDaysInput","exchangeDaysInput","warrantyMonthsInput"].forEach(id=>{const el=$("#"+id); if(el) el.value="";});
  if($("#categoryInput")) $("#categoryInput").value="식비";
  if(photoInput) photoInput.value="";
  ocrPhotoDataUrl=null; thumbPhotoDataUrl=null; categoryManuallySet=false;
  if(photoPreview){ photoPreview.src=""; photoPreview.classList.add("hidden"); }
  if(photoDropText) photoDropText.classList.remove("hidden");
  if(recognizeBtn) recognizeBtn.disabled=true;
  if(ocrStatus) ocrStatus.textContent="";
}

function openAddModal(){
  if(!modal)return;
  resetScanForm();
  const now=new Date(); if($("#dateInput"))$("#dateInput").value=localDate(now); if($("#timeInput"))$("#timeInput").value=localTime(now);
  modal.classList.remove("hidden"); setTimeout(()=>$("#storeInput")?.focus(),0);
}

async function handleSave(){
  if(!currentUser)return window.alert("로그인 상태를 확인해주세요.");
  const store=$("#storeInput")?.value.trim(), amount=Number($("#amountInput")?.value), category=$("#categoryInput")?.value||"기타", item=$("#itemInput")?.value.trim()||"상품 정보 없음", date=$("#dateInput")?.value||localDate(), time=$("#timeInput")?.value||localTime();
  if(!store||!amount)return window.alert("가게명과 금액을 입력해주세요.");
  const payload={store,item,amount,category,date,time};
  const refundDays=Number($("#refundDaysInput")?.value); if(refundDays>0) payload.refundDays=refundDays;
  const exchangeDays=Number($("#exchangeDaysInput")?.value); if(exchangeDays>0) payload.exchangeDays=exchangeDays;
  const warrantyMonths=Number($("#warrantyMonthsInput")?.value); if(warrantyMonths>0) payload.warrantyMonths=warrantyMonths;
  if(thumbPhotoDataUrl) payload.photo=thumbPhotoDataUrl;
  const paymentMethod=$("#paymentMethodInput")?.value.trim(); if(paymentMethod) payload.paymentMethod=paymentMethod;
  const button=$("#saveReceipt"); if(button)button.disabled=true;
  try{setSyncStatus("Firebase 저장 중...",false);await set(push(ref(db,`users/${currentUser.uid}/receipts`)),payload);resetScanForm();closeModal(modal);setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 저장 실패",false);window.alert(`영수증 저장에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}finally{if(button)button.disabled=false;}
}

function openEdit(id){
  const r=receipts.find(item=>item.id===id); if(!r||!editModal)return; editingId=id;
  if($("#editStoreInput"))$("#editStoreInput").value=r.store||""; if($("#editAmountInput"))$("#editAmountInput").value=Number(r.amount)||""; if($("#editCategoryInput"))$("#editCategoryInput").value=r.category||"기타"; if($("#editItemInput"))$("#editItemInput").value=r.item||""; if($("#editPaymentMethodInput"))$("#editPaymentMethodInput").value=r.paymentMethod||""; if($("#editDateInput"))$("#editDateInput").value=r.date||localDate(); if($("#editTimeInput"))$("#editTimeInput").value=r.time||"00:00";
  if($("#editRefundDaysInput"))$("#editRefundDaysInput").value=r.refundDays||""; if($("#editExchangeDaysInput"))$("#editExchangeDaysInput").value=r.exchangeDays||""; if($("#editWarrantyMonthsInput"))$("#editWarrantyMonthsInput").value=r.warrantyMonths||"";
  const editPhoto=$("#editPhotoPreview");
  if(editPhoto){ if(r.photo){editPhoto.src=r.photo;editPhoto.classList.remove("hidden");}else{editPhoto.src="";editPhoto.classList.add("hidden");} }
  editModal.classList.remove("hidden");
}
async function updateReceipt(){
  if(!currentUser||!editingId)return;
  const store=$("#editStoreInput")?.value.trim(), amount=Number($("#editAmountInput")?.value), category=$("#editCategoryInput")?.value||"기타", item=$("#editItemInput")?.value.trim()||"상품 정보 없음", date=$("#editDateInput")?.value, time=$("#editTimeInput")?.value||"00:00";
  if(!store||!amount||!date)return window.alert("가게명, 금액, 날짜를 입력해주세요.");
  const refundDays=Number($("#editRefundDaysInput")?.value), exchangeDays=Number($("#editExchangeDaysInput")?.value), warrantyMonths=Number($("#editWarrantyMonthsInput")?.value);
  const paymentMethod=$("#editPaymentMethodInput")?.value.trim()||null;
  const payload={store,amount,category,item,date,time,paymentMethod,refundDays:refundDays>0?refundDays:null,exchangeDays:exchangeDays>0?exchangeDays:null,warrantyMonths:warrantyMonths>0?warrantyMonths:null};
  try{setSyncStatus("Firebase 저장 중...",false);await update(ref(db,`users/${currentUser.uid}/receipts/${editingId}`),payload);closeEdit();setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 연결 실패",false);window.alert(`영수증 수정에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}
}
async function deleteReceipt(id){
  if(!currentUser||!id)return; if(!window.confirm("이 영수증을 삭제할까요?"))return;
  try{setSyncStatus("Firebase 저장 중...",false);await remove(ref(db,`users/${currentUser.uid}/receipts/${id}`));setSyncStatus("Firebase 동기화됨",true);}catch(error){console.error(error);setSyncStatus("Firebase 연결 실패",false);window.alert(`영수증 삭제에 실패했습니다.\n${error.message||"Firebase 설정을 확인해주세요."}`);}
}

function openLightbox(src){ const img=$("#lightboxImage"); if(!img||!src)return; img.src=src; photoModal?.classList.remove("hidden"); }

function toCsvValue(v){ return `"${String(v??"").replace(/"/g,'""')}"`; }
function exportCsv(){
  const rows=filterReceipts();
  if(!rows.length)return window.alert("내보낼 영수증이 없습니다.");
  const header=["날짜","시간","상호명","카테고리","상품명","금액","결제수단","환불기한(일)","교환기한(일)","보증기간(개월)"];
  const lines=[header.map(toCsvValue).join(",")];
  rows.forEach(r=>lines.push([r.date||"",r.time||"",r.store||"",r.category||"",r.item||"",Number(r.amount)||0,r.paymentMethod||"",r.refundDays||"",r.exchangeDays||"",r.warrantyMonths||""].map(toCsvValue).join(",")));
  const blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=`영수증모아_${localDate()}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function loadTesseract(){
  if(window.Tesseract) return Promise.resolve(window.Tesseract);
  if(tesseractLoading) return tesseractLoading;
  tesseractLoading=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    script.onload=()=>resolve(window.Tesseract);
    script.onerror=()=>reject(new Error("인식 기능을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return tesseractLoading;
}

function loadImage(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error("이미지를 불러오지 못했습니다."));
      img.src=reader.result;
    };
    reader.onerror=()=>reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
function resizeImage(img,maxSize,quality){
  const scale=Math.min(1,maxSize/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
  canvas.getContext("2d").drawImage(img,0,0,w,h);
  return canvas.toDataURL("image/jpeg",quality);
}
function prepareOcrImage(img,maxSize){
  const scale=Math.min(1,maxSize/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext("2d");
  ctx.drawImage(img,0,0,w,h);
  const imageData=ctx.getImageData(0,0,w,h), data=imageData.data;
  const gray=new Float32Array(data.length/4);
  let min=255,max=0;
  for(let i=0;i<data.length;i+=4){
    const g=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
    gray[i/4]=g; if(g<min)min=g; if(g>max)max=g;
  }
  const range=Math.max(max-min,1);
  for(let i=0;i<data.length;i+=4){
    const stretched=Math.min(255,Math.max(0,((gray[i/4]-min)/range)*255));
    data[i]=data[i+1]=data[i+2]=stretched;
  }
  ctx.putImageData(imageData,0,0);
  return canvas.toDataURL("image/png");
}

function parseAmount(text){
  const lines=text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const isNoise=(line)=>/번호|사업자|가맹점|전화|tel|대표자|일시|승인시각|카드\s*번호/i.test(line);
  const moneyValues=(line)=>{
    const values=[];
    for(const m of line.matchAll(/(\d{1,3}(?:\s*,\s*\d{3})+)\s*원?/g)) values.push(Number(m[1].replace(/[,\s]/g,"")));
    for(const m of line.matchAll(/(\d+)\s*원/g)) values.push(Number(m[1]));
    return values.filter(n=>Number.isFinite(n)&&n>0&&n<100000000);
  };
  const keyedLine=lines.find(l=>!isNoise(l)&&/(합\s*계|총\s*액|받을\s*금액|결제\s*금액|판매\s*금액|카드\s*금액|승인\s*금액|청구\s*금액)/.test(l));
  if(keyedLine){ const v=moneyValues(keyedLine); if(v.length) return Math.max(...v); }
  for(const line of lines.slice(0,5)){
    if(isNoise(line)) continue;
    const v=moneyValues(line);
    if(v.length) return Math.max(...v);
  }
  let best=0;
  for(const line of lines){ if(isNoise(line)) continue; for(const v of moneyValues(line)) if(v>best) best=v; }
  return best||null;
}
function parseDate(text){
  let m=text.match(/(20\d{2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{1,2})/);
  if(!m) m=text.match(/(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if(!m) return null;
  const y=m[1].length===2?`20${m[1]}`:m[1];
  const mm=String(Math.min(12,Math.max(1,Number(m[2])))).padStart(2,"0");
  const dd=String(Math.min(31,Math.max(1,Number(m[3])))).padStart(2,"0");
  const candidate=`${y}-${mm}-${dd}`, dt=new Date(`${candidate}T00:00:00`);
  if(Number.isNaN(dt.getTime())) return null;
  const now=new Date();
  if(dt.getFullYear()<2015||dt>new Date(now.getFullYear()+1,0,1)) return null;
  return candidate;
}
function parseTime(text){ const m=text.match(/([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/); return m?`${String(m[1]).padStart(2,"0")}:${m[2]}`:null; }
function parseStore(text){
  const lines=text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const noise=/사업자|등록번호|대표자|주소|영수증|지출증빙|매출전표|거래명세|카드전표|간이영수증|receipt|tel|전화|카드|승인|매장코드/i;
  for(const line of lines){
    if(/^[0-9\-\s:.,원₩*=~()]+$/.test(line)) continue;
    if(noise.test(line)) continue;
    const candidate=line.split(/\s{2,}/)[0].trim().replace(/^[\s*\-=~"'.]+|[\s*\-=~"'.]+$/g,"");
    if(candidate.replace(/[^가-힣a-zA-Z]/g,"").length<2) continue;
    return candidate.slice(0,30);
  }
  return null;
}
function parsePaymentMethod(text){
  const lines=text.split(/\n/).map(l=>l.trim());
  for(const line of lines){
    if(!/카드/.test(line)) continue;
    if(/카드\s*(번호|종류|잔액|사)/.test(line)) continue;
    const brandMatch=line.match(/([가-힣]{2,6}\s*(?:신용카드|체크카드|카드))/);
    if(brandMatch){
      const brand=brandMatch[1].replace(/\s+/g," ").trim();
      const digitsMatch=line.match(/(\d{4})\s*\)?\s*\**\s*$/);
      return digitsMatch?`${brand} (${digitsMatch[1]})`:brand;
    }
  }
  if(/현금|cash/i.test(text)) return "현금";
  if(/카드/.test(text)) return "카드";
  return null;
}

function parseItems(text){
  const lines=text.split(/\n/).map(l=>l.trim()).filter(Boolean);
  const skip=/합\s*계|총\s*액|받을\s*금액|결제\s*금액|판매\s*금액|카드\s*금액|승인\s*금액|청구\s*금액|공급가액|부가세|봉사료|사업자|가맹점|번호|전화|대표자|승인|카드|현금|거래유형|할부|영수증|receipt/i;
  const items=[];
  for(const line of lines){
    if(skip.test(line)) continue;
    if(/^[0-9\-\s:.,원₩*=~()]+$/.test(line)) continue;
    if(/^\d{2,4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/.test(line)) continue;
    const m=line.match(/^(.{2,25}?)\s{1,}([\d,]{2,})\s*원?$/);
    if(m){
      const name=m[1].trim();
      if(name.replace(/[^가-힣a-zA-Z]/g,"").length>=2) items.push(name);
    }
    if(items.length>=2) break;
  }
  return items.length?items.join(", "):null;
}

async function runOcr(){
  if(!ocrPhotoDataUrl||!ocrStatus)return;
  if(recognizeBtn)recognizeBtn.disabled=true;
  ocrStatus.textContent="준비하는 중...";
  try{
    const Tesseract=await loadTesseract();
    ocrStatus.textContent="영수증을 읽는 중... (최대 30초 소요)";
    const { data } = await Tesseract.recognize(ocrPhotoDataUrl,"kor+eng",{ logger: m=>{ if(m.status==="recognizing text") ocrStatus.textContent=`영수증을 읽는 중... ${Math.round((m.progress||0)*100)}%`; } });
    const text=data?.text||"";
    const store=parseStore(text), amount=parseAmount(text), date=parseDate(text), time=parseTime(text), payment=parsePaymentMethod(text), itemGuess=parseItems(text);
    if(store&&$("#storeInput"))$("#storeInput").value=store;
    if(amount&&$("#amountInput"))$("#amountInput").value=amount;
    if(date&&$("#dateInput"))$("#dateInput").value=date;
    if(time&&$("#timeInput"))$("#timeInput").value=time;
    if(itemGuess&&$("#itemInput"))$("#itemInput").value=itemGuess;
    if(payment&&$("#paymentMethodInput"))$("#paymentMethodInput").value=payment;
    if($("#categoryInput")){ $("#categoryInput").value=guessCategory(`${store||""} ${text}`); categoryManuallySet=true; }
    const found=[store&&"상호명",amount&&"금액",date&&"날짜",itemGuess&&"상품명",payment&&"결제수단"].filter(Boolean);
    ocrStatus.textContent=found.length?`${found.join(", ")} 인식 완료! 내용을 확인하고 저장하세요.`:"자동 인식에 실패했어요. 직접 입력해주세요.";
  }catch(error){ console.error(error); ocrStatus.textContent="인식에 실패했습니다. 직접 입력해주세요."; }
  finally{ if(recognizeBtn)recognizeBtn.disabled=false; }
}

photoInput?.addEventListener("change", async ()=>{
  const file=photoInput.files?.[0]; if(!file||!ocrStatus)return;
  try{
    ocrStatus.textContent="사진을 불러오는 중...";
    const img=await loadImage(file);
    const previewDataUrl=resizeImage(img,900,0.85);
    thumbPhotoDataUrl=resizeImage(img,360,0.55);
    ocrPhotoDataUrl=prepareOcrImage(img,1800);
    if(photoPreview){photoPreview.src=previewDataUrl;photoPreview.classList.remove("hidden");}
    photoDropText?.classList.add("hidden");
    if(recognizeBtn)recognizeBtn.disabled=false;
    ocrStatus.textContent="자동 인식 버튼을 눌러 정보를 읽어오세요.";
  }catch(error){ ocrStatus.textContent=error.message||"사진 처리에 실패했습니다."; }
});
recognizeBtn?.addEventListener("click", runOcr);

$("#storeInput")?.addEventListener("input", ()=>{ if(!categoryManuallySet && $("#categoryInput")) $("#categoryInput").value=guessCategory($("#storeInput").value); });
$("#categoryInput")?.addEventListener("change", ()=>{ categoryManuallySet=true; });

onAuthStateChanged(auth,user=>{
  if(!user){window.location.replace("../login/");return;}
  currentUser=user; const nickname=user.displayName?.trim()||user.email?.split("@")[0]||"사용자";
  if($("#welcomeMessage"))$("#welcomeMessage").textContent=`${nickname}님 안녕하세요`; if($("#userEmail"))$("#userEmail").textContent=user.email||"";
  const now=new Date(); if($("#dateInput"))$("#dateInput").value=localDate(now); if($("#timeInput"))$("#timeInput").value=localTime(now); listenReceipts(user.uid);
});
onValue(ref(db,".info/connected"),snapshot=>setSyncStatus(snapshot.val()===true?"Firebase 연결됨":"Firebase 오프라인",snapshot.val()===true),()=>setSyncStatus("Firebase 연결 확인 실패",false));

if(notifyBtn && "Notification" in window && Notification.permission==="granted"){ notifyBtn.textContent="알림 켜짐"; notifyBtn.disabled=true; }
notifyBtn?.addEventListener("click", async ()=>{
  if(!("Notification" in window))return window.alert("이 브라우저는 알림을 지원하지 않습니다.");
  const permission=await Notification.requestPermission();
  if(permission==="granted"){ notifyBtn.textContent="알림 켜짐"; notifyBtn.disabled=true; checkDeadlineNotifications(); }
  else window.alert("알림 권한이 거부되었습니다.");
});

$("#logoutBtn")?.addEventListener("click",async()=>{try{await authPersistenceReady;await signOut(auth);window.location.replace("../login/");}catch(error){window.alert(`로그아웃에 실패했습니다.\n${error.message||"잠시 후 다시 시도해주세요."}`);}});
$("#scanBtn")?.addEventListener("click",openAddModal);
$("#closeModal")?.addEventListener("click",()=>closeModal(modal)); $("#closeEditModal")?.addEventListener("click",closeEdit); $("#cancelEdit")?.addEventListener("click",closeEdit); $("#saveReceipt")?.addEventListener("click",handleSave); $("#updateReceipt")?.addEventListener("click",updateReceipt);
$("#closePhotoModal")?.addEventListener("click",()=>closeModal(photoModal));
$("#filterToggle")?.addEventListener("click",()=>$("#filterPanel")?.classList.toggle("hidden"));
document.querySelectorAll(".tab-btn").forEach(btn=>btn.addEventListener("click",()=>{
  breakdownTab=btn.dataset.tab;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b===btn));
  render();
}));
$("#resetFilters")?.addEventListener("click",()=>{ ["dateFromInput","dateToInput","minAmountInput","maxAmountInput"].forEach(id=>{const el=$("#"+id); if(el)el.value="";}); render(); });
$("#exportBtn")?.addEventListener("click",exportCsv);
["dateFromInput","dateToInput","minAmountInput","maxAmountInput"].forEach(id=>$("#"+id)?.addEventListener("input",render));
search?.addEventListener("input",render); filter?.addEventListener("change",render); $("#paymentFilter")?.addEventListener("change",render);
list?.addEventListener("click",event=>{
  const editButton=event.target.closest(".edit-receipt"),deleteButton=event.target.closest(".delete-receipt"),thumb=event.target.closest(".receipt-thumb");
  if(editButton)openEdit(editButton.dataset.id);
  if(deleteButton)deleteReceipt(deleteButton.dataset.id);
  if(thumb)openLightbox(thumb.src);
});
modal?.addEventListener("click",event=>{if(event.target===modal)closeModal(modal);}); editModal?.addEventListener("click",event=>{if(event.target===editModal)closeEdit();}); photoModal?.addEventListener("click",event=>{if(event.target===photoModal)closeModal(photoModal);});
document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeModal(modal);closeEdit();closeModal(photoModal);}});
render();
