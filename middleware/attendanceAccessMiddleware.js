'use strict';
const requirePermission=require('./permissionMiddleware');
const {requireAnyPermission}=require('./authorizationMiddleware');
const attendance=requirePermission('VIEW_ATTENDANCE');
const ownWeek=requireAnyPermission('VIEW_ATTENDANCE','VIEW_OWN_TIMESHEET');
const timesheets=requireAnyPermission('VIEW_ATTENDANCE','VIEW_OWN_TIMESHEET','VIEW_TEAM_TIMESHEET','VIEW_ALL_TIMESHEETS','APPROVE_TEAM_TIMESHEET','APPROVE_ALL_TIMESHEETS');

// Read/review permissions for the original timesheet workflow cannot grant
// clock actions, a staff directory or attendance administration. Each inner
// timesheet controller still applies its exact record and review authority.
module.exports=function attendanceAccess(req,res,next){
 if(req.method==='GET'&&/^\/week\/?$/.test(req.path))return ownWeek(req,res,next);
 if(/^\/timesheets(?:\/|$)/.test(req.path))return timesheets(req,res,next);
 return attendance(req,res,next);
};
