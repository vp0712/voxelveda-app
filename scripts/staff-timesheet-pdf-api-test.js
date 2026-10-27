'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const auth = require('../services/authorizationService');
const policy = require('../services/weeklyTimesheetEligibility');
const pdfs = require('../services/timesheetPdfService');
const { validatePdf } = require('../services/documentPdfService');

function fixtureDb() {
  const cache = new Map();
  const db = { cache, deliveries: [], queries: [], commits: 0, rollbacks: 0,
    async query(sql, params = []) {
      db.queries.push(sql);
      if (/^SET TRANSACTION/.test(sql)) return [[]];
      if (/INSERT INTO timesheet_pdf_snapshots/.test(sql)) {
        const [key,userId,start,end,version,layout,snapshot,data] = params;
        if (!cache.has(key)) cache.set(key,{ source_key:key,user_id:userId,period_start:start,period_end:end,version_no:version,layout_version:layout,snapshot_json:snapshot,document_json:data });
        return [{ affectedRows:1 }];
      }
      if (/UPDATE timesheet_pdf_snapshots SET generation_status/.test(sql)) { const [code,key]=params;if(!cache.get(key).pdf_object_key)Object.assign(cache.get(key),{generation_status:'GENERATION_FAILED',last_error_code:code});return [{affectedRows:1}]; }
      if (/UPDATE timesheet_pdf_snapshots/.test(sql)) {
        const [objectKey,sha,filename,pages,bytes,key] = params, row = cache.get(key);
        if (row.pdf_object_key) return [{ affectedRows:0 }];
        Object.assign(row,{pdf_object_key:objectKey,pdf_sha256:sha,pdf_filename:filename,pdf_pages:pages,pdf_bytes_count:bytes,generation_status:'VALIDATED'});
        return [{ affectedRows:1 }];
      }
      if (/FROM timesheet_pdf_snapshots/.test(sql)) return [[...(cache.has(params[0])?[cache.get(params[0])]:[])]];
      if (/FROM weekly_timesheet_deliveries/.test(sql)) return [db.deliveries];
      if (/FROM document_delivery_requests/.test(sql)) return [db.document ? [db.document] : []];
      if (/SELECT id FROM users WHERE id/.test(sql)) return [[...(params[0]===31&&params[1]===50?[{id:31}]:[])]];
      throw new Error('Unexpected fixture SQL '+sql);
    },
    async getConnection() { return { query:db.query, async beginTransaction(){}, async commit(){db.commits++;}, async rollback(){db.rollbacks++;}, release(){} }; }
  };
  return db;
}
async function main() {
  const objects=new Map(), storage={async putObject(key,buffer,type){assert.equal(type,'application/pdf');objects.set(key,Buffer.from(buffer));},async getObject(key){if(!objects.has(key))throw Object.assign(new Error('Fixture storage unavailable'),{code:'OBJECT_STORAGE_REQUEST_FAILED'});return Buffer.from(objects.get(key));},async deleteObject(key){objects.delete(key);}};
  const artifact=(db,snapshot,retained=null)=>pdfs.snapshotArtifact(db,snapshot,retained,storage);
  const db = fixtureDb(), staff = { id:31,name:'Fixture Employee A',employee_number:'FIXTURE-A',role:'staff',active:1,account_status:'ACTIVE',timesheet_delivery_email:null };
  const period={start:'2026-10-19',end:'2026-10-25',timezone:'Australia/Sydney'};
  const record={id:1,user_id:31,work_date:'2026-10-20',clock_in:'2026-10-19T22:00:00Z',clock_out:'2026-10-20T06:30:00Z',total_minutes:480,total_hours:8,break_minutes:30,timestamp_basis:'UTC',clock_out_timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',entry_source:'CLOCK',notes:'Authorised source only'};
  let records=[record], sourceReads=0;
  const assessment=policy.assessWorkedAttendance(staff,records,period,policy.configuration(),new Date());
  assert.equal(assessment.status,'ELIGIBLE');
  const snapshot={...policy.canonicalSnapshot(staff,assessment,period,1,'DRAFT'),review_version:0,approval_verified:false,generated_at:'2026-10-26T01:00:00.000Z'};
  const frozen=await pdfs.freezeSnapshot(db,snapshot);
  const later=await pdfs.freezeSnapshot(db,{...snapshot,generated_at:'2026-10-27T04:00:00.000Z'});
  assert.deepEqual(later,frozen,'Repeated app and scheduled-email requests share the first authoritative timestamp.');
  const [first,second]=await Promise.all([artifact(db,frozen),artifact(db,later)]);
  assert(first.buffer.equals(second.buffer),'Concurrent generation converges on one immutable PDF.');
  assert.equal(first.validation.sha256,second.validation.sha256);
  assert.match(first.validation.text,/Fixture Employee A/); assert(!first.validation.text.includes('Fixture Employee B'));
  assert.match(first.validation.text,/30 min/); assert.match(first.validation.text,/Provisional/);
  const changed=await pdfs.freezeSnapshot(db,{...snapshot,review_version:1,review_status:'SUBMITTED'});
  assert.notEqual(pdfs.sourceKey(changed),pdfs.sourceKey(frozen));
  assert(first.buffer.equals((await artifact(db,frozen)).buffer),'A new review version cannot overwrite the old PDF.');
  const unavailable={...storage,async putObject(){throw Object.assign(new Error('Fixture storage offline'),{code:'OBJECT_STORAGE_REQUEST_FAILED'});}};
  await assert.rejects(pdfs.snapshotArtifact(db,changed,null,unavailable),failure=>failure.code==='OBJECT_STORAGE_REQUEST_FAILED'&&failure.statusCode===503);
  assert.equal(db.cache.get(pdfs.sourceKey(changed)).generation_status,'GENERATION_FAILED');
  assert((await artifact(db,changed)).validation.pages>=1,'The same failed source retries after storage recovery without an alternative attachment.');
  assert.equal(db.cache.get(pdfs.sourceKey(changed)).generation_status,'VALIDATED');
  await assert.rejects(artifact(db,frozen,{content:Buffer.from('<html>error</html>'),filename:first.filename,sha256:first.validation.sha256}),{code:'PDF_DOCUMENT_INVALID'},'A retained invalid attachment is rejected even when a valid app cache exists.');
  const differentValidBytes=Buffer.concat([first.buffer,Buffer.from('\n% fixture retained transport marker\n')]);
  await validatePdf(differentValidBytes);
  await assert.rejects(artifact(db,frozen,{content:differentValidBytes,filename:first.filename,sha256:crypto.createHash('sha256').update(differentValidBytes).digest('hex')}),{code:'TIMESHEET_PDF_SNAPSHOT_INVALID'},'Different parser-valid retained and cached PDF bytes require review, never silent replacement.');
  const racingDb=fixtureDb();await pdfs.freezeSnapshot(racingDb,frozen);
  const racingObjects=new Map(),racingStorage={async putObject(key,buffer){racingObjects.set(key,Buffer.from(buffer));},async getObject(key){return Buffer.from(racingObjects.get(key));},async deleteObject(key){racingObjects.delete(key);}};
  const originalQuery=racingDb.query;
  racingDb.query=async(sql,params)=>{
    if(/UPDATE timesheet_pdf_snapshots SET pdf_object_key/.test(sql)){
      const row=racingDb.cache.get(pdfs.sourceKey(frozen)),sha=crypto.createHash('sha256').update(differentValidBytes).digest('hex'),objectKey=`timesheet-pdfs/${pdfs.sourceKey(frozen)}/${sha}.pdf`;
      racingObjects.set(objectKey,differentValidBytes);Object.assign(row,{pdf_object_key:objectKey,pdf_sha256:sha,pdf_filename:first.filename,pdf_pages:1,pdf_bytes_count:differentValidBytes.length,generation_status:'VALIDATED'});return [{affectedRows:0}];
    }
    return originalQuery(sql,params);
  };
  await assert.rejects(pdfs.snapshotArtifact(racingDb,frozen,{content:first.buffer,filename:first.filename,sha256:first.validation.sha256},racingStorage),{code:'TIMESHEET_PDF_SNAPSHOT_INVALID'},'A concurrent different winner cannot replace already retained attachment bytes.');

  const weekly={ensureWeeklyTimesheetDeliverySchema:async()=>{},
    periodBounds(start,end,timezone){return {start,end,timezone,startUtc:DateTime.fromISO(start,{zone:timezone}).toUTC().toISO(),endExclusiveUtc:DateTime.fromISO(start,{zone:timezone}).plus({days:7}).toUTC().toISO()};},
    async loadDocumentStaff(_db,id){sourceReads++;return id===31?staff:null;},
    async loadWorkedAttendance(_db,id,p){assert.equal(id,31);assert.equal(p.start,period.start);return records;},
    async loadDocumentReview(){return {status:'DRAFT'};},
    async reviewedDocumentSnapshot(_db,employee,worked,p,version,review,_config,generatedAt){return {...policy.canonicalSnapshot(employee,worked,p,version,review.status),review_version:0,approval_verified:false,generated_at:generatedAt};}
  };
  const dependencies={'luxon':require('luxon'),'../config/db':db,'../services/authorizationService':{canAccessUserRecord:(user,target,options)=>auth.canAccessUserRecord(user,target,{...options,connection:db})},'../services/weeklyTimesheetScheduler':weekly,'../services/weeklyTimesheetEligibility':policy,'../services/timesheetPdfService':{...pdfs,snapshotArtifact:artifact},'../services/emailQueue':{restoreAttachments:require('../services/emailQueue').restoreAttachments}};
  const filename=path.join(__dirname,'../controllers/staffTimesheetPdfController.js'),moduleFixture={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:moduleFixture,exports:moduleFixture.exports,Date,console,require(name){if(!Object.hasOwn(dependencies,name))throw new Error('Unexpected controller dependency '+name);return dependencies[name];}},{filename});
  async function call(user={id:31,role:'staff'},query={week_start:period.start}) {
    const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this;},set(headers){this.headers=headers;return this;},send(bytes){this.body=bytes;return this;},json(body){this.body=body;return this;}};
    await moduleFixture.exports.download({user,query},res); return res;
  }
  const own=await call(); assert.equal(own.statusCode,200,'Missing designated email must not block own PDF download.');
  assert.equal(own.headers['Content-Type'],'application/pdf');assert.match(own.headers['Content-Disposition'],/^attachment; filename="[^"\r\n]+\.pdf"$/);
  assert.equal(own.headers['X-Content-Type-Options'],'nosniff');assert(own.body.equals(first.buffer));
  const preview=await call(undefined,{week_start:period.start,disposition:'inline'});assert(preview.body.equals(own.body));assert.match(preview.headers['Content-Disposition'],/^inline;/);
  await validatePdf(own.body,{expectedText:['Fixture Employee A','FIXTURE-A','19 Oct 2026','25 Oct 2026']});
  const readCount=sourceReads;
  assert.equal((await call({id:32,role:'staff'},{week_start:period.start,user_id:31})).statusCode,403);
  assert.equal(sourceReads,readCount,'Unauthorised employees are blocked before source reads.');
  assert.equal((await call({id:51,role:'manager'},{week_start:period.start,user_id:31})).statusCode,403);
  assert.equal((await call({id:50,role:'manager'},{week_start:period.start,user_id:31})).statusCode,200);
  for(const query of [{week_start:'2026-02-30'},{week_start:'2026-10-20'},{week_start:period.start,user_id:'Infinity'},{week_start:period.start,disposition:'bad'}])assert.equal((await call(undefined,query)).statusCode,422);
  records=[{...record,clock_out:null}]; const review=await call();assert.equal(review.statusCode,409);assert.equal(review.body.code,'ATTENDANCE_REVIEW_REQUIRED');assert(Array.isArray(review.body.issues));
  records=[];assert.equal((await call()).body.code,'NO_ELIGIBLE_WORK');
  records=[{...record,notes:'Legitimate source correction after delivery'}];db.deliveries=[{version:1,status:'SENT',snapshot_json:JSON.stringify(frozen),source_sha256:policy.snapshotHash(frozen)}];
  const countBefore=db.cache.size,sourceChanged=await call();assert.equal(sourceChanged.statusCode,409);assert.equal(sourceChanged.body.code,'SOURCE_CHANGED');assert.equal(db.cache.size,countBefore,'Changed accepted reports require explicit authorised revision, no new v1 download.');assert(first.buffer.equals(await storage.getObject(db.cache.get(pdfs.sourceKey(frozen)).pdf_object_key)));
  const stored=db.cache.get(pdfs.sourceKey(frozen));objects.set(stored.pdf_object_key,Buffer.from('<html>HTTP error</html>'));
  await assert.rejects(artifact(db,frozen),{code:'PDF_DOCUMENT_INVALID'});
  assert(db.queries.filter(sql=>/SELECT snapshot_json,document_json/.test(sql)).every(sql=>/FOR UPDATE/.test(sql)),'Snapshot creation uses current reads after concurrent inserts under REPEATABLE READ.');
  assert([...db.cache.values()].every(row=>!Object.hasOwn(row,'pdf_bytes')),'PDF bytes reside in private object storage, not extra database BLOBs.');
  assert(!db.queries.some(sql=>/INSERT INTO (?:email_queue|weekly_timesheet_deliveries)/.test(sql)),'PDF preview/download never queues an email or starts routine delivery.');
  console.log('Staff weekly PDF tests passed: parser-valid own PDF without email; exact preview/download/concurrent cached bytes; immutable source versions; recorded breaks/status; team boundaries; review/no-work blocks; corrupt bytes rejected; no email side effects.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
