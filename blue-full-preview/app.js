"use strict";
// Production safeguards: keep original IndexedDB and Google Drive backup namespace.
/* SmartPOS Pro v1 - offline-first single-device demo.
   Drive stores backups, not a shared live database. */
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const id=()=>crypto.randomUUID();
const cents=x=>Math.round(Number(x)*100);
const fmt=(n)=>((Number(n)||0)/100).toFixed(2)+" "+(app.data?.currency||"₪");
const day=s=>(s||"").slice(0,10);
const when=s=>new Date(s).toLocaleString("ar",{dateStyle:"short",timeStyle:"short"});
const clone=x=>structuredClone(x);
let app={user:null,data:null,page:"dashboard",cart:[],productSearch:"",posSearch:"",discount:0,payment:"cash",customer:""};
let backupTimer=null,processing=false,toastTimer=null,backupRunning=false;
let backupSessionStart=Date.now();
let saveQueue=Promise.resolve();
let pendingProductPhoto="";
const DRIVE_BIND_PREFIX="smartpos-blue-demo-drive-bound-";
let activeDriveIdentity=null;
function linkedDrive(){
 const raw=localStorage.getItem(DRIVE_BIND_PREFIX+(app.user?.sub||""));
 if(!raw)return null;
 try{const r=JSON.parse(raw);if(r?.sub)return r}catch(e){}
 return {sub:raw,email:"",legacy:true};
}
function driveConnectedForCurrent(){const b=linkedDrive();return Boolean(b&&activeDriveIdentity?.owner===app.user?.sub&&activeDriveIdentity?.sub===b.sub&&DriveAuth.connected())}
function dropDriveSession(){activeDriveIdentity=null;DriveAuth.logout()}


const LOCAL_USERS_KEY="smartpos-blue-demo-local-users-v1";
const STAY_KEY="smartpos-blue-demo-stay-v1";
function getLocalUsers(){try{return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY)||"{}")||{}}catch(_){return {}}}
function bytesToHex(bytes){return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("")}
async function passwordHash(password,salt){
 if(!crypto?.subtle)throw Error("تسجيل الدخول المحلي يتطلب HTTPS ومتصفحًا حديثًا");
 const text=new TextEncoder();
 const key=await crypto.subtle.importKey("raw",text.encode(password),"PBKDF2",false,["deriveBits"]);
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:text.encode(salt),iterations:180000,hash:"SHA-256"},key,256);
 return bytesToHex(new Uint8Array(bits));
}
function usernameValue(raw){return String(raw||"").trim().toLowerCase()}
async function saveLocalCredentials(username,password,owner){
 const name=usernameValue(username);
 if(!/^[a-z0-9_.-]{3,32}$/.test(name))throw Error("اسم المستخدم: من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا");
 if(password.length<8)throw Error("كلمة المرور يجب أن تتكون من 8 أحرف على الأقل");
 const users=getLocalUsers();
 if(users[name]&&users[name].sub!==owner.sub)throw Error("اسم المستخدم مستخدم على هذا الجهاز");
 const salt=bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
 users[name]={sub:owner.sub,name:owner.name||name,email:owner.email||"",salt,hash:await passwordHash(password,salt)};
 localStorage.setItem(LOCAL_USERS_KEY,JSON.stringify(users));
 return name;
}
function rememberedSession(){
 try{const x=JSON.parse(localStorage.getItem(STAY_KEY)||"null");if(x&&getLocalUsers()[x.username]?.sub===x.sub)return x}catch(_){}
 return null;
}
async function localLogin(e){
 e.preventDefault();
 const username=usernameValue($("localUsername").value),password=$("localPassword").value,users=getLocalUsers(),record=users[username];
 if(!record)return notify("اسم المستخدم أو كلمة المرور غير صحيحة");
 const button=$("btnLocalLogin");button.disabled=true;
 try{
  const digest=await passwordHash(password,record.salt);
  if(digest.length!==record.hash.length||![...digest].every((x,i)=>x===record.hash[i]))throw Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  if($("rememberDevice").checked)localStorage.setItem(STAY_KEY,JSON.stringify({username,sub:record.sub}));
  else localStorage.removeItem(STAY_KEY);
  await enter({sub:record.sub,name:record.name,email:record.email||"",local:true});
  notify("تم تسجيل الدخول بنجاح");
 }catch(err){notify(err.message)}finally{button.disabled=false}
}
async function localRegister(e){
 e.preventDefault();
 const username=usernameValue($("registerUsername").value),password=$("registerPassword").value;
 if(!username||!password)return notify("أدخل اسم المستخدم وكلمة المرور");
 if(getLocalUsers()[username])return notify("اسم المستخدم مستخدم بالفعل على هذا الجهاز");
 const owner={sub:"local:"+crypto.randomUUID(),name:username,email:"",local:true};
 const button=$("btnRegister");button.disabled=true;
 try{
  await saveLocalCredentials(username,password,owner);
  localStorage.setItem(STAY_KEY,JSON.stringify({username,sub:owner.sub}));
  await enter(owner);
  notify("تم إنشاء الحساب المحلي. احفظ بيانات الدخول في مكان آمن");
 }catch(err){notify(err.message)}finally{button.disabled=false}
}
async function attachLocalLogin(e){
 e.preventDefault();
 const username=$("attachUsername").value,password=$("attachPassword").value;
 try{
  const name=await saveLocalCredentials(username,password,app.user);
  localStorage.setItem(STAY_KEY,JSON.stringify({username:name,sub:app.user.sub}));
  app.user.local=true;
  notify("تم تفعيل الدخول المحلي. يمكنك الآن الدخول دون Google");
  settings();
 }catch(err){notify(err.message)}
}
function toggleLocalRegister(){ $("registerArea").classList.toggle("hidden"); }



function notify(message){
 const t=$("toast");t.textContent=message;t.classList.remove("hidden");
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add("hidden"),4800);
}
function createData(){
 return {version:1,business:"",activity:"general",currency:"₪",products:[],sales:[],nextInvoice:1,updatedAt:new Date().toISOString()};
}
function openDB(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open("smartpos-pro-blue-demo-accounts",1);
  r.onupgradeneeded=()=>r.result.createObjectStore("accounts",{keyPath:"key"});
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
let database=null;
async function db(){if(!database)database=await openDB();return database}
async function readLocal(sub){
 const d=await db();
 return new Promise((resolve,reject)=>{
  const tx=d.transaction("accounts","readonly"),r=tx.objectStore("accounts").get(sub);
  r.onsuccess=()=>resolve(r.result?.data||null);r.onerror=()=>reject(r.error);
 });
}
async function writeLocal(sub,data){
 const d=await db();
 return new Promise((resolve,reject)=>{
  const tx=d.transaction("accounts","readwrite");
  tx.objectStore("accounts").put({key:sub,data});
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error("تعذر التخزين المحلي"));
  tx.onabort=()=>reject(tx.error||Error("توقف حفظ البيانات"));
 });
}
async function commit(next){
 if(!app.user)throw Error("لم يتم تسجيل الدخول");
 next.updatedAt=new Date().toISOString();
 const sub=app.user.sub;
 const task=saveQueue.then(()=>writeLocal(sub,next));
 saveQueue=task.catch(()=>{});
 await task;
 app.data=next;
 scheduleBackup();
}
const BACKUP_INTERVALS=[5,15,30,60,180,360,720,1440];

