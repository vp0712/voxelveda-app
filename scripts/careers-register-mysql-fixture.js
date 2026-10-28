'use strict';
const crypto=require('node:crypto');
module.exports=async function runCareersRegisterMysqlFixture({pool,assert,facts}){
 if(process.env.NODE_ENV!=='test'||process.env.REPAIR_DB_TEST!=='true')throw new Error('Career register fixtures require the existing disposable MySQL test environment.');
 const [[identity]]=await pool.query('SELECT DATABASE() AS name');assert.equal(identity.name,'voxelveda_repair_test');
 const controller=require('../controllers/careersController');
 const prefix='CAREERS-'+crypto.randomBytes(5).toString('hex').toUpperCase();
 const [[reviewer]]=await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');assert(reviewer);
 const actor={id:Number(reviewer.id),role:'synthetic-reviewer',permissions:['VIEW_STAFF_HR','EDIT_STAFF_HR']};
 let jobId,insertedId;const originalGetConnection=pool.getConnection;
 const list=async query=>{const res={json(body){this.body=body;return this;}};await controller.listApplications({user:actor,query},res);return res.body;};
 try{
  const [job]=await pool.query(`INSERT INTO career_jobs(slug,title,department,location,employment_type,summary,responsibilities_json,requirements_json,status) VALUES(?,?,?,?,?,?,?,?,'OPEN')`,[prefix.toLowerCase(),prefix+' synthetic vacancy',prefix,'Synthetic location','Fixture','Disposable test only','[]','[]']);jobId=job.insertId;
  const statuses=['NEW','SCREENING','SHORTLISTED','INTERVIEW','TECHNICAL_ASSESSMENT','REFERENCE_CHECK','OFFER','HIRED','REJECTED','TALENT_POOL'];
  const rows=Array.from({length:650},(_,i)=>[crypto.randomUUID(),jobId,prefix+' '+String(i).padStart(4,'0')+(i===0?' 100%_!':''),'candidate-'+i+'@example.invalid','0000','Authorised fixture',statuses[i%statuses.length],'2026-10-01 00:00:00','2026-10-01 00:00:00']);
  await pool.query('INSERT INTO career_applications(public_id,job_id,full_name,email,phone,work_rights,status,consent_at,created_at) VALUES ?', [rows]);
  const ids=new Set();let first;
  for(let page=1;page<=26;page++){const result=await list({department:prefix,page:String(page),page_size:'25',sort:'full_name',direction:'asc'});first ||= result;assert.equal(result.total,650);assert.equal(result.pages,26);assert.equal(result.page,page);assert.equal(result.applications.length,25);for(const row of result.applications){assert(!ids.has(row.id));ids.add(row.id);}}
  assert.equal(ids.size,650,'Records after the former 500-row cap remain reachable');assert.equal(first.summary.active,520);assert.equal(first.summary.offer_hired,130);
  const filtered=await list({department:prefix,status:'NEW'});assert.equal(filtered.total,65);assert.equal(filtered.summary.active,65);assert.equal(filtered.summary.offer_hired,0);
  const literal=await list({department:prefix,search:'100%_!'});assert.equal(literal.total,1);assert(literal.applications[0].full_name.endsWith('100%_!'));
  const target=literal.applications[0],change={user:actor,params:{id:String(target.id)},body:{status:'OFFER',expected_status:'NEW',note:'Synthetic fixture: evidenced pipeline review'},ip:'127.0.0.1',get:()=>null};
  const saved={json(body){this.body=body;return this;}};await controller.updateApplicationStatus(change,saved);assert.equal(saved.body.status,'OFFER');
  const duplicate={json(body){this.body=body;return this;}};await controller.updateApplicationStatus(change,duplicate);assert.equal(duplicate.body.unchanged,true);
  const persisted=await list({department:prefix,search:'100%_!'});assert.equal(persisted.applications[0].status,'OFFER','Saved pipeline state survives a new connection/read');
  const [[events]]=await pool.query("SELECT COUNT(*) AS total FROM career_application_events WHERE application_id=? AND event_type='STATUS_CHANGED'",[target.id]);assert.equal(Number(events.total),1,'Safe status retry retains one history event');
  let injected=false;
  pool.getConnection=async function(...args){const connection=await originalGetConnection.apply(this,args),query=connection.query,release=connection.release;connection.query=async(sql,params)=>{const result=await query.call(connection,sql,params);if(!injected&&String(sql).startsWith('SELECT COUNT')){injected=true;const [added]=await pool.query(`INSERT INTO career_applications(public_id,job_id,full_name,email,phone,work_rights,status,consent_at,created_at) VALUES(?,?,?,?,?,?,'NEW',NOW(),'2026-10-02 00:00:00')`,[crypto.randomUUID(),jobId,prefix+' concurrent candidate','concurrent@example.invalid','0000','Fixture']);insertedId=added.insertId;}return result;};connection.release=function(){connection.query=query;connection.release=release;return release.call(connection);};return connection;};
  const consistent=await list({department:prefix,sort:'created_at',direction:'desc'});assert(injected);assert.equal(consistent.total,650);assert(!consistent.applications.some(row=>row.id===insertedId),'Count and rows share one read-only database snapshot');
  pool.getConnection=originalGetConnection;
  const fresh=await list({department:prefix,sort:'created_at',direction:'desc'});assert.equal(fresh.total,651);assert.equal(fresh.applications[0].id,insertedId);
  facts.push('real recruitment register traverses all 650 rows over 26 pages beyond the former 500 cap; accurate filtered aggregates, literal wildcard search, saved/idempotent audited status and concurrent count/page snapshot consistency');
 }finally{pool.getConnection=originalGetConnection;if(jobId){await pool.query('DELETE e FROM career_application_events e JOIN career_applications a ON a.id=e.application_id WHERE a.job_id=?',[jobId]);await pool.query('DELETE FROM career_applications WHERE job_id=?',[jobId]);await pool.query('DELETE FROM career_jobs WHERE id=?',[jobId]);}}
};
