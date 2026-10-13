'use strict';
const eligibility=require('./weeklyTimesheetEligibility');
const {dateOnly}=require('../utils/dateOnly');
const {DateTime}=require('luxon');
function assessVerifiedAttendance({staff,records,fromDate,toDate,now=new Date(),env=process.env}){
 const start=dateOnly(fromDate),end=dateOnly(toDate);if(!start||!end||start>end)throw Object.assign(new Error('Choose a valid attendance reporting period.'),{statusCode:422,code:'ATTENDANCE_PERIOD_INVALID'});
 const config=eligibility.configuration(env),assessment=eligibility.assessWorkedAttendance(staff,records,{start,end,timezone:config.timezone},config,now);
 let saved=0,invalidSaved=0;for(const row of records){const value=Number(row.total_hours);if(row.total_hours===null||row.total_hours===undefined||row.total_hours===''||!Number.isFinite(value)||value<0){invalidSaved++;continue;}saved+=value;}
 const issues=[...assessment.issues];if(assessment.status==='INELIGIBLE_ACCOUNT'&&records.length)issues.push({code:'INELIGIBLE_ACCOUNT'});
 return{records,eligibleRecords:assessment.rows,totalMinutes:assessment.totalMinutes,actualHours:Math.round(assessment.totalMinutes/60*100)/100,historicalSavedHours:invalidSaved?null:Math.round(saved*100)/100,reviewRequired:issues.length>0,reviewIssues:issues,duplicates:assessment.duplicates,status:issues.length?'REVIEW_REQUIRED':assessment.status,timezone:config.timezone};
}
async function loadVerifiedSummary({db,userId,fromDate,toDate,records,lock=false,now}){
 const [[staff]]=await db.query('SELECT id,name,role,active,deleted_at,account_status,employee_number FROM users WHERE id=?',[userId]);
 if(!records){const start=dateOnly(fromDate),end=dateOnly(toDate),timezone=eligibility.configuration().timezone;if(!start||!end||start>end)throw Object.assign(new Error('Choose a valid attendance reporting period.'),{statusCode:422,code:'ATTENDANCE_PERIOD_INVALID'});const period={start,end,timezone,startUtc:DateTime.fromISO(start,{zone:timezone}).startOf('day').toUTC().toISO(),endExclusiveUtc:DateTime.fromISO(end,{zone:timezone}).plus({days:1}).startOf('day').toUTC().toISO()};records=await require('./weeklyTimesheetScheduler').loadWorkedAttendance(db,userId,period,lock);}
 if(!now){const [[clock]]=await db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') server_utc");const instant=DateTime.fromSQL(String(clock?.server_utc||''),{zone:'UTC'});if(!instant.isValid)throw Object.assign(new Error('The authoritative server clock is unavailable.'),{statusCode:503,code:'ATTENDANCE_SERVER_TIME_INVALID'});now=instant.toJSDate();}
 return assessVerifiedAttendance({staff,records,fromDate,toDate,now});
}
function diagnostics(summary){return{verified_total_minutes:summary.totalMinutes,verified_total_hours:summary.actualHours,historical_saved_hours:summary.historicalSavedHours,verification_status:summary.status,review_required:summary.reviewRequired,review_issues:summary.reviewIssues,duplicate_records:summary.duplicates,eligible_record_count:summary.eligibleRecords.length,source_record_count:summary.records.length,company_timezone:summary.timezone,reporting_basis:'WHOLE_SHIFT_LOCAL_START_DATE'};}
function assertReviewResolved(summary){if(summary.reviewRequired)throw Object.assign(new Error('Attendance source records require authorised correction before this timesheet can be submitted or approved.'),{statusCode:409,code:'TIMESHEET_ATTENDANCE_REVIEW_REQUIRED',details:{review_issues:summary.reviewIssues}});}
module.exports={assessVerifiedAttendance,loadVerifiedSummary,diagnostics,assertReviewResolved};
