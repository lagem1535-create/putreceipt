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
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
function inRange(r,a,b){const d=dateOf(r);return d>=a&&d<b}

function currentData(){
  const now=new Date(); now.setHours(0,0,0,0);
  if(period==="day") return {start:now,end:addDays(now,1),label:fmt(now,{year:"numeric",month:"long",day:"numeric",weekday:"long"})};
  if(period==="week"){const s=startOfWeek(now);return {start:s,end:addDays(s,7),label:`${fmt(s,{month:"short",day:"numeric"})} ~ ${fmt(addDays(s,6),{month:"short",day:"numeric"})}`};}
  if(period==="month"){const s=new Date(now.getFullYear(),now.getMonth(),1);return {start:s,end:new Date(now.getFullYear(),now.getMonth()+1,1),label:fmt(s,{year:"numeric",month:"long"})};}
  const s=new Date(now.getFullYear(),0,1);return {start:s,end:new Date(now.getFullYear()+1,0,1),label:fmt(s,{year:"numeric"})};
}

function render(){
  const {start,end,label}=currentData();
  const current=receipts.filter(r=>inRange(r,start,end));
  document.querySelector("#periodLabel").textContent=label;
  document.querySelector("#periodTotal").textContent=won(sum(current));
  document.querySelector("#periodCount").textContent=`${current.length}장`;
  document.querySelector("#avgAmount").textContent=won(current.length?sum(current)/current.length:0);
  renderBars(start);
  renderCategories(current);
  renderReceipts(current);
}

function renderBars(start){
  let points=[];
  if(period==="day") points=Array.from({length:6},(_,i)=>{const a=new Date(start);a.setHours(i*4);return {a,b:new Date(a.getTime()+4*3600000),label:`${String(a.getHours()).padStart(2,"0")}시`};});
  if(period==="week") points=Array.from({length:7},(_,i)=>{const a=addDays(start,i);return {a,b:addDays(a,1),label:["월","화","수","목","금","토","일"][i]};});
  if(period==="month"){const days=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();const step=Math.ceil(days/6);for(let i=0;i<6;i++){const a=new Date(start);a.setDate(Math.min(i*step+1,days));const b=new Date(start);b.setDate(Math.min((i+1)*step+1,days+1));points.push({a,b,label:`${a.getDate()}일`});}}
  if(period==="year") points=Array.from({length:12},(_,i)=>{const a=new Date(start.getFullYear(),i,1);return {a,b:new Date(start.getFullYear(),i+1,1),label:`${i+1}월`};});
  const vals=points.map(p=>sum(receipts.filter(r=>inRange(r,p.a,p.b))));const max=Math.max(...vals,1);
  document.querySelector("#bars").innerHTML=points.map((p,i)=>`<div class="bar-wrap"><span class="bar-amount">${vals[i]?won(vals[i]).replace("원",""):""}</span><div class="bar" style="height:${Math.max(vals[i]/max*145,4)}px"></div><span class="bar-label">${p.label}</span></div>`).join("");
}

function renderCategories(rs){const cats=["식비","카페","쇼핑","교통","의료","기타"];const vals=cats.map(c=>({c,v:sum(rs.filter(r=>r.category===c))}));const max=Math.max(...vals.map(x=>x.v),1);document.querySelector("#categories").innerHTML=vals.map(x=>`<div class="cat-row"><span class="cat-name">${x.c}</span><div class="track"><div class="fill" style="width:${x.v/max*100}%"></div></div><span class="cat-amount">${won(x.v)}</span></div>`).join("");}
function renderReceipts(rs){const sorted=[...rs].sort((a,b)=>dateOf(b)-dateOf(a));document.querySelector("#receipts").innerHTML=sorted.length?sorted.slice(0,20).map(r=>`<div class="receipt"><div class="icon">▣</div><div><strong>${esc(r.store)}</strong><span>${esc(r.item)} · ${esc(r.category)}</span></div><span class="date">${esc(r.date)}</span><strong class="amount">${won(r.amount)}</strong></div>`).join(""):`<div class="empty"><b>아직 영수증이 없어요</b>영수증을 추가하면 이곳에 자동으로 모아집니다.</div>`;}

onAuthStateChanged(auth,user=>{if(!user){location.replace("../login/");return}document.querySelector("#welcome").textContent=`${user.displayName?.trim()||user.email?.split("@")[0]||"사용자"}님의 ${period}별 지출`;onValue(ref(db,`users/${user.uid}/receipts`),snap=>{const data=snap.val()||{};receipts=Object.entries(data).map(([id,r])=>({id,...r}));render();},err=>{document.querySelector("#status").textContent=err.message;});});
document.querySelector("#logout").addEventListener("click",async()=>{await authPersistenceReady;await signOut(auth);location.replace("../login/");});
