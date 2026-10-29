'use strict';
// Tests the actual presentation helper and its existing lookup integration.
// Fixture data only: no production API, camera or operation transition is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helper = fs.readFileSync(path.join(__dirname, '../public/shop-floor-record-view.js'), 'utf8');
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.className = ''; this._text = ''; this.hidden = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
}
function descendants(root, tag) { return root.children.flatMap(child => [...(!tag || child.tagName === tag ? [child] : []), ...descendants(child, tag)]); }
function fixture() {
  const ids = new Map(), document = { createElement: tag => new Node(tag), getElementById: id => ids.get(id) }, window = {};
  for (const match of fs.readFileSync(path.join(__dirname, '../public/shop-floor.html'), 'utf8').matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/gi)) ids.set(match[2], new Node(match[1]));
  const calls = [], context = { window, document, URL, URLSearchParams, location: { search: '', origin: 'https://app.example.invalid' },
    fetch: async (url, options) => { calls.push({ url, options }); return { status: 200, ok: true, json: async () => context.reply }; } };
  vm.createContext(context); vm.runInContext(helper, context, { filename: 'public/shop-floor-record-view.js' });
  return { window, document, context, calls, output: ids.get('recordOutput') };
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function details(root) { return Object.fromEntries(descendants(root, 'dl').flatMap(list => list.children.map(pair => [pair.children[0].textContent, pair.children[1].textContent]))); }
function table(root, title) { const found = descendants(root, 'table').find(grid => grid.getAttribute('aria-label') === title); assert(found, title + ' has a labelled table'); return found; }
function rows(grid) { return descendants(grid, 'tbody')[0].children.map(row => Object.fromEntries(row.children.map(cell => [cell.getAttribute('data-label'), cell.textContent]))); }
function assertSafe(root) { for (const tag of ['script', 'img', 'iframe', 'button', 'input', 'textarea']) assert.equal(descendants(root, tag).length, 0, 'Record presentation does not create ' + tag); }
const hostile = '<img src=x onerror="alert(1)"> & <script>unsafe()</script>';
const secret = 'unlisted-internal-diagnostic';
const uuid = '45a0c709-385f-45d5-874f-a1a5fc73ef25';
const job = freeze({ job: { id: uuid, job_no: 'JOB-009', status: 'IN_PRODUCTION', part_no: 'PART-2', part_description: hostile + 'long '.repeat(250), quantity: 0, customer_po: '', export_review_required: 0, regulatory_review_required: 1, drawing_revision: null, created_at: '2026-10-29T08:30:00.000Z', secret },
  materials: [{ id: uuid, lot_no: 'LOT-2', material_code: 'MATERIAL-A', grade: null, release_status: 'RELEASED', quantity_allocated: '0.0000', quantity_consumed: 0, secret }],
  builds: [{ id: uuid, build_no: 'BUILD-2', machine_id: 17, operator_user_id: null, status: 'RUNNING', started_at: '2026-10-29 09:30:00', completed_at: null, process_parameters_json: { secret } }],
  holds: [{ id: uuid, hold_no: 'HOLD-2', entity_type: 'BUILD', entity_id: uuid, reason: hostile, placed_at: '2026-10-29T08:00:00+11:00', secret }], operations: [{ id: 12, status: 'RUNNING', secret }], secret });