const HISTORY_PROMPT_PREFIX="smartpos-blue-history-checked-";
const HISTORY_PAUSE_PREFIX="smartpos-blue-history-pause-";
function localUsername(){
 const owner=app.user?.sub;
 return Object.entries(getLocalUsers()).find(([name,u])=>u.sub===owner)?.[0]||"";
}
function historyPaused(){return localStorage.getItem(HISTORY_PAUSE_PREFIX+app.user?.sub)==="yes"}
function historyPause(value){localStorage.setItem(HISTORY_PAUSE_PREFIX+app.user?.sub,value?"yes":"no")}
function historyDisplayMeta(file){
 try{return JSON.parse(file.description||"{}")}catch(e){return {}}
}
function historyDate(file){return file.createdTime||file.modifiedTime||""}
function deviceHasData(){return !!(app.data?.products?.length||app.data?.sales?.length)}
function historyRow(f){
 const m=historyDisplayMeta(f),label=esc(m.label||"نسخة محفوظة");
 const date=historyDate(f)?when(historyDate(f)):"تاريخ غير معروف";
 const owner=String(m.username||"");
 return '<div class="backup-row"><div><b>'+label+'</b><p class="muted small">'+esc(date)+' • '+(m.products||0)+' منتج • '+(m.sales||0)+' فاتورة'+(owner?' • '+esc(owner):'')+'</p></div><button type="button" class="primary" data-action="restore-history" data-id="'+esc(f.id)+'">استعادة</button></div>';
}
async function showHistory(notifyNewDevice=false){
 const wrap=$("historyArea");
 if(!wrap)return;
 if(!driveConnectedForCurrent()){wrap.innerHTML='<p class="notice">اربط Gmail أو جدد التفويض لعرض سجل النسخ.</p>';return}
 const owner=app.user.sub;
 wrap.innerHTML='<p class="muted">جارٍ تحميل سجل النسخ من Google Drive...</p>';
 try{
  const list=await DriveAuth.listRelatedHistory(localUsername(),owner);
  if(app.user?.sub!==owner||!$("historyArea"))return;
  window.__smartposHistory=list;
  const grouped=list.reduce((m,f)=>{const key=String(historyDate(f)).slice(0,10)||"unknown";(m[key]??=[]).push(f);return m},{});
  const keys=Object.keys(grouped).sort().reverse();
  $("historyArea").innerHTML=keys.length?keys.map(k=>'<div class="backup-day"><h3>'+esc(k)+'</h3>'+grouped[k].map(historyRow).join("")+'</div>').join(""):'<p class="muted">لا توجد نسخ مؤرخة لهذا المستخدم بعد. أنشئ أول نسخة الآن.</p>';
  if(notifyNewDevice&&list.length&&!deviceHasData()){
    historyPause(true);
    alert("تنبيه جهاز جديد: توجد نسخ احتياطية محفوظة لهذا المستخدم. الجهاز الحالي فارغ. اختر نسخة لاستعادتها، أو اضغط متابعة دون استعادة. لن تُرفع نسخة تلقائية قبل اتخاذ القرار.");
    $("newDeviceDecision").classList.remove("hidden");
  }else if(notifyNewDevice){
    historyPause(false);
  }
 }catch(e){
  if($("historyArea"))$("historyArea").textContent="تعذر جلب سجل النسخ: "+e.message;
 }
}
async function restoreHistory(fileId){
 if(!driveConnectedForCurrent())return notify("جدد اتصال Gmail أولًا");
 const current=window.__smartposHistory||[];
 const selected=current.find(f=>f.id===fileId);
 if(!selected)return notify("أعد تحميل السجل ثم حاول مرة أخرى");
 const owner=app.user.sub,username=localUsername();
 try{
  const snapshot=await DriveAuth.readHistory(fileId,owner,username);
  if(snapshot.ownerSub!==owner&&(!username||snapshot.ownerUsername!==username))throw Error("النسخة لا تطابق اسم المستخدم الحالي");
  const data=validBackup(snapshot,snapshot.ownerSub!==owner);
  if(!confirm("استعادة نسخة «"+(historyDisplayMeta(selected).label||"نسخة محفوظة")+"» بتاريخ "+historyDate(selected)+"؟ سيتم استبدال بيانات الجهاز الحالي، ولن تُحذف أي نسخة سحابية قديمة."))return;
  if(deviceHasData()){
   if(!confirm("لديك بيانات على هذا الجهاز. سنحفظ نسخة أمان منها على Drive أولًا. هل توافق؟"))return;
   await saveQueue;
   await DriveAuth.createHistory(buildSnapshot(),"نسخة أمان قبل الاستعادة","safety");
  }
  if(app.user.sub!==owner)throw Error("تغير المستخدم أثناء الاستعادة");
  await commit(data);
  historyPause(false);
  app.cart=[];goto("dashboard");
  notify("تمت استعادة النسخة. بقي سجل النسخ القديم محفوظًا.");
 }catch(e){notify("تعذرت الاستعادة: "+e.message)}
}
async function continueEmptyDevice(){
 if(!confirm("تريد البدء بالبيانات الموجودة على هذا الجهاز دون استعادة؟ لن تُحذف أي نسخة محفوظة على Drive."))return;
 historyPause(false);
 const panel=$("newDeviceDecision");if(panel)panel.classList.add("hidden");
 scheduleBackup();
 notify("تم اعتماد بيانات هذا الجهاز، والنسخ القديمة محفوظة.");
}
function backupKey(){
 return "smartpos-blue-demo-auto-backup-"+(app.user?.sub||"anonymous");
}
function backupPrefs(){
 let prefs=null;
 try{prefs=JSON.parse(localStorage.getItem(backupKey())||"null")}catch(e){}
 return {
  enabled:prefs?.enabled!==false,
  minutes:BACKUP_INTERVALS.includes(Number(prefs?.minutes))?Number(prefs.minutes):30,
  lastSuccess:Number(prefs?.lastSuccess)||0,
  lastDataUpdatedAt:String(prefs?.lastDataUpdatedAt||""),
  lastAttempt:Number(prefs?.lastAttempt)||0,
  lastError:String(prefs?.lastError||"")
 };
}
function saveBackupPrefs(prefs){
 localStorage.setItem(backupKey(),JSON.stringify(prefs));
}
function backupStatusText(){
 const p=backupPrefs();
 if(!p.enabled)return "النسخ التلقائي متوقف";
 if(!navigator.onLine)return "بانتظار عودة الإنترنت";
 if(!linkedDrive())return "اربط Gmail بهذا المستخدم أولًا";
 if(!driveConnectedForCurrent())return "Gmail مرتبط، لكن يلزم تجديد اتصال Google في هذه الجلسة";
 if(!app.data)return "بانتظار بيانات المنشأة";
 if(p.lastSuccess&&p.lastDataUpdatedAt===app.data.updatedAt)return "البيانات الحالية محفوظة على Google Drive";
 return "سيتم النسخ بعد انتهاء المدة المحددة أثناء فتح التطبيق";
}
function scheduleBackup(){
 clearTimeout(backupTimer);backupTimer=null;
 if(!app.user||!app.data)return;
 const p=backupPrefs();
 if(!p.enabled||historyPaused()||!navigator.onLine||!driveConnectedForCurrent())return;
 if(p.lastSuccess&&p.lastDataUpdatedAt===app.data.updatedAt)return;
 const interval=p.minutes*60000;
 const start=p.lastSuccess||backupSessionStart;
 const due=Math.max(start+interval,(p.lastAttempt||0)+60000);
 const wait=Math.max(1000,due-Date.now());
 backupTimer=setTimeout(async()=>{
  backupTimer=null;
  if(document.visibilityState==="hidden"){return;}
  if(!app.user||!app.data||historyPaused()||!navigator.onLine||!driveConnectedForCurrent())return;
  await cloudBackup(false);
 },Math.min(wait,2147483647));
}
function updateBackupSettings(){
 if(!app.user)return;
 const prefs=backupPrefs();
 prefs.enabled=$("autoBackupEnabled")?.checked??prefs.enabled;
 prefs.minutes=Number($("autoBackupMinutes")?.value)||30;
 if(!BACKUP_INTERVALS.includes(prefs.minutes))prefs.minutes=30;
 saveBackupPrefs(prefs);
 scheduleBackup();
 if(app.page==="settings")settings();
 notify(prefs.enabled?"تم تفعيل النسخ التلقائي كل "+prefs.minutes+" دقيقة أثناء فتح التطبيق":"تم إيقاف النسخ التلقائي");
}
function localStatus(){
 $("online").textContent=navigator.onLine?"متصل • حفظ محلي":"غير متصل • حفظ محلي";
}
function setViews(view){
 $("signin").classList.toggle("hidden",view!=="signin");
 $("setup").classList.toggle("hidden",view!=="setup");
 $("shell").classList.toggle("hidden",view!=="shell");
}
async function enter(user){
 if(app.user?.sub!==user.sub&&DriveAuth.connected())dropDriveSession();
 app.user=user;
 backupSessionStart=Date.now();
 localStorage.setItem("smartpos-blue-demo-last-user",JSON.stringify(user));
 app.data=await readLocal(user.sub);
 app.cart=[];app.discount=0;app.customer="";app.payment="cash";
 if(!app.data){setViews("setup");return}
 setViews("shell");$("sideName").textContent=app.data.business;
 goto("dashboard");scheduleBackup();
}
async function login(){
 $("btnGoogle").disabled=true;
 try{
  const user=await DriveAuth.authenticate();
  await enter(user);
  notify("مرحبًا "+user.name);
 }catch(e){notify("تعذر تسجيل الدخول: "+e.message)}
 finally{$("btnGoogle").disabled=false}
}
async function offlineLogin(){
 notify("لأمان الحساب، الدخول القديم دون كلمة مرور معطّل. استخدم اسم المستخدم وكلمة المرور، أو دخول Google القديم للانتقال.");
}
async function setup(e){
 e.preventDefault();
 const name=$("businessName").value.trim();
 if(!name)return notify("أدخل اسم المنشأة");
 const data=createData();
 data.business=name;data.activity=$("businessType").value;data.currency=$("currency").value;
 try{await commit(data);setViews("shell");$("sideName").textContent=name;goto("dashboard");notify("تم إنشاء المنشأة");}
 catch(e){notify("فشل الحفظ: "+e.message)}
}
function logout(){
 closeBarcodeCamera();
 if(!confirm("تسجيل الخروج؟ ستبقى البيانات المحلية محفوظة على هذا الجهاز."))return;
 dropDriveSession();localStorage.removeItem(STAY_KEY);clearTimeout(backupTimer);backupTimer=null;
 app={user:null,data:null,page:"dashboard",cart:[],productSearch:"",posSearch:"",discount:0,payment:"cash",customer:""};
 setViews("signin");notify("تم تسجيل الخروج");
}
function goto(page){
 if(page!=="pos")closeBarcodeCamera();
 if(!app.data){notify("لم يتم تحميل بيانات المحل. أعد تسجيل الدخول.");return;}
 const titles={dashboard:"لوحة التحكم",pos:"نقطة البيع",products:"المنتجات والمخزون",sales:"سجل الفواتير",reports:"التقارير",settings:"الإعدادات وGoogle Drive"};
 const map={dashboard:dashboard,pos:pos,products:products,sales:sales,reports:reports,settings:settings};
 app.page=page;
 $("title").textContent=titles[page]||"SmartPOS Pro";
 $("subtitle").textContent=app.data.business+" • "+(app.user.email||"");
 document.querySelectorAll("#menu button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 try{(map[page]||dashboard)()}
 catch(error){
  console.error("SmartPOS screen error:",page,error);
  $("content").innerHTML='<div class="card"><h2>تعذر فتح الشاشة</h2><p class="notice" id="screenErrorText"></p><button class="primary" id="retryScreen">إعادة المحاولة</button></div>';
  $("screenErrorText").textContent=error?.message||"حدث خطأ أثناء فتح الشاشة";
  $("retryScreen").onclick=()=>goto(page);
  notify("تعذر فتح "+(titles[page]||"الشاشة")+": "+(error?.message||"خطأ غير معروف"));
 }
}
function stat(title,value){return '<div class="card"><div class="muted">'+title+'</div><div class="stat">'+value+'</div></div>'}
function dashboard(){
 const d=day(new Date().toLocaleDateString("sv-SE"));
 const todays=app.data.sales.filter(s=>day(s.createdAt)===d);
 const sum=todays.reduce((a,s)=>a+s.total,0);
 const low=app.data.products.filter(p=>p.stock<=p.minimum);
 $("content").innerHTML='<div class="grid">'+stat("مبيعات اليوم",fmt(sum))+stat("فواتير اليوم",todays.length)+stat("عدد المنتجات",app.data.products.length)+stat("تنبيهات المخزون",low.length)+'</div>'+
 '<div class="card"><h2>اختصارات سريعة</h2><div class="row"><button class="primary" data-action="nav-pos">فاتورة جديدة</button><button data-action="nav-products">إضافة منتجات</button><button data-action="nav-reports">التقارير</button></div></div>'+
 '<div class="card"><h2>آخر الفواتير</h2>'+saleTable([...app.data.sales].slice(-5).reverse())+'</div>'+
 (low.length?'<div class="card"><h2>منتجات تحتاج إعادة تعبئة</h2>'+low.map(p=>'<p>'+esc(p.name)+' — المتوفر '+p.stock+'</p>').join("")+'</div>':"");
}
function nextProductBarcode(){
 let val;
 do{val="28"+String(Math.floor(Math.random()*1e11)).padStart(11,"0")}
 while(app.data.products.some(p=>p.barcode===val));
 return val;
}
function drawProductBarcode(){
 const input=document.querySelector('#formProduct [name="barcode"]'),svg=$("barcodePreview");
 if(!input||!svg)return;
 if(!input.value.trim()){svg.replaceChildren();return}
 try{JsBarcode(svg,input.value.trim(),{format:"CODE128",displayValue:true,height:60,width:2,margin:8,fontSize:13})}
 catch(e){svg.replaceChildren();notify("صيغة الباركود غير مدعومة: "+e.message)}
}

function productImage(p){
 if(typeof p?.image==="string"&&p.image.startsWith("data:image/"))
  return '<img class="item-thumbnail" alt="صورة '+esc(p.name)+'" src="'+esc(p.image)+'">';
 return '<span class="item-placeholder" aria-hidden="true">📦</span>';
}
async function compressProductImage(file){
 if(!file?.type?.startsWith("image/"))throw Error("اختر صورة بصيغة مدعومة");
 if(file.size>12*1024*1024)throw Error("حجم الصورة الأصلية كبير جدًا");
 const url=URL.createObjectURL(file);
 try{
  const img=await new Promise((resolve,reject)=>{
   const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(Error("تعذر فتح الصورة"));
   el.src=url;
  });
  const canvas=document.createElement("canvas");
  const scale=Math.min(1,520/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  canvas.getContext("2d",{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.7);
 }finally{URL.revokeObjectURL(url)}
}
function showProductPhoto(){
 const e=$("productImagePreview");
 if(!e)return;
 e.innerHTML=pendingProductPhoto?'<img alt="صورة المنتج المختارة" src="'+esc(pendingProductPhoto)+'">':'<span class="item-placeholder">📦</span>';
}

function productForm(pid=""){
 closeBarcodeCamera();
 const p=app.data.products.find(x=>x.id===pid)||{id:"",name:"",barcode:nextProductBarcode(),category:"",size:"",color:"",price:0,cost:0,stock:0,minimum:3};
 pendingProductPhoto=p.image||"";
 $("title").textContent=pid?"تعديل منتج":"إضافة منتج";
 $("content").innerHTML='<div class="card"><form id="formProduct"><input type="hidden" name="id" value="'+esc(p.id)+'"><div class="form-grid">'+
 field("name","اسم المنتج",p.name,true)+field("category","القسم",p.category)+field("size","المقاس / الحجم",p.size)+field("color","اللون / الصنف",p.color)+
 field("cost","سعر التكلفة",(p.cost/100).toFixed(2),true,"number")+field("price","سعر البيع",(p.price/100).toFixed(2),true,"number")+
 field("stock","الكمية",p.stock,true,"integer")+field("minimum","حد تنبيه المخزون",p.minimum,true,"integer")+'</div>'+
 '<div class="photo-upload-panel"><h2>صورة المنتج</h2><div id="productImagePreview" class="photo-preview"></div><div class="actions"><label class="image-picker-label">📷 تصوير أو اختيار صورة<input type="file" id="productImageInput" accept="image/*"></label><button id="removeProductImage" type="button">حذف الصورة</button></div><p class="muted small">سيتم ضغط الصورة وحفظها محليًا مع المنتج، وتُضمّن في النسخ الاحتياطية. يمكن استعمال صورة من الهاتف.</p></div>'+
 '<div class="barcode-entry"><label for="productBarcodeField">باركود المنتج<input id="productBarcodeField" name="barcode" autocomplete="off" inputmode="numeric" value="'+esc(p.barcode)+'" placeholder="امسح الباركود المطبوع أو أدخله يدويًا"></label>'+
 '<div class="barcode-tools"><button type="button" class="primary" id="scanExistingBarcode">📷 سكان الباركود بالكاميرا</button><button type="button" id="generateBarcode">توليد باركود جديد</button><button type="button" id="previewBarcodeBtn">عرض الباركود</button></div>'+
 '<p class="muted small">إذا كان المنتج عليه باركود مطبوع، امسحه بالكاميرا فيُضاف رقمه هنا تلقائيًا. لا يتم حفظ المنتج إلا عند الضغط على حفظ المنتج.</p>'+
 '<label class="barcode-photo-label">📸 قراءة من صورة أو التقاط صورة للباركود<input type="file" id="productBarcodePhoto" accept="image/*" capture="environment"></label><div id="productCameraPanel" class="hidden camera-panel"><div id="productCameraReader"></div><p id="productCameraStatus" class="muted"></p><button type="button" id="stopProductCamera">إغلاق الكاميرا</button></div>'+
 '<div class="barcode-display"><svg id="barcodePreview" role="img" aria-label="باركود المنتج"></svg></div></div>'+
 '<div class="row"><button type="submit" class="primary">حفظ المنتج</button><button type="button" data-action="nav-products">إلغاء</button></div></form></div>';
 $("formProduct").onsubmit=saveProduct;
 $("productImageInput").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{pendingProductPhoto=await compressProductImage(file);showProductPhoto();notify("تم تجهيز صورة المنتج. اضغط حفظ المنتج للاعتماد.")}
  catch(err){notify("تعذر إضافة الصورة: "+err.message)}
  e.target.value="";
 };
 $("removeProductImage").onclick=()=>{pendingProductPhoto="";showProductPhoto()};
 showProductPhoto();
 $("generateBarcode").onclick=()=>{document.querySelector('#formProduct [name="barcode"]').value=nextProductBarcode();drawProductBarcode()};
 $("previewBarcodeBtn").onclick=drawProductBarcode;
 $("scanExistingBarcode").onclick=()=>openBarcodeCamera("product");
 $("stopProductCamera").onclick=closeBarcodeCamera;
 $("productBarcodePhoto").onchange=e=>readBarcodePhoto("product",e.target);
 drawProductBarcode();
}
function printProductBarcode(pid){
 const p=app.data.products.find(x=>x.id===pid);
 if(!p?.barcode)return notify("لا يوجد باركود لهذا المنتج");
 $("title").textContent="طباعة باركود المنتج";
 $("content").innerHTML='<section class="card receipt" id="receipt"><div class="barcode-display"><h2>'+esc(p.name)+'</h2><svg id="barcodeToPrint" role="img" aria-label="باركود"></svg><p>'+fmt(p.price)+'</p></div></section><div class="row no-print"><button class="primary" data-action="print">طباعة الباركود</button><button data-action="nav-products">العودة للمنتجات</button></div>';
 try{JsBarcode("#barcodeToPrint",p.barcode,{format:"CODE128",displayValue:true,height:75,width:2,margin:8})}
 catch(e){notify("تعذر توليد الباركود: "+e.message)}
}
function field(name,label,value,required=false,type="text"){
 let attrs=type==="number"?'type="number" step="0.01" min="0"':type==="integer"?'type="number" step="1" min="0"':'type="text"';
 return '<label>'+label+'<input name="'+name+'" '+attrs+' '+(required?"required":"")+' value="'+esc(value)+'"></label>';
}
async function saveProduct(e){
 e.preventDefault();
 const f=new FormData(e.target),pid=f.get("id")||id(),name=String(f.get("name")).trim(),barcode=String(f.get("barcode")).trim();
 const stock=Number(f.get("stock")),minimum=Number(f.get("minimum"));
 const cost=cents(f.get("cost")),price=cents(f.get("price"));
 if(!name||!Number.isInteger(stock)||stock<0||!Number.isInteger(minimum)||minimum<0||
 !Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(price)||price<0)return notify("تحقق من أسعار وكميات المنتج");
 if(barcode&&app.data.products.some(x=>x.barcode===barcode&&x.id!==pid))return notify("الباركود مستخدم لمنتج آخر");
 const item={id:pid,name,barcode,category:String(f.get("category")).trim(),size:String(f.get("size")).trim(),color:String(f.get("color")).trim(),cost,price,stock,minimum,image:pendingProductPhoto};
 const next=clone(app.data),i=next.products.findIndex(p=>p.id===pid);
 if(i<0)next.products.push(item);else next.products[i]=item;
 try{await commit(next);goto("products");notify("تم حفظ المنتج")}catch(err){notify("فشل الحفظ: "+err.message)}
}
async function removeProduct(pid){
 if(!confirm("حذف المنتج؟ تبقى الفواتير السابقة محفوظة."))return;
 const next=clone(app.data);next.products=next.products.filter(p=>p.id!==pid);
 try{await commit(next);goto("products")}catch(e){notify(e.message)}
}
function products(){
 const q=app.productSearch.toLowerCase().trim();
 const list=app.data.products.filter(p=>[p.name,p.barcode,p.category,p.size,p.color].join(" ").toLowerCase().includes(q));
 $("content").innerHTML='<div class="card"><div class="row"><input id="productSearch" placeholder="ابحث بالاسم أو الباركود" value="'+esc(app.productSearch)+'"><button class="primary" data-action="new-product">+ إضافة منتج</button></div></div>'+
 '<div class="inventory-grid">'+list.map(p=>
 '<article class="inventory-tile"><div class="inventory-image">'+productImage(p)+'</div><div class="inventory-body"><b>'+esc(p.name)+'</b><span class="muted small">'+esc(p.barcode||"بدون باركود")+'</span><div class="price-row"><strong class="price">'+fmt(p.price)+'</strong><span class="chip">متوفر '+p.stock+'</span></div><div class="inventory-actions"><button class="primary" data-action="edit-product" data-id="'+p.id+'">تعديل / صورة</button><button data-action="print-barcode" data-id="'+p.id+'">باركود</button><button class="danger" data-action="remove-product" data-id="'+p.id+'">حذف</button></div></div></article>').join("")+'</div>'+
 (!list.length?'<div class="card empty">لا توجد منتجات مطابقة. أضف أول منتج لتجربة الصور.</div>':"");
 $("productSearch").addEventListener("input",e=>{
  app.productSearch=e.target.value;const index=e.target.selectionStart;products();
  $("productSearch").focus();$("productSearch").setSelectionRange(index,index);
 });
}
function cartTotal(){return app.cart.reduce((a,x)=>a+x.qty*x.price,0)}
let barcodeScanner=null,scannerStarting=false,scanStamp=0,scanBusy=false;
const BARCODE_FORMATS=()=>{
 const f=Html5QrcodeSupportedFormats;
 return [f.QR_CODE,f.CODE_128,f.EAN_13,f.EAN_8,f.UPC_A,f.UPC_E,f.CODE_39,f.CODE_93,f.ITF].filter(x=>x!==undefined);
};
function barcodeScanTarget(mode){
 const product=mode==="product";
 return {
  panel:$(product?"productCameraPanel":"cameraPanel"),
  readerId:product?"productCameraReader":"cameraReader",
  status:$(product?"productCameraStatus":"cameraStatus")
 };
}
async function closeBarcodeCamera(){
 const old=barcodeScanner;barcodeScanner=null;
 if(old){try{await old.stop()}catch(e){}try{await old.clear()}catch(e){}}
 for(const id of ["cameraPanel","productCameraPanel"]){const panel=$(id);if(panel)panel.classList.add("hidden")}
}
async function handleReadBarcode(raw,mode,status){
 const code=String(raw||"").trim();
 if(!code||scanBusy||Date.now()-scanStamp<1100)return;
 scanStamp=Date.now();
 if(mode==="product"){
  const field=$("productBarcodeField");
  if(!field)return;
  const currentId=document.querySelector('#formProduct [name="id"]')?.value||"";
  if(app.data.products.some(p=>p.barcode===code&&p.id!==currentId)){
   if(status)status.textContent="هذا الباركود مسجّل لمنتج آخر: "+code;
   notify("هذا الباركود مستخدم لمنتج آخر");
   return;
  }
  scanBusy=true;
  field.value=code;
  await closeBarcodeCamera();
  drawProductBarcode();
  notify("تمت قراءة الباركود: "+code+" — أكمل بيانات المنتج ثم احفظ.");
  scanBusy=false;
  return;
 }
 const p=app.data.products.find(x=>x.barcode&&x.barcode===code);
 if(!p){
  if(status)status.textContent="تمت قراءة الرمز: "+code+"، لكنه غير مسجّل ضمن المنتجات.";
  notify("باركود غير مسجّل: "+code);
  return;
 }
 scanBusy=true;
 await closeBarcodeCamera();
 if(app.page==="pos"){app.posSearch="";addCart(p.id);notify("تمت إضافة "+p.name+" من الكاميرا")}
 scanBusy=false;
}
async function openBarcodeCamera(mode="pos"){
 if(scannerStarting||barcodeScanner)return;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)return notify("تحتاج الكاميرا إلى HTTPS أو التطبيق المثبّت.");
 if(typeof Html5Qrcode==="undefined")return notify("ملف قارئ الباركود غير متوفر.");
 const {panel,readerId,status}=barcodeScanTarget(mode);
 if(!panel||!status)return;
 panel.classList.remove("hidden");scannerStarting=true;
 status.textContent="جارٍ تشغيل الكاميرا...";
 let instance=null;
 try{
  // تعطيل الكاشف الأصلي عند دعمه: نعتمد محرك ZXing نفسه على iOS وAndroid.
  // تقييد الصيغ يحسن سرعة قراءة باركود المنتجات على Safari.
  instance=new Html5Qrcode(readerId,{
   verbose:false,formatsToSupport:BARCODE_FORMATS(),useBarCodeDetectorIfSupported:false
  });
  barcodeScanner=instance;
  await instance.start(
   {facingMode:"environment"},
   {fps:10,disableFlip:false,qrbox:(w,h)=>({
    width:Math.min(Math.floor(w*.92),400),
    height:Math.min(Math.floor(h*.70),260)
   })},
   decoded=>{handleReadBarcode(decoded,mode,status).catch(e=>notify("خطأ أثناء قراءة الباركود: "+e.message))},
   ()=>{}
  );
  if(barcodeScanner===instance)status.textContent="وجّه الكاميرا إلى الرمز وحرّك الهاتف قليلًا حتى يصبح الباركود واضحًا. إذا لم يقرأ على الآيفون، جرّب زر «قراءة من صورة».";
 }catch(e){
  barcodeScanner=null;
  try{if(instance)await instance.clear()}catch(_){}
  status.textContent="تعذر تشغيل الكاميرا: "+(e?.message||e);
  notify("تعذر تشغيل الكاميرا");
 }finally{scannerStarting=false}
}
async function readBarcodePhoto(mode,input){
 const file=input?.files?.[0];
 if(!file)return;
 if(typeof Html5Qrcode==="undefined")return notify("ملف قارئ الباركود غير متوفر.");
 const {readerId,status,panel}=barcodeScanTarget(mode);
 try{
  await closeBarcodeCamera();
  if(panel)panel.classList.remove("hidden");
  if(status)status.textContent="جارٍ قراءة الباركود من الصورة...";
  // مسح صورة ثابتة بديل مفيد على Safari عند تعذر التعرف على الفيديو.
  const reader=new Html5Qrcode(readerId,{
   verbose:false,formatsToSupport:BARCODE_FORMATS(),useBarCodeDetectorIfSupported:false
  });
  try{
   const value=await reader.scanFile(file,true);
   await handleReadBarcode(value,mode,status);
  }finally{try{await reader.clear()}catch(e){}}
 }catch(e){
  if(status)status.textContent="تعذرت قراءة الصورة: "+(e?.message||e)+". حاول تصوير الباركود عن قرب وبإضاءة جيدة.";
  notify("لم أتمكن من قراءة الرمز من الصورة");
 }finally{input.value=""}
}
function pos(){
 closeBarcodeCamera();
 const q=app.posSearch.toLowerCase().trim();
 const list=app.data.products.filter(p=>[p.name,p.barcode,p.category,p.size,p.color].join(" ").toLowerCase().includes(q));
 const subtotal=cartTotal();
 $("content").innerHTML='<div class="pos mobile-pos"><section class="pos-products"><div class="card pos-search"><h2>المنتجات</h2><input id="scan" placeholder="ابحث بالاسم أو امسح باركود المنتج" autocomplete="off" value="'+esc(app.posSearch)+'"><div class="scan-actions"><button class="primary" id="startCamera" type="button">📷 مسح بالكاميرا</button><button type="button" id="focusScan">قارئ باركود خارجي</button></div><p class="muted small">يعمل قارئ USB/Bluetooth بالباركود ثم Enter. الكاميرا تدعم QR والباركود.</p><div id="cameraPanel" class="hidden"><div id="cameraReader"></div><p id="cameraStatus" class="muted"></p><button id="stopCamera" type="button">إغلاق الكاميرا</button></div></div><div class="product-grid">'+
 list.map(p=>'<button class="product-tile" data-action="add-cart" data-id="'+p.id+'" '+(p.stock<=0?"disabled":"")+'><span class="product-image">'+productImage(p)+'</span><span class="product-description"><b>'+esc(p.name)+'</b><span class="muted small">'+esc([p.size,p.color].filter(Boolean).join(" / "))+'</span><span class="stock">متوفر '+p.stock+'</span><span class="price">'+fmt(p.price)+'</span></span><span class="add-product-green">+ إضافة للسلة</span></button>').join("")+
 '</div></section><section class="card pos-checkout"><h2>سلة المبيعات <span class="cart-counter">'+app.cart.reduce((s,x)=>s+x.qty,0)+'</span></h2><div class="cart-mobile">'+
 (app.cart.length?app.cart.map((x,i)=>'<div class="cart-line"><div class="cart-item-heading"><b>'+esc(x.name)+'</b><button class="danger btn-sm" data-action="drop-cart" data-index="'+i+'" aria-label="حذف من السلة">حذف</button></div><div class="cart-line-bottom"><label>الكمية<input aria-label="الكمية" data-qty="'+i+'" type="number" min="1" step="1" inputmode="numeric" value="'+x.qty+'"></label><div class="cart-item-price">'+fmt(x.price*x.qty)+'</div></div></div>').join(""):'<p class="empty">السلة فارغة — اختر منتجًا أو امسح الباركود</p>')+
 '</div><hr><div class="price-row"><b>المجموع</b><b>'+fmt(subtotal)+'</b></div>'+
 '<label>الخصم<input id="discount" type="number" step="0.01" inputmode="decimal" min="0" max="'+(subtotal/100).toFixed(2)+'" value="'+(app.discount/100).toFixed(2)+'"></label>'+
 '<div class="price-row"><b>الإجمالي النهائي</b><strong id="finalTotal" class="total">'+fmt(Math.max(0,subtotal-app.discount))+'</strong></div>'+
 '<label>طريقة الدفع<select id="payment"><option value="cash" '+(app.payment==="cash"?"selected":"")+'>نقدي</option><option value="card" '+(app.payment==="card"?"selected":"")+'>بطاقة</option><option value="transfer" '+(app.payment==="transfer"?"selected":"")+'>تحويل</option></select></label>'+
 '<label>اسم العميل (اختياري)<input id="customer" placeholder="زبون نقدي" value="'+esc(app.customer)+'"></label>'+
 '<div class="checkout-actions"><button class="primary" data-action="checkout" '+(!app.cart.length?"disabled":"")+'>إتمام البيع • '+fmt(Math.max(0,subtotal-app.discount))+'</button><button data-action="clear-cart">تفريغ السلة</button></div></section></div>';
 $("startCamera").onclick=()=>openBarcodeCamera("pos");
 $("stopCamera").onclick=closeBarcodeCamera;

 $("focusScan").onclick=()=>{$("scan").focus();notify("امسح الباركود بالقارئ الخارجي ثم Enter")};
 $("scan").oninput=e=>{app.posSearch=e.target.value;const i=e.target.selectionStart;pos();$("scan").focus();$("scan").setSelectionRange(i,i)};
 $("scan").onkeydown=e=>{
  if(e.key!=="Enter")return;
  e.preventDefault();
  const code=app.posSearch.trim();
  const p=app.data.products.find(x=>x.barcode&&x.barcode===code);
  if(p){app.posSearch="";addCart(p.id);$("scan")?.focus()}else notify("لم أجد منتجًا بهذا الباركود");
 };
 document.querySelectorAll("[data-qty]").forEach(el=>el.onchange=e=>changeQty(Number(e.target.dataset.qty),e.target.value));
 $("discount").oninput=e=>{app.discount=cents(e.target.value);$("finalTotal").textContent=fmt(Math.max(0,cartTotal()-(app.discount||0)))};
 $("payment").onchange=e=>app.payment=e.target.value;
 $("customer").oninput=e=>app.customer=e.target.value;
}
function addCart(pid){
 const p=app.data.products.find(x=>x.id===pid);if(!p)return;
 let item=app.cart.find(x=>x.productId===pid);
 const n=(item?.qty||0)+1;
 if(n>p.stock)return notify("الكمية المطلوبة أكبر من المخزون");
 if(item)item.qty=n;
 else app.cart.push({productId:p.id,name:p.name,barcode:p.barcode,qty:1,price:p.price,cost:p.cost});
 pos();
}
function changeQty(i,v){
 const n=Number(v),x=app.cart[i],p=app.data.products.find(p=>p.id===x?.productId);
 if(!p||!Number.isInteger(n)||n<1||n>p.stock){notify("الكمية غير صالحة");return pos()}
 x.qty=n;pos();
}
async function checkout(){
 if(processing||!app.cart.length)return;
 const subtotal=cartTotal();
 if(!Number.isSafeInteger(app.discount)||app.discount<0||app.discount>subtotal)return notify("الخصم غير صالح");
 processing=true;
 try{
  const next=clone(app.data);
  for(const x of app.cart){
   const p=next.products.find(p=>p.id===x.productId);
   if(!p||p.stock<x.qty)throw Error("لا تتوفر الكمية المطلوبة: "+x.name);
   p.stock-=x.qty;
  }
  const sale={id:id(),invoice:next.nextInvoice++,createdAt:new Date().toISOString(),customer:app.customer.trim()||"زبون نقدي",payment:app.payment,items:clone(app.cart),subtotal,discount:app.discount,total:subtotal-app.discount};
  next.sales.push(sale);
  await commit(next);
  app.cart=[];app.discount=0;app.customer="";app.payment="cash";
  showInvoice(sale.id);
  notify("تم تسجيل الفاتورة رقم "+sale.invoice);
 }catch(e){notify("تعذر تسجيل البيع: "+e.message)}
 finally{processing=false}
}
function saleTable(list){
 if(!list.length)return '<div class="empty">لا توجد فواتير بعد.</div>';
 return '<div class="scroll"><table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>التفاصيل</th></tr></thead><tbody>'+
 list.map(s=>'<tr><td>#'+s.invoice+'</td><td>'+when(s.createdAt)+'</td><td>'+esc(s.customer)+'</td><td>'+fmt(s.total)+'</td><td><button class="btn-sm" data-action="invoice" data-id="'+s.id+'">عرض</button></td></tr>').join("")+
 '</tbody></table></div>';
}
function sales(){$("content").innerHTML='<div class="card"><h2>جميع الفواتير</h2>'+saleTable([...app.data.sales].reverse())+'</div>'}
function showInvoice(sid){
 const s=app.data.sales.find(x=>x.id===sid);if(!s)return;
 $("title").textContent="فاتورة #"+s.invoice;
 $("content").innerHTML='<section class="card receipt" id="receipt"><h2>'+esc(app.data.business)+'</h2><p style="text-align:center">فاتورة مبيعات #'+s.invoice+'</p><p>التاريخ: '+when(s.createdAt)+'</p><p>العميل: '+esc(s.customer)+'</p><p>الدفع: '+esc({cash:"نقدي",card:"بطاقة",transfer:"تحويل"}[s.payment]||s.payment)+'</p><div class="scroll"><table><thead><tr><th>الصنف</th><th>العدد</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>'+
 s.items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.qty+'</td><td>'+fmt(x.price)+'</td><td>'+fmt(x.qty*x.price)+'</td></tr>').join("")+
 '</tbody></table></div><p>المجموع: '+fmt(s.subtotal)+'</p><p>الخصم: '+fmt(s.discount)+'</p><p class="total">الإجمالي: '+fmt(s.total)+'</p><p style="text-align:center">شكرًا لزيارتكم</p></section>'+
 '<div class="row no-print"><button class="primary" data-action="print">طباعة الفاتورة</button><button data-action="nav-sales">سجل الفواتير</button></div>';
}
function reports(){
 const revenue=app.data.sales.reduce((a,s)=>a+s.total,0);
 const cost=app.data.sales.reduce((a,s)=>a+s.items.reduce((b,x)=>b+x.cost*x.qty,0),0);
 const inv=app.data.products.reduce((a,p)=>a+p.stock*p.cost,0);
 const perProduct=new Map();
 for(const s of app.data.sales)for(const x of s.items){const k=x.productId;const p=perProduct.get(k)||{name:x.name,qty:0,total:0};p.qty+=x.qty;p.total+=x.price*x.qty;perProduct.set(k,p)}
 const top=[...perProduct.values()].sort((a,b)=>b.qty-a.qty).slice(0,10);
 $("content").innerHTML='<div class="grid">'+stat("إجمالي المبيعات",fmt(revenue))+stat("تكلفة البضاعة المباعة",fmt(cost))+stat("الربح الإجمالي التقديري",fmt(revenue-cost))+stat("المخزون بالتكلفة",fmt(inv))+'</div>'+
 '<div class="card"><h2>الأصناف الأكثر مبيعًا</h2><div class="scroll"><table><thead><tr><th>الصنف</th><th>الوحدات</th><th>المبيعات</th></tr></thead><tbody>'+
 top.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+p.qty+'</td><td>'+fmt(p.total)+'</td></tr>').join("")+'</tbody></table></div></div>'+
 '<p class="muted">الربح تقديري قبل المصاريف والضرائب. يتم احتساب تكلفة البضاعة وفق السعر المحفوظ وقت البيع.</p>';
}
function settings(){
 const cloud=driveConnectedForCurrent(),p=backupPrefs(),linked=linkedDrive();
 const users=getLocalUsers(),hasLocal=Object.values(users).some(u=>u.sub===app.user.sub);
 const intervals=[[5,"كل 5 دقائق"],[15,"كل 15 دقيقة"],[30,"كل 30 دقيقة"],[60,"كل ساعة"],[180,"كل 3 ساعات"],[360,"كل 6 ساعات"],[720,"كل 12 ساعة"],[1440,"كل 24 ساعة"]];
 const last=p.lastSuccess?when(new Date(p.lastSuccess).toISOString()):"لم تكتمل أي نسخة بعد";
 $("content").innerHTML='<div class="card"><h2>المنشأة والحساب</h2><p><b>المحل:</b> '+esc(app.data.business)+'</p><p><b>حساب الدخول:</b> '+esc(app.user.name||"محلي")+'</p><p><b>العملة:</b> '+esc(app.data.currency)+'</p><p><b>نوع النشاط:</b> '+esc(app.data.activity)+'</p><button data-action="logout">تسجيل الخروج</button></div>'+
 (hasLocal?'':'<div class="card"><h2>تفعيل الدخول باسم مستخدم</h2><p class="muted">يمكنك إنشاء اسم مستخدم وكلمة مرور لهذا المحل، وسيبقى مرتبطًا بنفس بياناته على هذا الجهاز.</p><form id="attachLocalForm"><label>اسم المستخدم<input id="attachUsername" required autocomplete="username" pattern="[a-zA-Z0-9_.-]{3,32}"></label><label>كلمة المرور<input id="attachPassword" required type="password" minlength="8" autocomplete="new-password"></label><button class="primary" type="submit">تفعيل الدخول المحلي لهذا المحل</button></form></div>')+
 '<div class="card"><h2>Google Drive — النسخ الاحتياطي</h2><p class="muted">كل مستخدم يربط Gmail مستقلًا، ويمكن استخدام Gmail نفسه لأكثر من مستخدم دون استبدال نسخهم.</p>'+
 '<p><b>Gmail المرتبط:</b> '+(linked?esc(linked.email||"مرتبط سابقًا — جدد الاتصال لعرض البريد"):"غير مرتبط")+'</p>'+
 '<p id="driveStatus" class="chip">'+(cloud?"متصل بـ Google Drive":"غير متصل بـ Google Drive")+'</p>'+
 '<div class="actions"><button class="primary" data-action="connect-drive">'+(linked?"تجديد اتصال Gmail":"ربط Gmail")+'</button>'+(linked?'<button data-action="change-drive-account">تغيير Gmail المرتبط</button>':"")+'<button data-action="backup-drive" '+(!cloud?"disabled":"")+'>حفظ نسخة الآن على Drive</button><button data-action="restore-drive" '+(!cloud?"disabled":"")+'>استعادة من Drive</button></div>'+
 '<div class="backup-history"><hr><h2>سجل النسخ بتاريخ واسم</h2><p class="muted">كل نسخة تُحفظ في ملف مستقل ولا تستبدل النسخ السابقة. تستطيع كتابة اسم مميز لنسختك اليدوية.</p><div class="actions"><input id="historyBackupName" maxlength="100" placeholder="اسم النسخة (مثال: قبل الجرد)"><button class="primary" data-action="backup-drive" '+(!cloud?"disabled":"")+'>حفظ نسخة باسم جديد</button><button data-action="refresh-history" '+(!cloud?"disabled":"")+'>تحديث السجل</button></div><div id="newDeviceDecision" class="notice hidden"><b>هذا الجهاز فارغ وتوجد نسخ سابقة على Drive.</b><p>اختر نسخة لاستعادتها أو تابع ببيانات منفصلة. لن يتم رفع نسخة تلقائية حتى تختار.</p><button data-action="continue-empty-device">متابعة دون استعادة</button></div><div id="historyArea"><p class="muted">اضغط «تحديث السجل» لعرض النسخ المحفوظة.</p></div></div>'+
 '<hr><h2>النسخ الاحتياطي التلقائي</h2>'+
 '<label class="backup-toggle"><input id="autoBackupEnabled" type="checkbox" '+(p.enabled?"checked":"")+'> تفعيل النسخ الاحتياطي التلقائي إلى Google Drive</label>'+
 '<label>المدة الزمنية بين النسخ<select id="autoBackupMinutes" '+(!p.enabled?"disabled":"")+'>'+intervals.map(([m,label])=>'<option value="'+m+'" '+(p.minutes===m?"selected":"")+'>'+label+'</option>').join("")+'</select></label>'+
 '<p class="muted"><b>حالة النسخ:</b> '+esc(backupStatusText())+'</p>'+
 '<p class="muted"><b>آخر نسخة سحابية ناجحة من هذا الجهاز:</b> '+esc(last)+'</p>'+
 (p.lastError?'<p class="muted"><b>آخر خطأ:</b> '+esc(p.lastError)+'</p>':"")+
 '<p class="notice">يعمل النسخ التلقائي فقط عندما يكون التطبيق مفتوحًا ويعمل، والإنترنت متوفرًا، وجلسة Google Drive صالحة. لا يمكن ضمان النسخ عند إغلاق التطبيق أو قفل الهاتف. يُرفع ملف جديد عند وجود تغييرات؛ وكل عملية نسخ ناجحة تنشئ ملفًا منفصلًا مع الوقت والتاريخ، ولا تكتب فوق نسخة سابقة.</p>'+
 '<p class="notice">استعادة نسخة قديمة تستبدل بيانات الجهاز الحالي. صدّر نسخة محلية قبل الاستعادة. لا تستخدم النسخ التلقائي على جهازين لنفس المحل، لأنها ليست مزامنة آنية.</p></div>'+
 '<div class="card"><h2>نسخة احتياطية محلية</h2><div class="actions"><button data-action="export">تحميل نسخة JSON</button><label style="margin:0">اختيار نسخة للاستعادة<input type="file" id="importFile" accept="application/json,.json"></label><button data-action="import">استعادة النسخة</button></div><p class="muted">ملف JSON غير مشفر. احفظه في مكان آمن ولا تشاركه.</p></div>';
 if($("attachLocalForm"))$("attachLocalForm").onsubmit=attachLocalLogin;
 if(cloud)showHistory(false);
 $("autoBackupEnabled").onchange=updateBackupSettings;
 $("autoBackupMinutes").onchange=updateBackupSettings;
}
function buildSnapshot(){return {app:"SmartPOS Pro",schema:1,ownerSub:app.user.sub,ownerUsername:localUsername(),ownerEmail:linkedDrive()?.email||app.user.email,exportedAt:new Date().toISOString(),data:clone(app.data)}}
function validBackup(backup,allowMatchingUsername=false){
 if(backup?.app!=="SmartPOS Pro"||backup?.schema!==1||!(backup.ownerSub===app.user.sub||(allowMatchingUsername&&localUsername()&&backup.ownerUsername===localUsername()))||
 !backup.data||!Array.isArray(backup.data.products)||!Array.isArray(backup.data.sales)||
 typeof backup.data.business!=="string"||!Number.isSafeInteger(backup.data.nextInvoice))
 throw Error("النسخة غير متوافقة مع حساب Google الحالي أو أن بياناتها غير صالحة");
 if(backup.data.products.some(x=>typeof x.id!=="string"||typeof x.name!=="string"||!Number.isSafeInteger(x.price)||!Number.isInteger(x.stock)||x.stock<0)||
 backup.data.sales.some(x=>typeof x.id!=="string"||!Array.isArray(x.items)||!Number.isSafeInteger(x.total)))
 throw Error("النسخة تحتوي على بيانات غير صالحة");
 return clone(backup.data);
}
function exportJSON(){
 const json=JSON.stringify(buildSnapshot(),null,2),a=document.createElement("a");
 const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
 a.href=url;a.download="smartpos-"+new Date().toISOString().slice(0,10)+".json";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function importJSON(){
 const file=$("importFile")?.files?.[0];
 if(!file)return notify("اختر ملف النسخة أولًا");
 try{
  const data=validBackup(JSON.parse(await file.text()));
  if(!confirm("سيتم استبدال بيانات المحل على الجهاز. هل أنت متأكد؟"))return;
  await commit(data);app.cart=[];goto("dashboard");notify("تمت استعادة النسخة المحلية");
 }catch(e){notify("فشلت الاستعادة: "+e.message)}
}
async function cloudBackup(manual=true){
 if(backupRunning){if(manual)notify("هناك عملية نسخ احتياطي جارية");return}
 if(!app.user||!app.data)return;
 if(!driveConnectedForCurrent()){if(manual)notify("جدد اتصال Gmail لهذا المستخدم من الإعدادات");return}
 if(!navigator.onLine){if(manual)notify("الإنترنت غير متاح");return}
 const owner=app.user.sub,preference=backupPrefs();
 if(!manual&&(historyPaused()||!preference.enabled||(preference.lastSuccess&&preference.lastDataUpdatedAt===app.data.updatedAt)))return;
 backupRunning=true;
 preference.lastAttempt=Date.now();
 saveBackupPrefs(preference);
 try{
  await saveQueue;
  const snapshot=buildSnapshot();
  if(!driveConnectedForCurrent())throw Error("جلسة Gmail ليست لهذا المستخدم");
  const manualLabel=$("historyBackupName")?.value.trim();
  const label=manual?(manualLabel||"نسخة يدوية "+new Date().toLocaleString("ar")):"نسخة تلقائية "+new Date().toLocaleString("ar");
  await DriveAuth.createHistory(snapshot,label,manual?"manual":"auto");
  if(manual&&$("historyBackupName"))$("historyBackupName").value="";

  if(app.user?.sub===owner){
   const p=backupPrefs();
   p.lastSuccess=Date.now();p.lastDataUpdatedAt=snapshot.data.updatedAt;
   p.lastError="";
   saveBackupPrefs(p);
  }
  if(manual)notify("تم حفظ نسخة مستقلة بتاريخ واسم بنجاح");
 }catch(e){
  if(app.user?.sub===owner){
   const p=backupPrefs();p.lastError=String(e.message||e).slice(0,180);saveBackupPrefs(p);
  }
  notify("فشل النسخ إلى Drive: "+e.message);
 }finally{
  backupRunning=false;
  scheduleBackup();
  if(app.page==="settings")settings();
 }
}
async function cloudRestore(){
 if(!driveConnectedForCurrent())return notify("جدد اتصال Gmail من الإعدادات أولًا");
 try{
  const raw=await DriveAuth.download(app.user.sub);
  if(!raw)return notify("لا توجد نسخة محفوظة في Google Drive");
  const data=validBackup(raw);
  if(!confirm("تحذير: ستستبدل جميع بيانات الجهاز بنسخة قديمة. اختر نسخة مؤرخة من سجل النسخ بدلًا من ذلك. متابعة؟"))return;
  if(deviceHasData())await DriveAuth.createHistory(buildSnapshot(),"نسخة أمان قبل استعادة قديمة","safety");
  await commit(data);historyPause(false);app.cart=[];goto("dashboard");notify("تمت الاستعادة مع الاحتفاظ بالنسخ السابقة");
 }catch(e){notify("تعذرت الاستعادة: "+e.message)}
}
async function connectDrive(change=false){
 const owner=app.user?.sub;if(!owner)return notify("سجل الدخول أولًا");
 const previous=linkedDrive();
 if(change&&previous&&!confirm("تغيير Gmail لا ينقل النسخ القديمة تلقائيًا. متابعة؟"))return;
 try{
  dropDriveSession();
  const user=await DriveAuth.authenticate();
  if(app.user?.sub!==owner){dropDriveSession();throw Error("تغير المستخدم أثناء الربط")}
  if(!change&&previous&&previous.sub!==user.sub){dropDriveSession();throw Error("اختر Gmail المرتبط سابقًا، أو استخدم زر تغيير Gmail")}
  if(!change&&!owner.startsWith("local:")&&!previous&&user.sub!==owner){dropDriveSession();throw Error("اختر حساب Google الأصلي لهذا المحل")}
  localStorage.setItem(DRIVE_BIND_PREFIX+owner,JSON.stringify({sub:user.sub,email:user.email,updatedAt:new Date().toISOString()}));
  activeDriveIdentity={sub:user.sub,email:user.email,owner};
  // Inspect cloud history before allowing an empty fresh device to create automatic copies.
  if(!localStorage.getItem(HISTORY_PROMPT_PREFIX+owner)&&!deviceHasData())historyPause(true);
  scheduleBackup();notify("تم ربط Gmail: "+user.email);settings();
  const firstVisit=!localStorage.getItem(HISTORY_PROMPT_PREFIX+owner);
  localStorage.setItem(HISTORY_PROMPT_PREFIX+owner,"yes");
  await showHistory(firstVisit);
 }catch(e){notify("فشل اتصال Gmail: "+e.message);if(app.page==="settings")settings()}
}
async function perform(action,target){
 switch(action){
  case "nav-pos":return goto("pos");case "nav-products":return goto("products");case "nav-reports":return goto("reports");case "nav-sales":return goto("sales");
  case "new-product":return productForm();case "edit-product":return productForm(target.dataset.id);
  case "remove-product":return removeProduct(target.dataset.id);
  case "print-barcode":return printProductBarcode(target.dataset.id);
  case "add-cart":return addCart(target.dataset.id);
  case "drop-cart":app.cart.splice(Number(target.dataset.index),1);return pos();
  case "clear-cart":if(!app.cart.length||confirm("تفريغ السلة؟")){app.cart=[];app.discount=0;pos()}return;
  case "checkout":return checkout();case "invoice":return showInvoice(target.dataset.id);
  case "print":return window.print();case "logout":return logout();
  case "connect-drive":return connectDrive();case "change-drive-account":return connectDrive(true);case "refresh-history":return showHistory();case "restore-history":return restoreHistory(target.dataset.id);case "continue-empty-device":return continueEmptyDevice();case "backup-drive":return cloudBackup();
  case "restore-drive":return cloudRestore();case "export":return exportJSON();
  case "import":return importJSON();
 }
}
function boot(){
 $("btnGoogle").onclick=login;
 $("formLocalLogin").onsubmit=localLogin;
 $("formLocalRegister").onsubmit=localRegister;
 $("toggleRegister").onclick=toggleLocalRegister;
 $("formSetup").onsubmit=setup;
 $("newSale").addEventListener("click",e=>{e.preventDefault();goto("pos")});
 $("menu").onclick=e=>{const btn=e.target.closest("[data-page]");if(btn)goto(btn.dataset.page)};
 $("content").onclick=e=>{const btn=e.target.closest("[data-action]");if(btn)perform(btn.dataset.action,btn)};
 window.addEventListener("online",()=>{localStatus();scheduleBackup()});
 window.addEventListener("offline",()=>{localStatus();clearTimeout(backupTimer);backupTimer=null});
 localStatus();setViews("signin");
 const session=rememberedSession();
 if(session){const record=getLocalUsers()[session.username];enter({sub:record.sub,name:record.name,email:record.email||"",local:true}).catch(e=>{localStorage.removeItem(STAY_KEY);setViews("signin");notify("تعذر استعادة الجلسة: "+e.message)})}
 document.addEventListener("visibilitychange",()=>{if(document.hidden)closeBarcodeCamera();else scheduleBackup()});
 if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(e=>console.warn("PWA:",e));
}
boot();
