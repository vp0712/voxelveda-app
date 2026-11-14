const workflow = require('../services/timesheetWorkflowService');

function sendWorkflowError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(`${fallback}:`, error);
  return res.status(status).json({
    message: status >= 500 ? fallback : error.message,
    code: error?.code || 'TIMESHEET_WORKFLOW_ERROR',
    ...(status<500 && error?.fields ? { fields: error.fields } : {}),
    ...(status<500&&Array.isArray(error?.details?.review_issues)?{details:{review_issues:error.details.review_issues.map(issue=>({code:issue.code,attendance_id:issue.attendance_id}))}}:{})
  });
}

exports.list = async (req, res) => {
  try {
    const timesheets = await workflow.listTimesheets({
      user: req.user,
      status: req.query.status || 'ALL',
      userId: req.query.user_id,
      fromDate: req.query.from_date,
      toDate: req.query.to_date
    });
    return res.json({ timesheets });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to load timesheets.');
  }
};

exports.detail = async (req, res) => {
  try {
    return res.json(await workflow.getTimesheetDetail(Number(req.params.id), req.user));
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to load the timesheet.');
  }
};

function approvalRemoved(_req, res) {
  return res.status(410).json({ code: 'TIMESHEET_APPROVAL_REMOVED', message: 'Routine timesheet submission and approval have been removed. Verified worked time is finalised automatically after the reporting week. Authorised reviewers may correct source shifts through Edit timesheet.' });
}
exports.submit = approvalRemoved;
exports.approve = approvalRemoved;
exports.reject = approvalRemoved;
exports.requestCorrection = approvalRemoved;
exports.amend = approvalRemoved;

exports.edit = async (req, res) => {
  try {
    const result = await require('../services/timesheetEditService').editTimesheet({ id: req.params.id, user: req.user, input: req.body || {}, req });
    return res.json(result);
  } catch (error) { return sendWorkflowError(res, error, 'Unable to save the timesheet correction.'); }
};

exports.payrollReady = async (req, res) => {
  try {
    if (!workflow.canViewPayroll(req.user)) {
      return res.status(403).json({ message: 'Payroll-ready access is required.' });
    }
    return res.json({ payroll_ready: await workflow.listPayrollReady() });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to load Payroll Ready.');
  }
};

exports.legacyStatus = approvalRemoved;