async function main() {
  const f = fixture(); f.window.VoxelShopFloorRecord.render(f.output, 'job', job);
  assert.match(f.output.textContent, /Manufacturing job · JOB-009/); assert.match(f.output.textContent, /IN PRODUCTION/);
  const fields = details(f.output); assert.equal(fields.Quantity, '0'); assert.equal(fields['Customer purchase order'], 'Not recorded');
  assert.equal(fields['Export review required'], 'No'); assert.equal(fields['Regulatory review required'], 'Yes'); assert.equal(fields['Drawing revision'], 'Not recorded');
  assert.equal(fields.Description, job.job.part_description, 'Long descriptions remain complete text'); assert.equal(fields.Created, '29 Oct 2026 · 08:30:00 UTC');
  assert.equal(rows(table(f.output, 'Material allocations'))[0]['Allocated quantity'], '0.0000'); assert.equal(rows(table(f.output, 'Material allocations'))[0]['Consumed quantity'], '0');
  assert.equal(rows(table(f.output, 'Builds'))[0]['Machine reference'], '17'); assert.equal(rows(table(f.output, 'Builds'))[0]['Operator reference'], 'Not recorded');
  assert.equal(rows(table(f.output, 'Builds'))[0].Started, '29 Oct 2026 · 09:30:00', 'Unzoned database time gains no fabricated timezone');
  assert.equal(rows(table(f.output, 'Active quality holds'))[0].Reason, hostile); assertSafe(f.output);
  assert(!f.output.textContent.includes(uuid)); assert(!f.output.textContent.includes(secret)); assert.equal(job.job.status, 'IN_PRODUCTION'); assert.equal(job.operations[0].status, 'RUNNING');

  const machine = freeze({ machine: { id: uuid, equipment_code: 'MACHINE-A', description: 'Production machine', status: 'LOTO', commissioned: '0', critical_safety_issue: 1, qr_token: uuid, secret }, allowed: false, reasons: [hostile, 'An active LOTO permit exists.'],
    maintenance: [{ plan_name: 'Recorded preventive maintenance', next_due_date: '2026-11-01', blocking_when_overdue: 1, active: 0, secret }],
    faults: [{ severity: 'HIGH', description: hostile, status: 'CONTAINED', reported_at: '2026-10-28 12:00:00', secret }],
    loto: [{ permit_no: 'LOTO-2', reason: 'Recorded isolation', zero_energy_verified: 0, isolated_at: null, secret }], secret });
  f.window.VoxelShopFloorRecord.render(f.output, 'machine', machine);
  assert.match(f.output.textContent, /Machine · MACHINE-A/); assert.match(f.output.textContent, /Operation blocked by server readiness checks/);
  assert.equal(details(f.output).Commissioned, 'No'); assert.equal(details(f.output)['Critical safety issue'], 'Yes'); assert.equal(descendants(f.output, 'li')[0].textContent, hostile);
  assert.equal(rows(table(f.output, 'Maintenance plans'))[0].Plan, 'Recorded preventive maintenance'); assert.equal(rows(table(f.output, 'Maintenance plans'))[0]['Next due'], '1 Nov 2026');
  assert.equal(rows(table(f.output, 'Maintenance plans'))[0].Active, 'No'); assert.equal(rows(table(f.output, 'Unresolved faults'))[0].Status, 'CONTAINED');
  assert.equal(rows(table(f.output, 'Active lockout / tagout permits'))[0]['Zero energy verified'], 'No'); assert.equal(rows(table(f.output, 'Active lockout / tagout permits'))[0].Isolated, 'Not recorded');
  assert(!f.output.textContent.includes('JOB-009'), 'Opening another record replaces the prior presentation'); assert(!f.output.textContent.includes(uuid)); assert(!f.output.textContent.includes(secret)); assertSafe(f.output);

  const material = freeze({ lot: { id: uuid, lot_no: 'LOT-33', material_code: 'MAT-3', material_description: hostile, release_status: 'QUALITY_HOLD', quantity_received: 10, quantity_available: 0, unit: 'kg', certificate_ref: null, secret }, usable: false,
    genealogy: [{ job_no: 'JOB-2', build_no: 'BUILD-2', serial_no: 'SERIAL-2', relationship: 'CONSUMED_IN', quantity: 0, created_at: null, id: uuid, secret }], holds: [], secret });
  f.window.VoxelShopFloorRecord.render(f.output, 'material', material);
  assert.equal(details(f.output)['Available quantity'], '0'); assert.equal(details(f.output).Unit, 'kg'); assert.equal(details(f.output)['Certificate reference'], 'Not recorded');
  assert.match(f.output.textContent, /Available for use: No/); assert.equal(rows(table(f.output, 'Material genealogy'))[0].Job, 'JOB-2'); assert.equal(rows(table(f.output, 'Material genealogy'))[0].Quantity, '0');
  assert.match(f.output.textContent, /No active quality holds were returned/); assert(!f.output.textContent.includes(uuid)); assert(!f.output.textContent.includes(secret)); assertSafe(f.output);

  f.window.VoxelShopFloorRecord.render(f.output, 'job', { job: { job_no: 'EMPTY-JOB' }, materials: [], builds: undefined, holds: [] });
  assert.match(f.output.textContent, /No material allocations recorded/); assert.match(f.output.textContent, /related records are unavailable/i);
  assert.equal(details(f.output)['Export review required'], 'Not recorded', 'Missing flags are not fabricated as false'); assert(!f.output.textContent.includes('No builds recorded'), 'Missing response differs from an empty register');
  for (const bad of [{}, { job: [] }, { job: null }, { job: 'unexpected' }]) assert.throws(() => f.window.VoxelShopFloorRecord.render(f.output, 'job', bad), /could not be verified/);
  assert.throws(() => f.window.VoxelShopFloorRecord.render(f.output, 'unexpected', job), /could not be verified/);
  f.window.VoxelShopFloorRecord.renderError(f.output, hostile); assert.equal(f.output.textContent, 'Record unavailable' + hostile); assertSafe(f.output);

  // Evaluate the existing lookup script too: URLs, operation visibility and
  // action handlers stay intact while success/failure use the readable view.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shop-floor.js'), 'utf8'), f.context, { filename: 'public/shop-floor.js' });
  f.context.reply = { ...job, operations: [] }; await vm.runInContext("openEntity('job', 'JOB/009')", f.context);
  assert.equal(f.calls.at(-1).url, '/api/qms/enterprise/shop-floor/jobs/JOB%2F009'); assert.equal(f.calls.at(-1).options.credentials, 'same-origin');
  assert.equal(f.calls.at(-1).options.method, undefined, 'Presentation issues no operation writes'); assert.match(f.output.textContent, /JOB-009/); assert.equal(f.document.getElementById('operations').hidden, false);
  f.context.fetch = async () => ({ status: 403, ok: false, json: async () => ({ message: 'Record access denied.', secret, debug: uuid }) });
  await vm.runInContext("openEntity('material', '33')", f.context); assert.equal(f.output.textContent, 'Record unavailableRecord access denied.'); assert.equal(f.document.getElementById('operations').hidden, true);
  assert(!f.output.textContent.includes(secret)); assert(!f.output.textContent.includes(uuid));
  console.log('Shop-floor record presentation tests passed: actual typed job/machine/material fields, related registers, zero/missing distinctions, safe long text, no arbitrary metadata, immutable statuses and unchanged lookup/operation integration. Fixtures only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
