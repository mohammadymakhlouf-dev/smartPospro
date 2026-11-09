/* Google Identity Services + Google Drive appDataFolder.
   All cloud access uses the merchant's own OAuth token.
   The app never receives a Google password or stores OAuth tokens. */
const GOOGLE_CLIENT_ID="1029534963788-hnptlafpi4ion4m2ubhsk982sih2m5l1.apps.googleusercontent.com";
const GOOGLE_SCOPE="openid email profile https://www.googleapis.com/auth/drive.appdata";
const DRIVE_PREFIX="smartpos-blue-demo-user-";
const backupFileName=ownerSub=>DRIVE_PREFIX+Array.from(new TextEncoder().encode(String(ownerSub)),b=>b.toString(16).padStart(2,"0")).join("")+".json";
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
 const find=async(ownerSub)=>{
  if(!ownerSub)throw Error('حساب النسخ الاحتياطي غير محدد');
  const filename=backupFileName(ownerSub);
  const qs=new URLSearchParams({spaces:"appDataFolder",q:"name = '"+filename+"' and trashed = false",fields:"nextPageToken,files(id,name,modifiedTime)",page_size:"100"});
  const r=await api(DRIVE_API+"/files?"+qs.toString());
  const d=await r.json();
  return (d.files||[]).sort((a,b)=>new Date(b.modifiedTime)-new Date(a.modifiedTime))[0]||null;
 };
 const upload=async(snapshot)=>{
  const filename=backupFileName(snapshot?.ownerSub);
  const existing=await find(snapshot?.ownerSub);
  const metadata=existing?{name:filename}:{name:filename,parents:["appDataFolder"],mimeType:"application/json"};
  const boundary="smartpos_"+crypto.randomUUID();
  const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",JSON.stringify(metadata),"\r\n--"+boundary+"\r\nContent-Type: application/json\r\n\r\n",JSON.stringify(snapshot),"\r\n--"+boundary+"--"]);
  const url=existing?DRIVE_UPLOAD+"/"+encodeURIComponent(existing.id)+"?uploadType=multipart":DRIVE_UPLOAD+"?uploadType=multipart";
  const resp=await api(url,{method:existing?"PATCH":"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});
  return resp.json();
 };
 const download=async(ownerSub)=>{
  let file=await find(ownerSub);
  if(!file){
   // Read-only compatibility with the old blue preview's shared filename.
   const q=new URLSearchParams({spaces:"appDataFolder",q:"name = 'smartpos-pro-blue-design-demo-backup.json' and trashed = false",fields:"files(id,name,modifiedTime)",page_size:"100"});
   const resp=await api(DRIVE_API+"/files?"+q.toString());
   const list=(await resp.json()).files||[];
   file=list.sort((a,b)=>new Date(b.modifiedTime)-new Date(a.modifiedTime))[0]||null;
   if(!file)return null;
   const legacy=await (await api(DRIVE_API+"/files/"+encodeURIComponent(file.id)+"?alt=media")).json();
   if(legacy?.ownerSub!==ownerSub)throw Error("النسخة القديمة تخص مستخدمًا آخر. لا يمكن استعادتها لهذا الحساب.");
   return legacy;
  }
  return (await api(DRIVE_API+"/files/"+encodeURIComponent(file.id)+"?alt=media")).json();
 };

 // Immutable historical snapshots. A unique filename is created for every backup.
 const ARCHIVE_PREFIX="smartpos-blue-history-";
 const safeOwner=owner=>Array.from(new TextEncoder().encode(String(owner)),b=>b.toString(16).padStart(2,"0")).join("");
 const archivePrefix=owner=>ARCHIVE_PREFIX+safeOwner(owner)+"-";
 const listHistory=async(owner)=>{
  if(!owner)throw Error("حساب النسخ الاحتياطي غير محدد");
  let files=[],pageToken="";
  do{
   const params={spaces:"appDataFolder",q:"name contains '"+archivePrefix(owner)+"' and trashed = false",fields:"nextPageToken,files(id,name,modifiedTime,createdTime,size,description)",page_size:"1000"};
   if(pageToken)params.page_token=pageToken;
   const response=await api(DRIVE_API+"/files?"+new URLSearchParams(params));
   const payload=await response.json();
   files.push(...(payload.files||[]).filter(f=>f.name.startsWith(archivePrefix(owner))));
   pageToken=payload.nextPageToken||"";
  }while(pageToken&&files.length<5000);
  return files.sort((a,b)=>new Date(b.createdTime||b.modifiedTime)-new Date(a.createdTime||a.modifiedTime));
 };
 const createHistory=async(snapshot,label,type="manual")=>{
  if(!snapshot?.ownerSub)throw Error("معرف المستخدم مفقود");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const filename=archivePrefix(snapshot.ownerSub)+stamp+"-"+crypto.randomUUID()+".json";
  const metadata={name:filename,parents:["appDataFolder"],mimeType:"application/json",
    description:JSON.stringify({label:String(label||"نسخة احتياطية").slice(0,100),type,at:snapshot.exportedAt,
      username:snapshot.ownerUsername||"",products:snapshot.data?.products?.length||0,
      sales:snapshot.data?.sales?.length||0})};
  const boundary="smartpos_"+crypto.randomUUID();
  const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",JSON.stringify(metadata),
   "\r\n--"+boundary+"\r\nContent-Type: application/json\r\n\r\n",JSON.stringify(snapshot),"\r\n--"+boundary+"--"]);
  const response=await api(DRIVE_UPLOAD+"?uploadType=multipart",{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});
  return response.json();
 };
 const readHistory=async(fileId,owner)=>{
  const history=await listHistory(owner);
  if(!history.some(x=>x.id===fileId))throw Error("هذه النسخة لا تخص المستخدم المحدد");
  return (await api(DRIVE_API+"/files/"+encodeURIComponent(fileId)+"?alt=media")).json();
 };
 const logout=()=>{
  const old=token;token="";expires=0;
  if(old&&ready())google.accounts.oauth2.revoke(old,()=>{});
 };
 return {authenticate,connected,upload,download,logout,ready,listHistory,createHistory,readHistory};
})();
