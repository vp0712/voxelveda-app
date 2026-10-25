'use strict';

// Request handlers observe these original registers; only the startup migration
// runner may create or extend them. Successful observations are shared per pool.
const pool = require('../config/db');
const TABLES = Object.freeze({
  competitors: ['id','company_name','category','country','city','website','capabilities','materials','target_market','strength','source_type','source_url','notes','created_by','updated_by','created_at','updated_at','deleted'],
  access_attempts: ['id','user_id','user_name','user_email','section','action','method','path','created_at'],
  customers: ['id','company_name','contact_name','email','phone','address','notes','file_link','created_by','updated_by','created_at','updated_at','deleted'],
  meetings: ['id','title','meeting_type','organisation','contact_person','contact_details','location_type','location_details','meeting_date','meeting_time','agenda','required_preparation','assigned_user_ids','status','created_by','updated_by','deleted','created_at','updated_at'],
  app_settings: ['setting_key','setting_value','updated_at'],
  announcements: ['id','title','message','priority','starts_at','expires_at','audience_type','target_user_ids','created_by','deleted','created_at','updated_at'],
  staff_messages: ['id','user_id','priority','body','status','deleted','created_at','reviewed_at','reviewed_by'],
  staff_work_requests: ['id','user_id','request_type','title','body','payload','status','deleted','created_at','reviewed_at','reviewed_by']
});
const observations = new WeakMap();

function schemaFailure(table, missing = [], cause = null) {
  const error = new Error('This register is unavailable until its database compatibility check succeeds. Please retry or contact support.');
  error.code = cause ? 'ORIGINAL_REGISTER_SCHEMA_CHECK_FAILED' : 'ORIGINAL_REGISTER_SCHEMA_NOT_READY';
  error.statusCode = 503;
  // Internal diagnostics only; controllers must never return these details.
  error.details = { table, missing_columns: missing, cause_code: cause?.code || null };
  return error;
}

function cacheFor(db) {
  if (!observations.has(db)) observations.set(db, new Map());
  return observations.get(db);
}

function assertOriginalRegisterSchema(table, db = pool) {
  if (!Object.hasOwn(TABLES, table)) throw new TypeError('Unsupported original register');
  const cache = cacheFor(db);
  if (!cache.has(table)) {
    const assertion = (async () => {
      let rows;
      try {
        [rows] = await db.query(`SELECT COLUMN_NAME AS column_name, COLUMN_KEY AS column_key, DATA_TYPE AS data_type, EXTRA AS extra
          FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`, [table]);
      } catch (error) { throw schemaFailure(table, [], error); }
      const columns = new Map(rows.map(row => [String(row.column_name || row.COLUMN_NAME).toLowerCase(), row]));
      const missing = TABLES[table].filter(name => !columns.has(name));
      const identityName = table === 'app_settings' ? 'setting_key' : 'id';
      const identity = columns.get(identityName);
      if (identity && String(identity.column_key || identity.COLUMN_KEY).toUpperCase() !== 'PRI') missing.push(identityName + ':primary_key');
      if (identity && table !== 'app_settings' && !['tinyint','smallint','mediumint','int','bigint'].includes(String(identity.data_type || identity.DATA_TYPE).toLowerCase())) missing.push('id:integer_identity');
      if (identity && table !== 'app_settings' && !String(identity.extra || identity.EXTRA || '').includes('auto_increment')) missing.push('id:auto_increment');
      if (missing.length) throw schemaFailure(table, missing);
      return { table, compatible: true };
    })().catch(error => { cache.delete(table); throw error; });
    cache.set(table, assertion);
  }
  return cache.get(table);
}

async function assertOriginalRegisterSchemas(db = pool) {
  const results = [];
  for (const table of Object.keys(TABLES)) results.push(await assertOriginalRegisterSchema(table, db));
  return results;
}

module.exports = { TABLES, assertOriginalRegisterSchema, assertOriginalRegisterSchemas };
