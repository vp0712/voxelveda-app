const fs = require('fs');
const path = require('path');
function read(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8')}
function expect(src,needle,msg){if(!src.includes(needle))throw new Error(msg||`Missing: ${needle}`)}

const schema=read('services/qmsAdvancedSchema.js');
const gates=read('services/qmsGateService.js');
const validation=read('services/qmsValidationService.js');
const records=read('controllers/qms/recordController.js');
const ops=read('controllers/qmsOperationsController.js');
const routes=read('routes/qmsRoutes.js');
const app=read('app.js');
const server=read('server.js');

for(const table of [
  'qms_form_definitions','qms_form_definition_versions','qms_record_values','qms_record_links','qms_record_evidence','qms_record_comments','qms_record_holds',
  'manufacturing_jobs','job_operations','job_operation_events','job_material_allocations','job_builds','job_build_parameters','job_serials','material_lots','material_genealogy','quality_holds','production_releases',
  'equipment_assets','equipment_commissioning','maintenance_plans','maintenance_work_orders','equipment_faults','loto_permits',
  'measurement_equipment','calibration_events','out_of_tolerance_events','competencies','employee_competencies','operator_authorisations',
  'inspection_plans','inspection_characteristics','inspection_runs','inspection_measurements','ncrs','capas','capa_actions','capa_effectiveness_checks'
]) expect(schema,table,`Operational QMS schema missing ${table}`);

expect(validation,'required_when','Conditional required-field validation missing');
expect(validation,'requires_evidence','Evidence validation missing');
expect(validation,'blockingIssues','Blocking workflow validation missing');
expect(gates,'Commissioning is incomplete.','Machine commissioning gate missing');
expect(gates,'An active LOTO permit exists.','LOTO gate missing');
expect(gates,'Blocking preventive maintenance is overdue.','Maintenance gate missing');
expect(gates,'Required competency','Competency gate missing');
expect(gates,'Calibration due date has passed.','Calibration gate missing');
expect(records,'Separation of duties: the preparer cannot provide final approval.','Controlled-record SoD missing');
expect(records,'qms_record_evidence','Controlled evidence retrieval missing');
expect(records,'qms_record_values','Structured record values missing');
expect(records,'QMS_RECORD_HOLD_PLACED','Record hold audit event missing');
expect(ops,'QMS_LEGACY_RECORD_IMPORTED','User-controlled legacy import missing');
expect(ops,'QUALITY_HOLD_PLACED','Quality hold audit missing');
expect(ops,'NCR_CREATED','NCR workflow missing');
expect(ops,'CAPA_CREATED','CAPA workflow missing');
expect(routes,"requireAnyPermission('VIEW_QMS', 'VIEW_COMPLIANCE')",'Granular QMS read permission missing');
expect(routes,"requireStepUp('qms:legacy-import')",'Legacy import step-up missing');
expect(routes,"requireStepUp('qms:release-quality-hold')",'Quality-hold release step-up missing');
if(!/app\.use\('\/api\/qms',\s*auth,\s*qmsRoutes\)/.test(app))throw new Error('First-class /api/qms mount missing');
expect(server,'ensureQmsAdvancedSchema()','Operational QMS/MES schema startup ensure missing');

console.log('QMS operational foundation checks passed.');
