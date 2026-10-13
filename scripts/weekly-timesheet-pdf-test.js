'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createDocumentPdf,validatePdf}=require('../services/documentPdfService');
const {timesheetDocumentData}=require('../services/timesheetDocumentService');
const {assertWeeklyDeliveryPolicy}=require('../services/weeklyDeliveryPolicy');
async function main(){
 const common={fromDate:'2026-09-28',toDate:'2026-10-04',staffId:31,staffName:'Fixture Staff A',employeeReference:'FIXTURE-A',timezone:'Australia/Sydney',status:'DRAFT',version:1};
 const row={user_id:31,name:'Fixture Staff A',work_date:'2026-10-01',clock_in:'2026-10-01T22:00:00+10:00',clock_out:'2026-10-02T06:30:00+10:00',total_minutes:480,total_hours:8,break_minutes:30,project:'Fixture night site'};
 const single=await createDocumentPdf(timesheetDocumentData({...common,rows:[row],totalMinutes:480,totalHours:8}));
 assert.equal(single.validation.pages,1);assert.match(single.validation.text,/Fixture Staff A/);assert.match(single.validation.text,/FIXTURE-A/);assert.match(single.validation.text,/30 min/);assert.match(single.validation.text,/Provisional/);assert.match(single.validation.text,/01 Oct 2026 22:00/);assert.match(single.validation.text,/02 Oct 2026 06:30/);
 const dst={...row,work_date:'2026-10-04',clock_in:'2026-10-04T01:30:00+10:00',clock_out:'2026-10-04T03:30:00+11:00',total_minutes:60,total_hours:1,break_minutes:0,project:'Fixture DST shift'};
 const overnight=await createDocumentPdf(timesheetDocumentData({...common,rows:[dst],totalMinutes:60,totalHours:1,status:'APPROVED'}));
 assert.match(overnight.validation.text,/(?:AEST|GMT\+10)/);assert.match(overnight.validation.text,/(?:AEDT|GMT\+11)/);assert.match(overnight.validation.text,/1.00 \(1h 00m\)/);assert.match(overnight.validation.text,/Approved/);
 const attendanceTime=require('../services/attendanceTimeService'),eligibility=require('../services/weeklyTimesheetEligibility');
 const corrected=attendanceTime.manualWorkedEntry({clock_in:'2026-10-03T15:40:00.000Z',clock_out:'2026-10-03T17:30:00.000Z',break_minutes:10},99,new Date('2026-10-13T00:00:00Z'),{TIMESHEET_TIMEZONE:'Australia/Sydney'});
 const reviewed=eligibility.assessWorkedAttendance({id:31,name:common.staffName,role:'staff',active:1},[{...corrected,id:901,user_id:31,name:common.staffName}],{start:common.fromDate,end:common.toDate,timezone:common.timezone},eligibility.configuration({TIMESHEET_TIMEZONE:'Australia/Sydney'}),new Date('2026-10-13T00:00:00Z'));
 assert.equal(reviewed.status,'ELIGIBLE');assert.equal(reviewed.totalMinutes,100);
 const correctionPdf=await createDocumentPdf(timesheetDocumentData({...common,rows:reviewed.rows,totalMinutes:100,totalHours:100/60,status:'APPROVED',version:2}));
 assert.equal(correctionPdf.validation.pages,1);assert.match(correctionPdf.validation.text,/04 Oct 2026 01:40/);assert.match(correctionPdf.validation.text,/04 Oct 2026 04:30/);assert.match(correctionPdf.validation.text,/10 min/);assert.match(correctionPdf.validation.text,/1.67 \(1h 40m\)/);assert.match(correctionPdf.validation.text,/Approved/);
 const {DateTime}=require('luxon');
 const beginning=DateTime.fromISO('2026-10-01T00:00:00',{zone:'Australia/Sydney'});
 const rows=Array.from({length:40},(_,i)=>{const start=beginning.plus({hours:i});return {...row,work_date:start.toISODate(),clock_in:start.toISO(),clock_out:start.plus({hours:1}).toISO(),total_minutes:60,total_hours:1,break_minutes:0,project:`Fixture job ${i+1}: complete item traceability reference`};});
 const multi=await createDocumentPdf(timesheetDocumentData({...common,rows,totalMinutes:2400,totalHours:40,version:2}));
 assert.ok(multi.validation.pages>1);assert.match(multi.validation.text,/Fixture job 40/);assert.match(multi.validation.text,/REVISION/);assert.match(multi.validation.text,/40.00 \(40h 00m\)/);assert.ok((multi.validation.text.match(/Worked hours/g)||[]).length>=2);
 for(const artifact of [single,overnight,correctionPdf,multi]){assert.doesNotMatch(artifact.validation.text,/Staff B|Fixture-B|pay rate|payroll amount/i);await validatePdf(artifact.buffer,{expectedText:['Fixture Staff A','FIXTURE-A','Australia/Sydney']});}
 assert.throws(()=>timesheetDocumentData({...common,rows:[row,{...row,user_id:32,name:'Fixture Staff B'}]}),{code:'PDF_STAFF_SCOPE_MISMATCH'});
 assert.throws(()=>timesheetDocumentData({...common,rows:[{...row,work_date:'2026-10-05'}]}),{code:'PDF_PERIOD_MISMATCH'});
 const policy={type:'WEEKLY_TIMESHEET',deliveryId:81,staffId:31,fromDate:common.fromDate,toDate:common.toDate,revision:1,sourceHash:'a'.repeat(64),recipient:'designated@example.invalid'};
 const message={deliveryKey:'weekly-timesheet:31:2026-09-28:2026-10-04:v1',deliveryPolicy:policy};
 assert.equal(assertWeeklyDeliveryPolicy(message,{to:['designated@example.invalid'],cc:[],bcc:[]}).staffId,31);
 for(const addresses of [{to:['login@example.invalid']},{to:['designated@example.invalid','other@example.invalid']},{to:['designated@example.invalid'],cc:['manager@example.invalid']},{to:['designated@example.invalid'],bcc:['payroll@example.invalid']}])assert.throws(()=>assertWeeklyDeliveryPolicy(message,addresses),{code:'DELIVERY_REVIEW_REQUIRED'});
 assert.throws(()=>assertWeeklyDeliveryPolicy({...message,deliveryPolicy:null},{to:['designated@example.invalid']}),{code:'DELIVERY_REVIEW_REQUIRED'});
 const mail=require('../services/emailService');
 await assert.rejects(()=>mail.sendMail({...message,to:policy.recipient,cc:'manager@example.invalid',subject:'No transport permitted',attachments:[{filename:single.filename,content:single.buffer}]}),{code:'DELIVERY_REVIEW_REQUIRED'});
 const oldFetch=global.fetch,oldEnv={url:process.env.WORDPRESS_MAIL_RELAY_URL,token:process.env.WORDPRESS_MAIL_RELAY_TOKEN,transport:process.env.EMAIL_PRIMARY_TRANSPORT};
 process.env.WORDPRESS_MAIL_RELAY_URL='https://fixture.invalid/mail-relay';process.env.WORDPRESS_MAIL_RELAY_TOKEN='fixture-only';process.env.EMAIL_PRIMARY_TRANSPORT='https_relay';let posts=0;let privacy=false;
 global.fetch=async(_url,options)=>{const health={attachment_contract_version:3,pdf_bytes_validated:true,attachment_filename_preserved:true,weekly_recipient_privacy_enforced:privacy};if(options.method==='GET')return {ok:true,json:async()=>health};posts++;const payload=JSON.parse(options.body);assert.deepEqual(payload.to,[policy.recipient]);assert.deepEqual(payload.cc,[]);assert.deepEqual(payload.bcc,[]);assert.deepEqual(payload.delivery_policy,policy);return {ok:true,text:async()=>JSON.stringify({sent:true,...health,designated_recipient:policy.recipient,attachments:payload.attachments.map(part=>({...part,pages:single.validation.pages}))})};};
 try{await assert.rejects(()=>mail.sendMail({...message,to:policy.recipient,subject:'Fixture',attachments:[{filename:single.filename,content:single.buffer}]}),{code:'PDF_RELAY_CONTRACT_REQUIRED'});assert.equal(posts,0);privacy=true;const accepted=await mail.sendMail({...message,to:policy.recipient,subject:'Fixture',attachments:[{filename:single.filename,content:single.buffer}]});assert.equal(posts,1);assert.equal(accepted.receivedVerified,false);}finally{global.fetch=oldFetch;for(const [key,value] of [['WORDPRESS_MAIL_RELAY_URL',oldEnv.url],['WORDPRESS_MAIL_RELAY_TOKEN',oldEnv.token],['EMAIL_PRIMARY_TRANSPORT',oldEnv.transport]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
 await fs.mkdir('/tmp/voxel-weekly-pdf-evidence',{recursive:true});for(const [name,artifact] of Object.entries({single,overnight,correction:correctionPdf,multi}))await fs.writeFile(`/tmp/voxel-weekly-pdf-evidence/${name}.pdf`,artifact.buffer);
 console.log(`Weekly PDF tests passed: single ${single.validation.pages} page, overnight DST ${overnight.validation.pages} page, complete multipage ${multi.validation.pages} pages; staff-only content; exact minute totals; revision and status; one designated recipient; copy rejection; relay policy round-trip. No real email sent.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
