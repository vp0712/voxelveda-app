'use strict';
// In-memory storage only for isolated service/browser checks. Real InnoDB coverage
// lives in retained-mysql-test.js and runs against a disposable CI database.
module.exports=function(){
 let rows=[],audits=[],tail=Promise.resolve();const db={audits:()=>structuredClone(audits),rows:()=>structuredClone(rows),failAudit:false};
 db.audit=async(_db,entry)=>{if(db.failAudit)throw Error('Synthetic audit failure');audits.push(structuredClone(entry));};
 db.query=async(sql,p=[])=>{
  if(sql.startsWith('CREATE TABLE'))return[{},[]];
  if(sql.startsWith('INSERT')){const bootstrap=sql.startsWith('INSERT IGNORE');if(rows.some(r=>r.credential_hash===p[3]||p[4]&&r.request_id===p[4])){if(bootstrap)return[{affectedRows:0}];throw Object.assign(Error('Duplicate fixture key'),{code:'ER_DUP_ENTRY'});}rows.push({id:p[0],site_id:p[1],label:p[2],credential_hash:p[3],request_id:bootstrap?null:p[4],request_sha256:bootstrap?null:p[5],created_by:bootstrap?null:p[6],revision:1,created_at:new Date().toISOString(),revoked_at:null});return[{affectedRows:1}];}
  if(sql.startsWith('UPDATE')){const r=rows.find(r=>r.id===p.at(-1));r.revoked_at=new Date().toISOString();r.revoked_by=p[0];r.revoke_reason=p[1];r.revision++;if(sql.includes('replaced_by=?'))r.replaced_by=p[2];else{r.revoked_request_id=p[2];r.revoked_request_sha256=p[3];}return[{affectedRows:1}];}
  if(sql.startsWith('SELECT * FROM attendance_display_links')){let selected=rows;if(sql.includes('WHERE credential_hash=?'))selected=rows.filter(r=>r.credential_hash===p[0]);else if(sql.includes('WHERE request_id=?'))selected=rows.filter(r=>r.request_id===p[0]);else if(sql.includes('WHERE id=?'))selected=rows.filter(r=>r.id===p[0]&&(!sql.includes('AND site_id=?')||r.site_id===p[1]));else if(sql.includes('WHERE site_id=?'))selected=rows.filter(r=>r.site_id===p[0]);return[structuredClone(selected),[]];}
  throw Error('Unexpected display fixture SQL '+sql.slice(0,80));
 };
 db.getConnection=async()=>{let unlock,prior=tail;tail=new Promise(r=>unlock=r);await prior;let saved,done=false;return{query:db.query,beginTransaction:async()=>{saved={rows:structuredClone(rows),audits:structuredClone(audits)};},commit:async()=>{done=true;},rollback:async()=>{if(!done&&saved){rows=saved.rows;audits=saved.audits;}},release:unlock};};
 return db;
};
