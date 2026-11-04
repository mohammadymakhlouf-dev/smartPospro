"use strict";
const DriveAuth={
 connected:()=>false,
 authenticate:async()=>{throw Error("تسجيل Google Drive معطل في نسخة التجربة المحلية");},
 logout:()=>{},
 upload:async()=>{throw Error("النسخ السحابي غير متاح في الاختبار");},
 download:async()=>null
};