"use strict";
/* Independent offline POS test. No Google credentials or cloud uploads. */
const DEMO_USER={sub:"smartpos-offline-lab-isolated-2026",email:"test@offline.local",name:"اختبار محلي"};
let activeTab="products",scanInstance=null,scanStarting=false,scanToken=0;
const LIB_URL="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
function demoEnter(){enter({...DEMO_USER}).catch(e=>notify(e.message));}
$("btnGoogle").onclick=demoEnter;
$("btnGoogle").textContent="فتح نسخة الاختبار دون Google";
$("offlineArea").classList.add("hidden");
$("btnOffline").onclick=demoEnter;
$("subtitle")?.setAttribute("data-test","offline");
const previousPos=pos;
pos=function(){
 previousPos();
 if(app.page!=="pos")return;
 const root=$("content").querySelector(".pos");
 if(!root)return;
 root.dataset.view=activeTab;
 const tabs=document.createElement("div");
 tabs.className="pos-switch";
 tabs.innerHTML='<button type="button" data-test-tab="products">المنتجات</button><button type="button" data-test-tab="cart">السلة (<span id="cartCounter">'+app.cart.reduce((n,x)=>n+x.qty,0)+'</span>)</button>';
 root.prepend(tabs);
 for(const b of tabs.querySelectorAll("button")){
  b.classList.toggle("active",b.dataset.testTab===activeTab);
  b.addEventListener("click",()=>{activeTab=b.dataset.testTab;root.dataset.view=activeTab;for(const t of tabs.querySelectorAll("button"))t.classList.toggle("active",t.dataset.testTab===activeTab);});
 }
 const scan=$("scan");
 if(scan){
  const control=document.createElement("div");
  control.className="scan-controls";
  const btn=document.createElement("button");
  btn.type="button";btn.className="primary";btn.textContent="📷 مسح باركود بالكاميرا";
  btn.addEventListener("click",openCamera);
  control.append(btn);
  scan.insertAdjacentElement("afterend",control);
 }
};
const previousGoto=goto;
goto=function(page){if(page==="pos")activeTab="products";if(page!=="pos")stopCamera();previousGoto(page);};
function statusCamera(msg,error=false){const node=$("cameraStatus");node.textContent=msg;node.style.color=error?"#c33442":"#58728e";}
function loadLib(){
 if(window.Html5Qrcode)return Promise.resolve();
 if(window._scanLibraryPromise)return window._scanLibraryPromise;
 window._scanLibraryPromise=new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=LIB_URL;script.onload=()=>window.Html5Qrcode?resolve():reject(Error("لم تُحمّل المكتبة"));script.onerror=()=>reject(Error("مكتبة القارئ غير موجودة. افتح الصفحة مرة واحدة مع الإنترنت لتخزينها."));document.head.append(script);
 }).catch(err=>{window._scanLibraryPromise=null;throw err;});
 return window._scanLibraryPromise;
}
function openCamera(){
 $("cameraOverlay").classList.remove("hidden");
 statusCamera("اضغط تشغيل الكاميرا، واسمح باستخدام الكاميرا في المتصفح.");
}
function scanCode(raw){
 const code=String(raw||"").trim();
 const product=app.data.products.find(p=>p.barcode===code&&code);
 if(!product){statusCamera("لم أجد منتجًا لهذا الرمز: "+code,true);return;}
 stopCamera().then(()=>{
  $("cameraOverlay").classList.add("hidden");
  app.posSearch="";addCart(product.id);
  activeTab="cart";
  if(app.page==="pos")pos();
  notify("تم إضافة: "+product.name);
 });
}
async function startCamera(){
 if(scanInstance||scanStarting)return;
 if(!window.isSecureContext){statusCamera("الكاميرا تحتاج HTTPS أو localhost. افتح نسخة الاختبار من رابط GitHub Pages، حتى عند انقطاع الإنترنت.",true);return;}
 if(!navigator.mediaDevices?.getUserMedia){statusCamera("المتصفح لا يدعم واجهة الكاميرا.",true);return;}
 scanStarting=true;statusCamera("جارٍ تجهيز الكاميرا...");
 try{
  await loadLib();
  scanInstance=new Html5Qrcode("cameraReader",{
   formatsToSupport:[
    Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.QR_CODE
   ],verbose:false
  });
  await scanInstance.start(
   {facingMode:"environment"},
   {fps:10,qrbox:(w,h)=>({width:Math.min(280,Math.max(160,Math.floor(w*.85))),height:Math.min(175,Math.max(110,Math.floor(h*.55)))})},
   value=>{if(scanToken)return;scanToken=Date.now();scanCode(value);},()=>{}
  );
  statusCamera("وجّه الكاميرا إلى باركود المنتج أو QR الذي يحتوي على رقم المنتج.");
 }catch(e){
  statusCamera("تعذّر تشغيل الكاميرا: "+(e?.message||e),true);
  if(scanInstance){try{await scanInstance.clear()}catch(_){}scanInstance=null;}
 }finally{scanStarting=false;scanToken=0;}
}
async function stopCamera(){
 if(!scanInstance)return;
 const prev=scanInstance;scanInstance=null;
 try{await prev.stop()}catch(_){}
 try{await prev.clear()}catch(_){}
}
$("cameraStart").onclick=startCamera;
$("cameraStop").onclick=()=>{stopCamera();statusCamera("تم إيقاف الكاميرا.");};
$("cameraClose").onclick=async()=>{await stopCamera();$("cameraOverlay").classList.add("hidden");};
document.addEventListener("visibilitychange",()=>{if(document.hidden)stopCamera();});
window.addEventListener("pagehide",stopCamera);
async function registerPreviewWorker(){
 if(!("serviceWorker" in navigator))return;
 try{
  const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./"});
  await navigator.serviceWorker.ready;
  const status=document.createElement("p");
  status.className="offline-status";
  status.textContent="جاري تجهيز الملفات للتشغيل دون إنترنت...";
  $("signin").append(status);
  const showReady=()=>{
   const controller=navigator.serviceWorker.controller||registration.active;
   if(!controller)return;
   const channel=new MessageChannel();
   channel.port1.onmessage=e=>{
    status.textContent=e.data?.ready
     ?"✅ ملفات الواجهة والقارئ محفوظة. يمكنك إيقاف الإنترنت وإعادة فتح هذا الرابط على الهاتف."
     :"⚠ ملف الكاميرا لم يُخزن بعد. تأكد من الإنترنت وأعد فتح الصفحة.";
   };
   controller.postMessage({type:"CHECK_READY"},[channel.port2]);
  };
  showReady();
  navigator.serviceWorker.addEventListener("controllerchange",showReady);
 }catch(e){console.warn("offline SW:",e);}
}
registerPreviewWorker();


