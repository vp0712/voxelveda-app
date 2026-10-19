'use strict';
const pool = require('../config/db');
const { hasPermission, canAccessUserRecord } = require('../services/authorizationService');
const weekly = require('../services/weeklyTimesheetScheduler');
const { dateOnly } = require('../utils/dateOnly');
function failure(res, error) {
  if (Number(error.statusCode || 500) >= 500) console.error('Weekly delivery action failed:', error.code || error.name);
  return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Unable to process the weekly delivery.', code: error.code || 'WEEKLY_DELIVERY_FAILED', reason: error.reasonCode || null, delivery_id: error.delivery_id, version: error.version });
}
async function permitted(user, staffId, connection = pool) {
  return canAccessUserRecord(user, staffId, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection });
}
exports.list = async (req, res) => {
  try {
    await weekly.ensureWeeklyTimesheetDeliverySchema();
    const filters = [], params = [];
    if (!hasPermission(req.user, 'VIEW_ALL_TIMESHEETS')) {
      if (hasPermission(req.user, 'VIEW_TEAM_TIMESHEET')) {
        filters.push(hasPermission(req.user, 'VIEW_OWN_TIMESHEET') ? '(u.manager_id=? OR d.user_id=?)' : '(u.manager_id=? AND d.user_id<>?)');
        params.push(req.user.id, req.user.id);
      }
      else if (hasPermission(req.user, 'VIEW_OWN_TIMESHEET')) { filters.push('d.user_id=?'); params.push(req.user.id); }
      else return res.status(403).json({ message: 'Timesheet access is not enabled for this account.' });
    }
    if (req.query.user_id) {
      const userId = Number(req.query.user_id);
      if (!Number.isSafeInteger(userId) || userId < 1) return res.status(422).json({ message: 'Select valid staff.' });
      filters.push('d.user_id=?'); params.push(userId);
    }
    for (const [key, operator] of [['from_date', '>='], ['to_date', '<=']]) if (req.query[key]) {
      const value = dateOnly(req.query[key]);
      if (!value) return res.status(422).json({ message: 'Enter a valid reporting date.', fields: { [key]: 'Enter a real date' } });
      filters.push(`d.period_start${operator}?`); params.push(value);
    }
    if (req.query.status) { if (!/^[A-Z_]{3,40}$/.test(req.query.status)) return res.status(422).json({ message: 'Select a valid delivery status.' }); filters.push('d.status=?'); params.push(req.query.status); }
    const page = Number(req.query.page || 1), size = Number(req.query.page_size || 25);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(size) || size < 1 || size > 100) return res.status(422).json({ message: 'Use valid pagination.' });
    const where = filters.length ? 'WHERE '+filters.join(' AND ') : '';
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM weekly_timesheet_deliveries d JOIN users u ON u.id=d.user_id ${where}`, params);
    const [deliveries] = await pool.query(`SELECT d.id,d.user_id,u.name AS staff_name,d.period_start,d.period_end,d.timezone,d.version,d.status,
      d.total_minutes,d.review_reasons_json,d.last_error_code,d.email_queue_id,d.document_request_id,d.provider_accepted_at,d.sent_at,d.updated_at,
      d.revision_authorised_by,d.revision_authorised_at,d.revision_reason,d.source_sha256
      FROM weekly_timesheet_deliveries d JOIN users u ON u.id=d.user_id ${where}
      ORDER BY d.period_start DESC,d.id DESC LIMIT ? OFFSET ?`, [...params,size,(page-1)*size]);
    return res.json({ deliveries, page, page_size: size, total: Number(count.total), schedule: weekly.getWeeklyTimesheetSchedule(), provider_acceptance_is_receipt: false });
  } catch (error) { return failure(res, error); }
};
exports.detail = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(422).json({ message: 'Select a valid delivery.' });
    await weekly.ensureWeeklyTimesheetDeliverySchema();
    const [[delivery]] = await pool.query('SELECT * FROM weekly_timesheet_deliveries WHERE id=?', [id]);
    if (!delivery) return res.status(404).json({ message: 'Weekly delivery not found.' });
    if (!await permitted(req.user, delivery.user_id)) return res.status(403).json({ message: 'This employee timesheet is outside your access.' });
    const [versions] = await pool.query(`SELECT version,user_id,period_start,period_end,total_minutes,status,source_sha256,
      email_queue_id,document_request_id,created_by,reason,created_at FROM weekly_timesheet_delivery_versions WHERE delivery_id=? ORDER BY version DESC`, [id]);
    delete delivery.claim_token; delete delivery.claim_expires_at;
    return res.json({ delivery, versions, provider_acceptance_is_receipt: false });
  } catch (error) { return failure(res, error); }
};
function requestedRecipients(body) { return ['recipient','to','cc','bcc','include_employee'].some((key) => Object.hasOwn(body || {}, key)); }
async function revise(req, res, retryGeneration) {
  try {
    if (requestedRecipients(req.body)) return res.status(422).json({ message: 'Weekly delivery uses only the staff member’s saved timesheet-delivery address. Copies and recipient overrides are not allowed.', code: 'WEEKLY_RECIPIENT_OVERRIDE_DENIED' });
    const result = await weekly.queueWeeklyTimesheetRevision({ actor: req.user, deliveryId: req.params.id || req.body.delivery_id,
      expectedVersion: req.body.expected_version, reason: req.body.reason, retryGeneration,
      confirmPossiblePreviousDelivery: req.body.confirm_possible_previous_delivery === true });
    return res.status(202).json({ message: retryGeneration ? 'The validated weekly PDF is queued for controlled delivery.' : 'The authorised timesheet correction is queued as a new labelled revision.', ...result, email_sent: false });
  } catch (error) { return failure(res, error); }
}
exports.revise = (req, res) => revise(req, res, false);
exports.retryGeneration = (req, res) => revise(req, res, true);
exports.legacySend = (req, res) => revise(req, res, req.body.retry_generation === true);

exports.reconciliation = async (req,res) => {
  try {
    if (!['VIEW_OWN_TIMESHEET','VIEW_TEAM_TIMESHEET','VIEW_ALL_TIMESHEETS'].some(permission=>hasPermission(req.user,permission))) return res.status(403).json({message:'Timesheet access is not enabled for this account.'});
    const page=Number(req.query.page ?? 1),size=Number(req.query.page_size ?? 20);
    if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(size)||size<1||size>100) return res.status(422).json({message:'Use valid pagination.'});
    if(Boolean(req.query.from_date)!==Boolean(req.query.to_date))return res.status(422).json({message:'Select both reporting dates.'});
    if(req.query.from_date&&(!dateOnly(req.query.from_date)||!dateOnly(req.query.to_date)))return res.status(422).json({message:'Use valid reporting dates.'});
    await weekly.ensureWeeklyTimesheetDeliverySchema();
    const result=await require('../services/weeklyTimesheetReconciliation').reconcileWeek({actor:req.user,start:req.query.from_date,end:req.query.to_date});
    const search=String(req.query.search||'').trim().toLowerCase();
    if(search.length>120)return res.status(422).json({message:'Search must be at most 120 characters.'});
    const selectedStatus=String(req.query.status||'');
    if(!['','NO_WORK','NO_RECIPIENT','MISSING_DELIVERY','REVIEW_REQUIRED','QUEUED','RETRYING','FAILED','GENERATION_FAILED','PREPARING','SENDING','PROVIDER_ACCEPTED','DELIVERY_UNKNOWN','INELIGIBLE_ACCOUNT','LEGACY_WEEKLY_DELIVERY_REVIEW'].includes(selectedStatus))return res.status(422).json({message:'Choose a valid weekly state.'});
    const rows=result.outcomes.filter(row=>(!search||String(row.staff_name).toLowerCase().includes(search))&&(!selectedStatus||(selectedStatus==='NO_RECIPIENT'?!row.recipient_configured&&(row.verified_minutes>0||row.eligibility==='REVIEW_REQUIRED'):row.status===selectedStatus||row.eligibility===selectedStatus)));
    const sort=String(req.query.sort || 'staff');if(!['staff','hours','status'].includes(sort))return res.status(422).json({message:'Choose a valid weekly sort.'});
    rows.sort((a,b)=>(sort==='hours'?b.verified_minutes-a.verified_minutes:sort==='status'?String(a.status).localeCompare(String(b.status)):String(a.staff_name).localeCompare(String(b.staff_name)))||a.user_id-b.user_id);
    const counts={};for(const row of rows){counts[row.eligibility]=(counts[row.eligibility]||0)+1;counts['delivery_'+row.status]=(counts['delivery_'+row.status]||0)+1;}
    return res.set('Cache-Control','private, no-store').json({...result,week_counts:result.counts,counts,counts_scope:'FILTERED_RESULTS',week_counts_scope:'AUTHORISED_WEEK',outcomes:rows.slice((page-1)*size,page*size),total:rows.length,page,page_size:size,pages:Math.max(1,Math.ceil(rows.length/size)),schedule:weekly.getWeeklyTimesheetSchedule()});
  }catch(error){return failure(res,error);}
};
