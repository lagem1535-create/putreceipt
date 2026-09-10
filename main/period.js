import { auth, authPersistenceReady } from "../login/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const db = getDatabase();
const period = document.body.dataset.period;
let receipts = [];
const won = n => new Intl.NumberFormat("ko-KR").format(Math.round(n || 0)) + "원";
const dateOf = r => new Date(`${r.date || "1970-01-01"}T00:00:00`);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
function startOfWeek(d){const x=new Date(d);const day=x.getDay();x.setDate(x.getDate()-(day===0?6:day-1));x.setHours(0,0,0,0);return x}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function fmt(d,opt={}){return new Intl.DateTimeFormat("ko-KR",opt).format(d)}
function sum(rs){return rs.reduce((a,r)=>a+Number(r.amount||0),0)}
function inRange(r,a,b){const d=dateOf(r);return d>=a&&d<b}
function sameDate(r,d){return r.date===`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function key(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}

const labels={day:"일별",week:"주별",month:"달별",year:"연별"};
const descriptions={day:"오늘 하루의 지출을 시간 흐름으로 확인하세요.",week:"한 주를 달력으로 보면서 어느 날 지출했는지 확인하세요.",month:"이번 달의 소비 흐름을 달력과 함께 확인하세요.",year:"올해 12개월의 지출 흐름을 한눈에 확인하세요."};

function currentData(){
  const now=new Date();now.setHours(0,0,0,0);
  if(period==="day")return{start:now,end:addDays(now,1),label:fmt(now,{year:"numeric",month:"long",day:"numeric",weekday:"long"})};
  if(period==="week"){const s=startOfWeek(now);return{start:s,end:addDays(s,7),label:`${fmt(s,{month:"short",day:"numeric"})} ~ ${fmt(addDays(s,6),{month:"short",day:"numeric"})}`};}
  if(period==="month"){const s=new Date(now.getFullYear(),now.getMonth(),1);return{start:s,end:new Date(now.getFullYear(),now.getMonth()+1,1),label:fmt(s,{year:"numeric",month:"long"})};}
  const s=new Date(now.getFullYear(),0,1);return{start:s,end:new Date(now.getFullYear()+1,0,1),label:fmt(s,{year:"numeric"})};
}

function render(){
  const {start,end,label}=currentData();
  const current=receipts.filter(r=>inRange(r,start,end));
  document.querySelector("#periodLabel").textContent=label;
  document.querySelector("#periodTotal").textContent=won(sum(current));
  document.querySelector("#periodCount").textContent=`${current.length}장`;
  document.querySelector("#avgAmount").textContent=won(current.length?sum(current)/current.length:0);
  document.querySelector("#welcome").textContent=`${window.receiptUserName||"사용자"}님의 ${labels[period]} 지출`;
  document.querySelector(".heading p:not(.eyebrow)").textContent=descriptions[period];
  renderSpecial(start,end);
  renderCategories(current);
  renderReceipts(current);
}

function renderSpecial(start,end){
  const section=document.querySelector("#specialSection");
  const title=document.querySelector("#specialTitle");
  if(period==="day"){title.textContent="시간대별 지출";document.querySelector("#specialHint").textContent="4시간 단위";section.className="section special-section";renderDay(start)}
  if(period==="week"){title.textContent="이번 주 달력";document.querySelector("#specialHint").textContent="월요일 ~ 일요일";section.className="section special-section";renderWeek(start)}
  if(period==="month"){title.textContent="이번 달 달력";document.querySelector("#specialHint").textContent="날짜별 지출";section.className="section special-section";renderMonth(start)}
  if(period==="year"){title.textContent="올해 지출 흐름";document.querySelector("#specialHint").textContent="월별";section.className="section special-section";renderYear(start)}
}

function renderDay(start){
  const points=Array.from({length:6},(_,i)=>{const a=new Date(start);a.setHours(i*4);return{a,b:new Date(a.getTime()+4*3600000),label:`${String(a.getHours()).padStart(2,"0")}시`}});
  const vals=points.map(p=>sum(receipts.filter(r=>inRange(r,p.a,p.b))));const max=Math.max(...vals,1);
  document.querySelector("#specialView").innerHTML=`<div class="day-timeline">${points.map((p,i)=>`<div class="time-row"><span>${p.label}</span><div class="time-track"><i style="width:${Math.max(vals[i]/max*100,vals[i]?5:0)}%"></i></div><strong>${vals[i]?won(vals[i]):"-"}</strong></div>`).join("")}</div>`;
}

function renderWeek(start){
  const days=Array.from({length:7},(_,i)=>addDays(start,i));
  const max=Math.max(...days.map(d=>sum(receipts.filter(r=>sameDate(r,d)))),1);
  document.querySelector("#specialView").innerHTML=`<div class="week-calendar">${days.map(d=>{const rs=receipts.filter(r=>sameDate(r,d));const total=sum(rs);return `<div class="week-day ${key(d)===key(new Date())?"today":""}"><div class="week-day-head"><span>${["월","화","수","목","금","토","일"][d.getDay()===0?6:d.getDay()-1]}</span><b>${d.getDate()}</b></div><div class="week-day-total">${total?won(total):"-"}</div><div class="week-dots">${rs.slice(0,3).map(()=>"<i></i>").join("")}</div></div>`}).join("")}</div>`;
}

function renderMonth(start){
  const firstDay=new Date(start.getFullYear(),start.getMonth(),1);const days=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();const offset=(firstDay.getDay()+6)%7;
  let cells="";for(let i=0;i<offset;i++)cells+='<div class="month-cell empty-cell"></div>';
  for(let n=1;n<=days;n++){const d=new Date(start.getFullYear(),start.getMonth(),n);const rs=receipts.filter(r=>sameDate(r,d));const total=sum(rs);cells+=`<div class="month-cell ${key(d)===key(new Date())?"today":""}"><span>${n}</span>${total?`<strong>${won(total).replace("원","")}</strong>`:""}</div>`}
  document.querySelector("#specialView").innerHTML=`<div class="calendar-weekdays">${["월","화","수","목","금","토","일"].map(x=>`<span>${x}</span>`).join("")}</div><div class="month-calendar">${cells}</div>`;
}

function renderYear(start){
  const months=Array.from({length:12},(_,i)=>new Date(start.getFullYear(),i,1));const vals=months.map(d=>sum(receipts.filter(r=>r.date&&r.date.startsWith(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`))));const max=Math.max(...vals,1);
  document.querySelector("#specialView").innerHTML=`<div class="year-grid">${months.map((d,i)=>`<div class="year-month"><span>${i+1}월</span><strong>${won(vals[i])}</strong><div class="year-track"><i style="height:${Math.max(vals[i]/max*100,vals[i]?6:2)}%"></i></div></div>`).join("")}</div>`;
}