/* Barcode creation in the same isolated demo. */
const BARCODE_LIB="https://unpkg.com/jsbarcode@3.12.1/dist/JsBarcode.all.min.js";
let barcodeLibPromise=null;
function ensureBarcodeLib(){
 if(window.JsBarcode)return Promise.resolve();
 if(barcodeLibPromise)return barcodeLibPromise;
 barcodeLibPromise=new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=BARCODE_LIB;
  script.onload=()=>window.JsBarcode?resolve():reject(Error("مكتبة إنشاء الباركود غير متاحة"));
  script.onerror=()=>reject(Error("تعذر تحميل مكتبة توليد الباركود. افتح الصفحة مرة واحدة مع الإنترنت."));
  document.head.append(script);
 }).catch(e=>{barcodeLibPromise=null;throw e;});
 return barcodeLibPromise;
}
function freshBarcode(){
 let value;
 do{value="29"+String(Date.now()).slice(-9)+String(Math.floor(Math.random()*10000)).padStart(4,"0");}
 while(app.data.products.some(p=>p.barcode===value));
 return value;
}
async function drawBarcodePreview(){
 const input=document.querySelector('#formProduct [name="barcode"]');
 const svg=document.getElementById("barcodePreviewSvg");
 if(!svg||!input?.value?.trim())return;
 try{await ensureBarcodeLib();JsBarcode(svg,input.value.trim(),{format:"CODE128",width:2,height:70,displayValue:true,margin:8});}
 catch(e){notify(e.message);}
}
const originalProductForm=productForm;
productForm=function(pid=""){
 originalProductForm(pid);
 const form=$("formProduct");
 if(!form)return;
 const input=form.querySelector('[name="barcode"]');
 const controls=document.createElement("div");controls.className="card";controls.style.marginTop="12px";
 controls.innerHTML='<h2>باركود المنتج</h2><p class="muted">يمكن توليد باركود تلقائي وعرضه وطباعته.</p><div class="row"><button id="generateCode" type="button">توليد باركود</button><button id="drawCode" type="button">عرض الباركود</button><button id="printCode" type="button">طباعة الباركود</button></div><div class="scroll" style="text-align:center;margin-top:10px"><svg id="barcodePreviewSvg"></svg></div>';
 form.append(controls);
 document.getElementById("generateCode").onclick=()=>{
  input.value=freshBarcode();drawBarcodePreview();
 };
 document.getElementById("drawCode").onclick=drawBarcodePreview;
 document.getElementById("printCode").onclick=async()=>{
  await drawBarcodePreview();
  const svg=document.getElementById("barcodePreviewSvg");
  if(!svg?.children.length)return;
  const pane=window.open("","_blank");
  if(!pane){notify("اسمح بالنوافذ المنبثقة لطباعة الرمز");return;}
  const name=form.querySelector('[name="name"]')?.value||"منتج";
  pane.document.write('<!doctype html><html dir="rtl"><meta charset="UTF-8"><title>باركود</title><body style="text-align:center;font-family:Arial"><h3></h3><div></div></body></html>');
  pane.document.querySelector("h3").textContent=name;
  pane.document.querySelector("div").append(svg.cloneNode(true));
  pane.document.close();
  pane.focus();pane.print();
 };
 if(!pid&&!input.value)input.value=freshBarcode();
 if(input.value)drawBarcodePreview();
};
