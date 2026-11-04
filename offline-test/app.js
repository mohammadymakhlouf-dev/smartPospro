"use strict";
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
let backupTimer=null,processing=false,toastTimer=null;
let saveQueue=Promise.resolve();

function notify(message){
 const t=$("toast");t.textContent=message;t.classList.remove("hidden");
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add("hidden"),4800);
}
function createData(){
 return {version:1,business:"",activity:"general",currency:"₪",products:[],sales:[],nextInvoice:1,updatedAt:new Date().toISOString()};
}
function openDB(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open("smartpos-offline-lab-accounts",1);
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
function scheduleBackup(){
 if(!DriveAuth.connected())return;
 clearTimeout(backupTimer);
 backupTimer=setTimeout(()=>cloudBackup(false),60000);
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
 app.user=user;
 localStorage.setItem("smartpos-lab-last-user",JSON.stringify(user));
 app.data=await readLocal(user.sub);
 app.cart=[];app.discount=0;app.customer="";app.payment="cash";
 if(!app.data){setViews("setup");return}
 setViews("shell");$("sideName").textContent=app.data.business;
 goto("dashboard");
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
 const cached=JSON.parse(localStorage.getItem("smartpos-lab-last-user")||"null");
 if(!cached?.sub)return notify("يلزم تسجيل الدخول عبر Google مرة واحدة أولًا");
 try{if(!await readLocal(cached.sub))return notify("لا توجد بيانات محفوظة لهذا الحساب على الجهاز");
  await enter({...cached,offline:true});
  notify("وضع دون إنترنت: لا يمكن التحقق من هوية المستخدم. لا تستخدمه على جهاز مشترك.");
 }catch(e){notify(e.message)}
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
 if(!confirm("تسجيل الخروج؟ ستبقى البيانات المحلية محفوظة على هذا الجهاز."))return;
 DriveAuth.logout();clearTimeout(backupTimer);
 app={user:null,data:null,page:"dashboard",cart:[],productSearch:"",posSearch:"",discount:0,payment:"cash",customer:""};
 setViews("signin");notify("تم تسجيل الخروج");
}
function goto(page){
 app.page=page;
 const titles={dashboard:"لوحة التحكم",pos:"نقطة البيع",products:"المنتجات والمخزون",sales:"سجل الفواتير",reports:"التقارير",settings:"الإعدادات وGoogle Drive"};
 $("title").textContent=titles[page]||"SmartPOS Pro";
 $("subtitle").textContent=app.data.business+" • "+(app.user.email||"");
 document.querySelectorAll("#menu button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 const map={dashboard:dashboard,pos:pos,products:products,sales:sales,reports:reports,settings:settings};
 (map[page]||dashboard)();
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
function productForm(pid=""){
 const p=app.data.products.find(x=>x.id===pid)||{id:"",name:"",barcode:"",category:"",size:"",color:"",price:0,cost:0,stock:0,minimum:3};
 $("title").textContent=pid?"تعديل منتج":"إضافة منتج";
 $("content").innerHTML='<div class="card"><form id="formProduct"><input type="hidden" name="id" value="'+esc(p.id)+'"><div class="form-grid">'+
 field("name","اسم المنتج",p.name,true)+field("barcode","الباركود",p.barcode)+field("category","القسم",p.category)+field("size","المقاس / الحجم",p.size)+field("color","اللون / الصنف",p.color)+
 field("cost","سعر التكلفة", (p.cost/100).toFixed(2),true,"number")+field("price","سعر البيع",(p.price/100).toFixed(2),true,"number")+
 field("stock","الكمية",p.stock,true,"integer")+field("minimum","حد تنبيه المخزون",p.minimum,true,"integer")+'</div>'+
 '<div class="row"><button type="submit" class="primary">حفظ المنتج</button><button type="button" data-action="nav-products">إلغاء</button></div></form></div>';
 $("formProduct").onsubmit=saveProduct;
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
 const item={id:pid,name,barcode,category:String(f.get("category")).trim(),size:String(f.get("size")).trim(),color:String(f.get("color")).trim(),cost,price,stock,minimum};
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
 $("content").innerHTML='<div class="card"><div class="row"><input id="productSearch" placeholder="ابحث بالاسم أو الباركود" value="'+esc(app.productSearch)+'"><button class="primary" data-action="new-product">+ منتج جديد</button></div></div>'+
 '<div class="card scroll"><table><thead><tr><th>اسم المنتج</th><th>الباركود</th><th>المقاس/اللون</th><th>سعر البيع</th><th>الكمية</th><th>التحكم</th></tr></thead><tbody>'+
 list.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.barcode)+'</td><td>'+esc([p.size,p.color].filter(Boolean).join(" / "))+'</td><td>'+fmt(p.price)+'</td><td>'+(p.stock<=p.minimum?'<span class="tag">'+p.stock+'</span>':p.stock)+'</td><td><div class="actions"><button class="btn-sm" data-action="edit-product" data-id="'+p.id+'">تعديل</button><button class="danger btn-sm" data-action="remove-product" data-id="'+p.id+'">حذف</button></div></td></tr>').join("")+
 '</tbody></table>'+(!list.length?'<div class="empty">لا توجد منتجات مطابقة</div>':"")+'</div>';
 $("productSearch").addEventListener("input",e=>{app.productSearch=e.target.value;const i=e.target.selectionStart;products();$("productSearch").focus();$("productSearch").setSelectionRange(i,i)});
}
function cartTotal(){return app.cart.reduce((a,x)=>a+x.qty*x.price,0)}
function pos(){
 const q=app.posSearch.toLowerCase().trim();
 const list=app.data.products.filter(p=>[p.name,p.barcode,p.category,p.size,p.color].join(" ").toLowerCase().includes(q));
 const subtotal=cartTotal();
 $("content").innerHTML='<div class="pos"><section><div class="card"><h2>المنتجات</h2><input id="scan" placeholder="امسح الباركود أو ابحث باسم المنتج" autocomplete="off" value="'+esc(app.posSearch)+'"><p class="muted small">قارئ USB/Bluetooth يعمل كلوحة مفاتيح. امسح الباركود ثم Enter.</p></div><div class="product-grid">'+
 list.map(p=>'<button class="product-tile" data-action="add-cart" data-id="'+p.id+'" '+(p.stock<=0?"disabled":"")+'><b>'+esc(p.name)+'</b><span class="muted">'+esc([p.size,p.color].filter(Boolean).join(" / "))+'</span><p class="muted">المخزون: '+p.stock+'</p><div class="price">'+fmt(p.price)+'</div></button>').join("")+
 '</div></section><section class="card"><h2>سلة المبيعات</h2><div class="scroll"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>المجموع</th><th></th></tr></thead><tbody>'+
 app.cart.map((x,i)=>'<tr><td>'+esc(x.name)+'</td><td><input aria-label="الكمية" data-qty="'+i+'" type="number" min="1" step="1" style="width:75px" value="'+x.qty+'"></td><td>'+fmt(x.price*x.qty)+'</td><td><button class="danger btn-sm" data-action="drop-cart" data-index="'+i+'">×</button></td></tr>').join("")+
 '</tbody></table></div><hr><div class="row"><b>المجموع</b><b>'+fmt(subtotal)+'</b></div>'+
 '<label>الخصم<input id="discount" type="number" step="0.01" min="0" max="'+(subtotal/100).toFixed(2)+'" value="'+(app.discount/100).toFixed(2)+'"></label>'+
 '<div class="row"><b>الإجمالي النهائي</b><strong id="finalTotal" class="total">'+fmt(Math.max(0,subtotal-app.discount))+'</strong></div>'+
 '<label>طريقة الدفع<select id="payment"><option value="cash" '+(app.payment==="cash"?"selected":"")+'>نقدي</option><option value="card" '+(app.payment==="card"?"selected":"")+'>بطاقة</option><option value="transfer" '+(app.payment==="transfer"?"selected":"")+'>تحويل</option></select></label>'+
 '<label>اسم العميل (اختياري)<input id="customer" placeholder="زبون نقدي" value="'+esc(app.customer)+'"></label>'+
 '<div class="row"><button class="primary" data-action="checkout" '+(!app.cart.length?"disabled":"")+'>إتمام البيع</button><button data-action="clear-cart">تفريغ السلة</button></div></section></div>';
 $("scan").oninput=e=>{app.posSearch=e.target.value;const i=e.target.selectionStart;pos();$("scan").focus();$("scan").setSelectionRange(i,i)};
 $("scan").onkeydown=e=>{
  if(e.key!=="Enter")return;
  e.preventDefault();
  const barcode=app.posSearch.trim();
  const p=app.data.products.find(x=>x.barcode&&x.barcode===barcode);
  if(p){addCart(p.id);app.posSearch="";pos();$("scan").focus()}else notify("لم أجد منتجًا بهذا الباركود");
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
 const cloud=DriveAuth.connected();
 $("content").innerHTML='<div class="card"><h2>المنشأة والحساب</h2><p><b>المحل:</b> '+esc(app.data.business)+'</p><p><b>حساب Google:</b> '+esc(app.user.email)+'</p><p><b>العملة:</b> '+esc(app.data.currency)+'</p><p><b>نوع النشاط:</b> '+esc(app.data.activity)+'</p><button data-action="logout">تسجيل الخروج</button></div>'+
 '<div class="card"><h2>Google Drive — النسخ الاحتياطي</h2><p class="muted">النسخ تحفظ داخل مساحة التطبيق المخفية في Drive الخاص بهذا الحساب. ليست مزامنة آنية بين أجهزة مختلفة.</p>'+
 '<p id="driveStatus" class="chip">'+(cloud?"متصل بـ Google Drive":"غير متصل بـ Google Drive")+'</p>'+
 '<div class="actions"><button class="primary" data-action="connect-drive">تسجيل الدخول / تجديد الجلسة</button><button data-action="backup-drive" '+(!cloud?"disabled":"")+'>حفظ نسخة على Drive</button><button data-action="restore-drive" '+(!cloud?"disabled":"")+'>استعادة من Drive</button></div>'+
 '<p class="notice">استعادة نسخة قديمة تستبدل بيانات الجهاز الحالي. صدّر نسخة محلية قبل الاستعادة. النسخ الدورية تستبدل ملف النسخ السحابي الحالي؛ لا تبيع على جهازين مختلفين ثم ترفع النسخ بالتناوب.</p></div>'+
 '<div class="card"><h2>نسخة احتياطية محلية</h2><div class="actions"><button data-action="export">تحميل نسخة JSON</button><label style="margin:0">اختيار نسخة للاستعادة<input type="file" id="importFile" accept="application/json,.json"></label><button data-action="import">استعادة النسخة</button></div><p class="muted">ملف JSON غير مشفر. احفظه في مكان آمن ولا تشاركه.</p></div>';
}
function buildSnapshot(){return {app:"SmartPOS Pro",schema:1,ownerSub:app.user.sub,ownerEmail:app.user.email,exportedAt:new Date().toISOString(),data:clone(app.data)}}
function validBackup(backup){
 if(backup?.app!=="SmartPOS Pro"||backup?.schema!==1||backup.ownerSub!==app.user.sub||
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
 if(!DriveAuth.connected()){if(manual)notify("سجّل الدخول بحساب Google أولًا");return}
 if(!navigator.onLine){if(manual)notify("الإنترنت غير متاح");return}
 try{
  await saveQueue;
  await DriveAuth.upload(buildSnapshot());
  if(manual)notify("تم رفع النسخة إلى Google Drive بنجاح");
  if(app.page==="settings")settings();
 }catch(e){notify("فشل النسخ إلى Drive: "+e.message)}
}
async function cloudRestore(){
 if(!DriveAuth.connected())return notify("سجّل الدخول بحساب Google أولًا");
 try{
  const raw=await DriveAuth.download();
  if(!raw)return notify("لا توجد نسخة محفوظة في Google Drive");
  const data=validBackup(raw);
  if(!confirm("تحذير: ستستبدل جميع بيانات هذا الجهاز بنسخة Google Drive. أنشئ نسخة محلية أولًا. متابعة؟"))return;
  await commit(data);app.cart=[];goto("dashboard");notify("تمت استعادة البيانات من Google Drive");
 }catch(e){notify("تعذرت الاستعادة: "+e.message)}
}
async function connectDrive(){
 try{
  const user=await DriveAuth.authenticate();
  if(user.sub!==app.user.sub){DriveAuth.logout();throw Error("حساب Google مختلف عن حساب صاحب المحل. سجّل الخروج ثم افتح حساب المحل المناسب.")}
  app.user={...user};localStorage.setItem("smartpos-lab-last-user",JSON.stringify(user));
  notify("تم الاتصال بحساب "+user.email);settings();
 }catch(e){notify(e.message)}
}
async function perform(action,target){
 switch(action){
  case "nav-pos":return goto("pos");case "nav-products":return goto("products");case "nav-reports":return goto("reports");case "nav-sales":return goto("sales");
  case "new-product":return productForm();case "edit-product":return productForm(target.dataset.id);
  case "remove-product":return removeProduct(target.dataset.id);
  case "add-cart":return addCart(target.dataset.id);
  case "drop-cart":app.cart.splice(Number(target.dataset.index),1);return pos();
  case "clear-cart":if(!app.cart.length||confirm("تفريغ السلة؟")){app.cart=[];app.discount=0;pos()}return;
  case "checkout":return checkout();case "invoice":return showInvoice(target.dataset.id);
  case "print":return window.print();case "logout":return logout();
  case "connect-drive":return connectDrive();case "backup-drive":return cloudBackup();
  case "restore-drive":return cloudRestore();case "export":return exportJSON();
  case "import":return importJSON();
 }
}
function boot(){
 $("btnGoogle").onclick=login;
 $("btnOffline").onclick=offlineLogin;
 $("formSetup").onsubmit=setup;
 $("newSale").onclick=()=>goto("pos");
 $("menu").onclick=e=>{const btn=e.target.closest("[data-page]");if(btn)goto(btn.dataset.page)};
 $("content").onclick=e=>{const btn=e.target.closest("[data-action]");if(btn)perform(btn.dataset.action,btn)};
 const cached=localStorage.getItem("smartpos-lab-last-user");
 $("offlineArea").classList.toggle("hidden",!cached);
 window.addEventListener("online",()=>{localStatus();if(DriveAuth.connected())scheduleBackup()});
 window.addEventListener("offline",localStatus);
 localStatus();setViews("signin");
 
}
boot();
