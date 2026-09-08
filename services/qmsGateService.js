const pool = require('../config/db');
const { ensureQmsAdvancedSchema } = require('./qmsAdvancedSchema');

async function machineReadiness(machineId) {
  await ensureQmsAdvancedSchema();
  const [[machine]] = await pool.query('SELECT * FROM equipment_assets WHERE id=?', [machineId]);
  if (!machine) return { allowed: false, code: 'MACHINE_NOT_FOUND', reasons: ['Machine not found.'] };
  const reasons = [];
  if (!machine.commissioned) reasons.push('Commissioning is incomplete.');
  if (['LOTO','OUT_OF_SERVICE','QUALITY_HOLD','QUARANTINED','DECOMMISSIONED','MAINTENANCE'].includes(machine.status)) reasons.push(`Machine status is ${machine.status}.`);
  if (machine.critical_safety_issue) reasons.push('A critical safety issue is unresolved.');
  const [[loto]] = await pool.query('SELECT id FROM loto_permits WHERE equipment_id=? AND active=1 LIMIT 1', [machineId]);
  if (loto) reasons.push('An active LOTO permit exists.');
  const [[overdue]] = await pool.query('SELECT id FROM maintenance_plans WHERE equipment_id=? AND active=1 AND blocking_when_overdue=1 AND next_due_date IS NOT NULL AND next_due_date<CURDATE() LIMIT 1', [machineId]);
  if (overdue) reasons.push('Blocking preventive maintenance is overdue.');
  const [[fault]] = await pool.query("SELECT id FROM equipment_faults WHERE equipment_id=? AND status<>'RESOLVED' AND severity IN ('HIGH','CRITICAL') LIMIT 1", [machineId]);
  if (fault) reasons.push('A high or critical machine fault is unresolved.');
  return { allowed: reasons.length === 0, machine, reasons };
}

async function operatorReadiness(userId, machineId, requiredCompetencyCode) {
  await ensureQmsAdvancedSchema();
  const reasons = [];
  const [[auth]] = await pool.query(`SELECT oa.*, c.competency_code
    FROM operator_authorisations oa LEFT JOIN competencies c ON c.id=oa.competency_id
    WHERE oa.user_id=? AND oa.equipment_id=? LIMIT 1`, [userId, machineId]);
  if (!auth || auth.status !== 'VALID') reasons.push('Operator is not currently authorised for this machine.');
  if (auth?.valid_until && new Date(auth.valid_until) < new Date(new Date().toDateString())) reasons.push('Machine authorisation has expired.');
  if (requiredCompetencyCode) {
    const [[comp]] = await pool.query(`SELECT ec.* FROM employee_competencies ec JOIN competencies c ON c.id=ec.competency_id
      WHERE ec.user_id=? AND c.competency_code=? LIMIT 1`, [userId, requiredCompetencyCode]);
    if (!comp || comp.status !== 'VALID') reasons.push(`Required competency ${requiredCompetencyCode} is not valid.`);
    if (comp?.expires_at && new Date(comp.expires_at) < new Date(new Date().toDateString())) reasons.push(`Required competency ${requiredCompetencyCode} has expired.`);
  }
  return { allowed: reasons.length === 0, reasons };
}

async function measurementEquipmentReadiness(equipmentId) {
  await ensureQmsAdvancedSchema();
  const [[equipment]] = await pool.query('SELECT * FROM measurement_equipment WHERE id=?', [equipmentId]);
  if (!equipment) return { allowed: false, reasons: ['Measurement equipment not found.'] };
  const reasons = [];
  if (['EXPIRED','SUSPENDED','OUT_OF_TOLERANCE'].includes(equipment.status)) reasons.push(`Measurement equipment status is ${equipment.status}.`);
  if (equipment.due_date && new Date(equipment.due_date) < new Date(new Date().toDateString())) reasons.push('Calibration due date has passed.');
  return { allowed: reasons.length === 0, equipment, reasons };
}

async function jobReleaseReadiness(jobId) {
  await ensureQmsAdvancedSchema();
  const reasons = [];
  const [[job]] = await pool.query('SELECT * FROM manufacturing_jobs WHERE id=?', [jobId]);
  if (!job) return { allowed: false, reasons: ['Manufacturing job not found.'] };
  const [[hold]] = await pool.query("SELECT id FROM quality_holds WHERE active=1 AND ((entity_type='JOB' AND entity_id=?) OR (entity_type='BUILD' AND entity_id IN (SELECT CAST(id AS CHAR) FROM job_builds WHERE job_id=?)) OR (entity_type='SERIAL' AND entity_id IN (SELECT CAST(id AS CHAR) FROM job_serials WHERE job_id=?))) LIMIT 1", [String(jobId), jobId, jobId]);
  if (hold) reasons.push('An active quality hold affects this job.');
  const [[failed]] = await pool.query("SELECT ir.id FROM inspection_runs ir WHERE ir.job_id=? AND ir.status='FAIL' LIMIT 1", [jobId]);
  if (failed) reasons.push('A failed inspection remains associated with this job.');
  const [[openNcr]] = await pool.query("SELECT id FROM ncrs WHERE job_id=? AND status<>'CLOSED' LIMIT 1", [jobId]);
  if (openNcr) reasons.push('An NCR remains open for this job.');
  return { allowed: reasons.length === 0, job, reasons };
}

module.exports = { machineReadiness, operatorReadiness, measurementEquipmentReadiness, jobReleaseReadiness };
