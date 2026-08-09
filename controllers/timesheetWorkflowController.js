const workflow = require('../services/timesheetWorkflowService');

function sendWorkflowError(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error(`${fallback}:`, error);
  return res.status(status).json({
    message: status >= 500 ? fallback : error.message,
    code: error?.code || 'TIMESHEET_WORKFLOW_ERROR'
  });
}

exports.list = async (req, res) => {
  try {
    if (!workflow.canApprove(req.user)) {
      return res.status(403).json({ message: 'Timesheet review permission is required.' });
    }
    const timesheets = await workflow.listTimesheets({
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

exports.submit = async (req, res) => {
  try {
    const timesheet = await workflow.submitTimesheet(Number(req.params.id), req.user, req);
    return res.json({ message: 'Timesheet submitted for approval.', timesheet });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to submit the timesheet.');
  }
};

exports.approve = async (req, res) => {
  try {
    const timesheet = await workflow.approveTimesheet(Number(req.params.id), req.user, {
      approvedHours: req.body.approved_hours,
      comments: req.body.comments,
      reason: req.body.reason
    }, req);
    return res.json({ message: 'Timesheet approved and added to Payroll Ready.', timesheet });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to approve the timesheet.');
  }
};

exports.reject = async (req, res) => {
  try {
    const timesheet = await workflow.reviewTimesheet(
      Number(req.params.id), req.user, 'REJECT', req.body.comments, req
    );
    return res.json({ message: 'Timesheet rejected.', timesheet });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to reject the timesheet.');
  }
};

exports.requestCorrection = async (req, res) => {
  try {
    const timesheet = await workflow.reviewTimesheet(
      Number(req.params.id), req.user, 'REQUEST_CORRECTION', req.body.comments, req
    );
    return res.json({ message: 'Correction requested from the staff member.', timesheet });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to request a correction.');
  }
};

exports.amend = async (req, res) => {
  try {
    const timesheet = await workflow.amendApprovedTimesheet(Number(req.params.id), req.user, {
      approvedHours: req.body.approved_hours,
      reason: req.body.reason
    }, req);
    return res.json({ message: 'Approved timesheet amended with a new audit version.', timesheet });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to amend the approved timesheet.');
  }
};

exports.payrollReady = async (req, res) => {
  try {
    if (!workflow.canApprove(req.user)) {
      return res.status(403).json({ message: 'Payroll-ready access is required.' });
    }
    return res.json({ payroll_ready: await workflow.listPayrollReady() });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to load Payroll Ready.');
  }
};

exports.legacyStatus = async (req, res) => {
  const id = Number(req.body.id);
  const status = String(req.body.status || '').trim().toUpperCase();
  try {
    if (status === 'APPROVED') {
      const timesheet = await workflow.approveTimesheet(id, req.user, {
        approvedHours: req.body.approved_hours,
        comments: req.body.comments
      }, req);
      return res.json({ message: 'Timesheet approved and added to Payroll Ready.', timesheet });
    }
    if (status === 'REJECTED') {
      const timesheet = await workflow.reviewTimesheet(
        id, req.user, 'REJECT', req.body.comments || 'Rejected during manager review.', req
      );
      return res.json({ message: 'Timesheet rejected.', timesheet });
    }
    if (status === 'CORRECTION_REQUIRED') {
      const timesheet = await workflow.reviewTimesheet(
        id, req.user, 'REQUEST_CORRECTION', req.body.comments || 'Please review and correct this timesheet.', req
      );
      return res.json({ message: 'Correction requested.', timesheet });
    }
    return res.status(400).json({ message: 'Use Approve, Reject, or Request Correction for submitted timesheets.' });
  } catch (error) {
    return sendWorkflowError(res, error, 'Unable to update the timesheet.');
  }
};