function renderCategories(rs){const cats=["식비","카페","쇼핑","교통","의료","기타"];const vals=cats.map(c=>({c,v:sum(rs.filter(r=>r.category===c))}));const max=Math.max(...vals.map(x=>x.v),1);document.querySelector("#categories").innerHTML=vals.map(x=>`<div class="cat-row"><span class="cat-name">${x.c}</span><div class="track"><div class="fill" style="width:${x.v/max*100}%"></div></div><span class="cat-amount">${won(x.v)}</span></div>`).join("")}
function renderReceipts(rs){const sorted=[...rs].sort((a,b)=>dateOf(b)-dateOf(a));document.querySelector("#receipts").innerHTML=sorted.length?sorted.slice(0,20).map(r=>`<div class="receipt"><div class="icon">▣</div><div><strong>${esc(r.store)}</strong><span>${esc(r.item)} · ${esc(r.category)}</span></div><span class="date">${esc(r.date)}</span><strong class="amount">${won(r.amount)}</strong></div>`).join(""):`<div class="empty"><b>아직 영수증이 없어요</b>영수증을 추가하면 이곳에 자동으로 모아집니다.</div>`}

onAuthStateChanged(auth,user=>{if(!user){location.replace("../login/");return}window.receiptUserName=user.displayName?.trim()||user.email?.split("@")[0]||"사용자";onValue(ref(db,`users/${user.uid}/receipts`),snap=>{const data=snap.val()||{};receipts=Object.entries(data).map(([id,r])=>({id,...r}));render()},err=>{document.querySelector("#status").textContent=err.message})});
document.querySelector("#logout").addEventListener("click",async()=>{await authPersistenceReady;await signOut(auth);location.replace("../login/")});