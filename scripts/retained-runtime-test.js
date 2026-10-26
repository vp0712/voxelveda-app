'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');

function load(filename, dependencies, env = {}) {
  const module = { exports: {} };
  const requireFixture = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected retained-runtime dependency: ${name}`);
  };
  const context = {
    module, exports: module.exports, require: requireFixture,
    __dirname: path.dirname(filename), __filename: filename,
    Buffer, URL, Date, Set, Map, Promise, setTimeout, clearTimeout,
    process: { env, pid: 100, uptime: () => 1 },
    console: { log() {}, warn() {}, error() {} }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
}

async function testStartup() {
  for (const failure of ['none', 'database', 'retained']) {
    const databaseFails = failure === 'database', retainedFails = failure === 'retained';
    const calls = [];
    const runtime = require('../services/runtimeState');
    const schemas = {
      securitySchema: 'ensureSecuritySchema',
      securityOperationsSchema: 'ensureSecurityOperationsSchema',
      operationalTrustSchema: 'ensureOperationalTrustSchema',
      securityGovernanceSchema: 'ensureSecurityGovernanceSchema',
      emailQueueSchema: 'ensureEmailQueueSchema'
    };
    const dependencies = {
      dotenv: { config: () => ({}) },
      './config/security': { validateSecurityEnvironment: () => ({ warnings: [] }) },
      './app': { listen: () => {
        calls.push('listen');
        const server = new EventEmitter();
        server.listening = true;
        server.close = (done) => { server.listening = false; done(); };
        queueMicrotask(() => server.emit('listening'));
        return server;
      } },
      './config/db': { end: async () => calls.push('pool.close') },
      './services/emailService': { isEmailConfigured: () => false },
      './services/emailQueueWorker': {
        startEmailQueueWorker: () => { calls.push('email.start'); return false; },
        stopEmailQueueWorker: () => calls.push('email.stop')
      },
      './services/databaseRuntimeService': {
        verifyDatabaseConnection: async () => {
          calls.push('database');
          if (databaseFails) throw Object.assign(new Error('Connection denied'), { code: 'DB_TEST_DENIED' });
        },
        refreshDatabaseAttestation: async () => calls.push('attestation')
      },
      './services/databaseCapacityRecoveryService': { recoverDatabaseCapacity: async () => calls.push('capacity') },
      './services/migrationRunner': { runMigrations: async () => {
        calls.push('migrations'); return { schema_version: 'retained_fixture', applied: 0, skipped: 1 };
      } },
      './services/retainedMigrationRunner': { runRetainedMigrations: async () => {
        calls.push('retained.migrations');
        if (retainedFails) throw Object.assign(new Error('Current original migration failed'), { code: 'CURRENT_SCHEMA_FIXTURE_FAILED' });
        return { schema_version: 'current_original_fixture', discovered: 1, applied: 0, baselined: 0, skipped: 1 };
      } },
      './services/outboundRequestPolicy': { allowedHosts: () => new Set() },
      './services/rateLimitService': { getRateLimitService: () => ({
        initialize: async () => { calls.push('limiter'); return { provider: 'REDIS', distributed: true }; },
        close: async () => calls.push('limiter.close')
      }) },
      './services/malwareScannerService': {},
      './services/objectStorageService': {},
      './services/procurementLocalOcrService': {ocrCapability:()=>({enabled:false,available:false,runtimeVerified:false})},
      './services/webhookSecurityService': {},
      './config/backupRestoreAssurance': {},
      './services/backgroundJobService': { backgroundJobService: {
        initialize: async () => { calls.push('jobs'); return { registered_jobs: 1 }; }
      } },
      './services/runtimeState': runtime
    };
    for (const [filename, method] of Object.entries(schemas)) {
      dependencies[`./services/${filename}`] = { [method]: async () => calls.push(filename) };
    }
    const originalSchemas={rfqSchema:'ensureRfqSchema',hrAdministrationSchema:'ensureHrAdministrationSchema',workforceSchema:'ensureWorkforceSchema',notificationSchema:'ensureNotificationSchema',trashSchema:'ensureTrashSchema',workflowSchema:'ensureWorkflowSchema',procurementSchema:'ensureProcurementSchema',procurementImportSchema:'ensureProcurementImportSchema',procurementReportService:'ensureProcurementReportSchema',careersSchema:'ensureCareersSchema',employeeIdentitySchema:'ensureEmployeeIdentitySchema',qmsSchema:'ensureQmsSchema',qmsAdvancedSchema:'ensureQmsAdvancedSchema',qmsQualityGovernanceSchema:'ensureQmsQualityGovernanceSchema',qmsEnterpriseCompletionSchema:'ensureQmsEnterpriseCompletionSchema'};
    const originalControllers={invoice:'ensureInvoiceColumns',customer:'ensureCustomerTable',stock:'ensureStockTable',material:'ensureMaterialTable',supplier:'ensureSupplierTables',meeting:'ensureMeetingTable',task:'ensureTaskTables',roster:'ensureRosterTable',attendance:'ensureAttendanceTables',expense:'ensureExpenseTables',compliance:'ensureComplianceTables',dashboard:'ensureDashboardTables'};
    for(const [name,method] of Object.entries(originalSchemas))dependencies['./services/'+name]={[method]:async()=>calls.push(name)};
    for(const [name,method] of Object.entries(originalControllers))dependencies['./controllers/'+name+'Controller']={[method]:async()=>calls.push(name)};
    dependencies['./services/originalSchemaInventory']={inspectOriginalSchema:async()=>{calls.push('original.preflight');return {existingTableCount:20,originalTableCount:20,compatible:true,missingTables:[],missingColumns:[]}}};
    dependencies['./services/weeklyTimesheetScheduler']={getWeeklyTimesheetSchedule:()=>({timezone:'Australia/Sydney',next_due_utc:'2026-10-19T20:00:00Z'}),startWeeklyTimesheetScheduler:()=>{calls.push('timesheet.start');return true},stopWeeklyTimesheetScheduler:()=>calls.push('timesheet.stop')};
    dependencies['./services/documentDeliveryService']={ensureDocumentDeliverySchema:async()=>calls.push('documentDeliverySchema')};
    dependencies['./services/weeklyTimesheetDeliverySchema']={ensureWeeklyTimesheetDeliverySchema:async()=>calls.push('weeklyTimesheetDeliverySchema')};
    dependencies['./services/profilePhotoService']={ensureProfilePhotoSchema:async()=>calls.push('profilePhotoSchema')};
    dependencies['./services/workflowEscalationService']={startWorkflowSlaScheduler:()=>{calls.push('workflow.start');return false},stopWorkflowSlaScheduler:()=>calls.push('workflow.stop')};
    dependencies['./services/procurementImportService']={startProcurementImportWorker:()=>{calls.push('import.start');return true},stopProcurementImportWorker:()=>calls.push('import.stop')};
    dependencies['./services/releasePdfVerificationService']={queueAuthorisedReleasePdf:async()=>({enabled:false})};
    const server = load(path.join(root, 'server.js'), dependencies, { NODE_ENV: 'production' });
    if (databaseFails || retainedFails) {
      await assert.rejects(server.bootstrap(), { code: databaseFails ? 'DB_TEST_DENIED' : 'CURRENT_SCHEMA_FIXTURE_FAILED' });
      assert.equal(calls.includes('listen'), false);
      assert.equal(calls.includes('migrations'), retainedFails);
      assert.equal(calls.includes('original.preflight'), false, 'Schema failure cannot proceed to application startup or requests');
      assert.equal(runtime.publicReadiness().ready, false);
      assert.equal(runtime.detailedReadiness().failure.phase, databaseFails ? 'CONNECTING_DATABASE' : 'RUNNING_MIGRATIONS');
    } else {
      await server.bootstrap();
      assert.deepEqual(calls, [
        'database', 'capacity', 'migrations', 'retained.migrations', 'original.preflight', ...Object.keys(schemas), ...Object.keys(originalSchemas),'profilePhotoSchema',...Object.keys(originalControllers),'documentDeliverySchema','weeklyTimesheetDeliverySchema','original.preflight',
        'attestation', 'limiter', 'jobs', 'email.start', 'timesheet.start','workflow.start','import.start', 'listen'
      ]);
      assert.equal(runtime.publicReadiness().ready, true);
      assert.deepEqual(Object.keys(runtime.publicReadiness().critical_services).sort(), [
        'background_workers', 'weekly_timesheet_worker', 'procurement_import_worker', 'database', 'migrations', 'rate_limiter',
        'schema_email_queue', 'schema_operational_trust', 'schema_security',
        'schema_security_governance', 'schema_security_operations'
      ].sort());
      assert.equal(runtime.publicReadiness().critical_services.weekly_timesheet_worker,'OPERATIONAL');
      await server.shutdown();
      assert.deepEqual(calls.slice(-6), ['email.stop','timesheet.stop','workflow.stop','import.stop', 'limiter.close', 'pool.close']);
    }
  }
}

async function testEmailSchema() {
  const statements = [];
  const schema = load(path.join(root, 'services/emailQueueSchema.js'), {
    '../config/db': { query: async (sql) => {
      statements.push(sql);
      if (/^ALTER TABLE/.test(sql)) throw Object.assign(new Error('already exists'), {
        code: /COLUMN/.test(sql) ? 'ER_DUP_FIELDNAME' : 'ER_DUP_KEYNAME'
      });
    } }
  });
  await schema.ensureEmailQueueSchema();
  const initializedCount=statements.length;
  await schema.ensureEmailQueueSchema();
  assert.equal(statements.length, initializedCount, 'Shared schema promise must prevent repeated initialization');
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS email_queue/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS email_logs/);
  assert.doesNotMatch(statements.join('\n'), /DROP|DELETE|TRUNCATE|weekly_timesheets|staff|finance/i);

  let attempts = 0;
  const retrySchema = load(path.join(root, 'services/emailQueueSchema.js'), {
    '../config/db': { query: async () => {
      if (++attempts === 1) throw Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    } }
  });
  await assert.rejects(retrySchema.ensureEmailQueueSchema(), { code: 'ER_ACCESS_DENIED_ERROR' });
  await retrySchema.ensureEmailQueueSchema();
  assert.equal(attempts, initializedCount+1, 'An unsuccessful schema attempt must be retried, not cached as success');
}

async function testEmailRetirement() {
  const rows = [
    { id: 1, related_module: 'banking', status: 'PENDING', subject: 'Retired Banking document' },
    { id: 2, related_module: 'finance', status: 'RETRY', subject: 'Retired report' },
    { id: 3, related_module: null, status: 'PENDING', subject: 'Unclassified old email' },
    { id: 4, related_module: 'timesheets', status: 'PENDING', subject: 'Original timesheet document', to_json: '["fixture@example.invalid"]', attempts: 0 },
    { id: 5, related_module: 'customer_rfqs', status: 'PENDING', subject: 'Retired enquiry' }
  ];
  const retiredBefore = JSON.stringify(rows.filter((row) => row.related_module !== 'timesheets'));
  const sent = [];
  const queries = [];
  const queue = load(path.join(root, 'services/emailQueue.js'), {
    '../config/db': { query: async (sql, parameters = []) => {
      queries.push({ sql, parameters });
      if (/SELECT \* FROM email_queue/.test(sql)) {
        assert.match(sql, /related_module IN \(\?(?:, \?)+\)/);
        const allowed = parameters.slice(0, -1);
        return [rows.filter((row) => ['PENDING', 'RETRY'].includes(row.status) && allowed.includes(row.related_module)).slice(0, parameters.at(-1))];
      }
      if (/SET status = 'SENDING'/.test(sql)) {
        const row = rows.find((item) => item.id === parameters[0]);
        if (!row || !parameters.slice(1).includes(row.related_module)) return [{ affectedRows: 0 }];
        row.status = 'SENDING'; return [{ affectedRows: 1 }];
      }
      if (/SET status = 'SENT'/.test(sql)) {
        rows.find((item) => item.id === parameters[1]).status = 'SENT';
      }
      if (/INSERT INTO email_queue/.test(sql)) return [{ insertId: 5 }];
      return [{ affectedRows: 1 }];
    } },
    './emailQueueSchema': { ensureEmailQueueSchema: async () => {} },
    './weeklyDeliveryPolicy': require('../services/weeklyDeliveryPolicy'),
    './documentPdfService': require('../services/documentPdfService'),
    './emailService': {
      sendMail: async (message) => { sent.push(message); return { messageId: 'fixture-provider-accepted' }; },
      normalizeAddressList: (items) => Array.isArray(items) ? items : items ? [items] : [],
      attachmentBuffer: (item) => Buffer.isBuffer(item.content) ? item.content : null,
      assertAttachmentIntegrity:require('../services/emailService').assertAttachmentIntegrity,
      isEmailTransportError: () => false,
      classifySmtpFailure: () => ({ code: 'FIXTURE_FAILURE', category: 'fixture' })
    }
  });
  const original = (await require('../services/documentPdfService').createDocumentPdf({title:'Fixture timesheet',reference:'TS-FIXTURE',columns:[],rows:[]})).buffer;
  const stored = await queue._test.serializableAttachments([{ filename: 'timesheet.pdf', contentType: 'application/pdf', content: original }]);
  rows[3].attachments_json = JSON.stringify(stored);
  const outcomes = await queue.processEmailQueue(10);
  assert.equal(outcomes.length, 1);
  assert.equal(sent.length, 1, 'Retired emails must never reach the provider');
  assert.equal(sent[0].subject, 'Original timesheet document');
  assert.deepEqual(sent[0].attachments[0].content, original);
  assert.equal(sent[0].attachments[0].filename, 'timesheet.pdf');
  assert.equal(JSON.stringify(rows.filter((row) => row.related_module !== 'timesheets')), retiredBefore, 'Retired queue rows and content remain intact');
  await queue.processEmailQueue(10);
  assert.equal(sent.length, 1);
  await assert.rejects(queue.queueEmail({ relatedModule: 'finance' }), { code: 'EMAIL_MODULE_RETIRED' });
  await assert.rejects(queue.queueEmail({ relatedModule: 'customer_rfqs' }), { code: 'EMAIL_MODULE_RETIRED' });
  await assert.rejects(queue.queueEmail({}), { code: 'EMAIL_MODULE_RETIRED' });
  assert.equal(await queue.queueEmail({ relatedModule: 'contact', to: ['fixture@example.invalid'], subject: 'Allowed', attachments: [] }), 5);
  assert.equal(queries.filter(({ sql }) => /INSERT INTO email_queue/.test(sql)).length, 1);
  const corrupt = JSON.parse(JSON.stringify(stored));
  corrupt[0].content = Buffer.from('wrong').toString('base64');
  assert.throws(() => queue._test.restoreAttachments(corrupt), /integrity check failed/);
}

function testProductionReadiness() {
  const { assessProductionReadiness } = require('../config/productionReadiness');
  const env = {
    NODE_ENV: 'production', JWT_SECRET: 'fixture-jwt-secret-is-long-and-unique',
    SESSION_SECRET: 'fixture-session-secret-is-long-and-unique', MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
    TRUST_PROXY: 'true', DB_HOST: '127.0.0.1', DB_USER: 'fixture', DB_NAME: 'fixture',
    ALLOWED_ORIGINS: 'https://app.voxelveda.com', APP_URL: 'https://app.voxelveda.com'
  };
  assert.equal(assessProductionReadiness(env).ready, true, 'Retired subsystem keys must not gate customer app startup');
  assert.equal(assessProductionReadiness({ ...env, JWT_SECRET: 'weak' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, SESSION_SECRET: env.JWT_SECRET }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, MFA_ENCRYPTION_KEY: 'weak' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, TRUST_PROXY: 'false' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, ALLOWED_ORIGINS: '*' }).ready, false);
  assert.equal(assessProductionReadiness({ ...env, DEBUG_AUTH_BYPASS: 'true' }).ready, false);
}

async function testCapacityIsolation() {
  const queries = [];
  const query = async (sql, parameters = []) => {
    queries.push(sql);
    if (/table_name=\?/.test(sql)) return [[{ count: 1 }]];
    if (/SUM\(data_length/.test(sql)) return [[{ size_mb: 1, data_free_mb: 0 }]];
    if (/SELECT table_name/.test(sql)) return [[]];
    return [{ affectedRows: 0 }];
  };
  const connection = {
    query, beginTransaction: async () => {}, rollback: async () => {}, release() {}
  };
  const capacity = load(path.join(root, 'services/databaseCapacityRecoveryService.js'), {
    './securityDataScope': require('../services/securityDataScope'),
    '../config/db': { query, getConnection: async () => connection }
  });
  const result = await capacity.recoverDatabaseCapacity({ force: true });
  assert.equal(result.writable, true);
  const mutations = queries.filter((sql) => /^\s*(?:DELETE|UPDATE|INSERT|TRUNCATE|DROP)\b/i.test(sql));
  const allowed = new Set(['background_job_runs', 'background_job_failures', 'background_job_dead_letters', 'security_events', 'email_logs', 'email_queue']);
  assert.ok(mutations.length > 0, 'Capacity recovery fixture must exercise retention/probe SQL');
  for (const sql of mutations) {
    const table = sql.match(/^\s*(?:DELETE FROM|INSERT INTO|UPDATE|TRUNCATE TABLE|DROP TABLE)\s+`?([a-z_]+)/i)?.[1];
    assert.ok(allowed.has(table), `Capacity recovery must not mutate a retired record table: ${table}`);
  }
  assert.doesNotMatch(mutations.join('\n'), /statement_import|finance|bank|processing_errors|rfqs|customers|invoices/i);
  assert.equal(queries.some(sql=>/^\s*(DELETE|UPDATE|TRUNCATE|DROP)/i.test(sql)),false,'capacity recovery holds all original and retired history');
}

async function run() {
  await testStartup();
  await testEmailSchema();
  await testEmailRetirement();
  testProductionReadiness();
  await testCapacityIsolation();
  console.log('Retained customer runtime, fail-closed startup, email hold and durable content tests passed.');
}

run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
