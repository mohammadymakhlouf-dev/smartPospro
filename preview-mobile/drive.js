/* Google Identity Services + Google Drive appDataFolder.
   All cloud access uses the merchant's own OAuth token.
   The app never receives a Google password or stores OAuth tokens. */
const GOOGLE_CLIENT_ID="1029534963788-hnptlafpi4ion4m2ubhsk982sih2m5l1.apps.googleusercontent.com";
const GOOGLE_SCOPE="openid email profile https://www.googleapis.com/auth/drive.appdata";
const DRIVE_NAME="smartpos-pro-mobile-preview-v1.json";
const DRIVE_API="https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD="https://www.googleapis.com/upload/drive/v3/files";
const DriveAuth=(()=>{
 let token="",expires=0,client=null;
 const ready=()=>!!window.google?.accounts?.oauth2;
 const connected=()=>!!token&&Date.now()<expires;
 const api=async(url,opts={})=>{
  if(!connected())throw Error("انتهت جلسة Google. سجّل الدخول من جديد.");
  let response;
  try{response=await fetch(url,{...opts,headers:{Authorization:"Bearer "+token,...opts.headers}})}
  catch(e){throw Error("تعذر الاتصال بالإنترنت: "+e.message)}
  if(response.status===401){token="";expires=0;throw Error("انتهت صلاحية الدخول. سجّل الدخول مرة أخرى.")}
  if(!response.ok)throw Error("Google API: "+response.status+" "+(await response.text()).slice(0,160));
  return response;
 };
 const authenticate=()=>new Promise((resolve,reject)=>{
  if(!navigator.onLine)return reject(Error("الاتصال بالإنترنت مطلوب لتسجيل الدخول أول مرة."));
  if(!ready())return reject(Error("مكتبة Google لم تُحمّل. تحقق من الإنترنت وأعد المحاولة."));
  if(!client)client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:GOOGLE_SCOPE,callback:()=>{}});
  client.callback=async r=>{
   if(r.error||!r.access_token){reject(Error(r.error||"لم يكتمل تسجيل الدخول"));return;}
   token=r.access_token;expires=Date.now()+Math.max(60,Number(r.expires_in||3600)-90)*1000;
   try{
    const resp=await api("https://openidconnect.googleapis.com/v1/userinfo");
    const user=await resp.json();
    if(!user.sub||!user.email)throw Error("تعذر التحقق من حساب Google");
    resolve({sub:user.sub,email:user.email,name:user.name||user.email});
   }catch(e){reject(e)}
  };
  client.error_callback=err=>reject(Error(err?.message||err?.type||"أُغلقت نافذة Google"));
  try{client.requestAccessToken({prompt:"consent"});}catch(e){reject(e)}
 });
 const find=async()=>{
  const qs=new URLSearchParams({spaces:"appDataFolder",q:"name = '"+DRIVE_NAME+"' and trashed = false",fields:"nextPageToken,files(id,name,modifiedTime)",page_size:"100"});
  const r=await api(DRIVE_API+"/files?"+qs.toString());
  const d=await r.json();
  return (d.files||[]).sort((a,b)=>new Date(b.modifiedTime)-new Date(a.modifiedTime))[0]||null;
 };
 const upload=async(snapshot)=>{
  const existing=await find();
  const metadata=existing?{name:DRIVE_NAME}:{name:DRIVE_NAME,parents:["appDataFolder"],mimeType:"application/json"};
  const boundary="smartpos_"+crypto.randomUUID();
  const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",JSON.stringify(metadata),"\r\n--"+boundary+"\r\nContent-Type: application/json\r\n\r\n",JSON.stringify(snapshot),"\r\n--"+boundary+"--"]);
  const url=existing?DRIVE_UPLOAD+"/"+encodeURIComponent(existing.id)+"?uploadType=multipart":DRIVE_UPLOAD+"?uploadType=multipart";
  const resp=await api(url,{method:existing?"PATCH":"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});
  return resp.json();
 };
 const download=async()=>{
  const file=await find();
  if(!file)return null;
  return (await api(DRIVE_API+"/files/"+encodeURIComponent(file.id)+"?alt=media")).json();
 };
 const logout=()=>{
  const old=token;token="";expires=0;
  if(old&&ready())google.accounts.oauth2.revoke(old,()=>{});
 };
 return {authenticate,connected,upload,download,logout,ready};
})();
