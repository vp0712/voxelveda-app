const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { publicRfqContract } = require('../middleware/publicEndpointProtection');

const writes = [];
const errors = [];
let failWrite = false;
const db = {
  async query(sql, params) {
    assert.match(sql, /^\s*INSERT INTO rfqs\b/i, 'public intake must only insert a new enquiry');
    writes.push({ sql, params: [...params] });
    if (failWrite) throw Object.assign(new Error('Sensitive database/provider details'), { code: 'ER_CONNECTION_LOST' });
    return [{ insertId: 801 + writes.length, affectedRows: 1 }];
  }
};

const filename = path.join(__dirname, '..', 'controllers/publicRfqController.js');
const moduleFixture = { exports: {} };
new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({
  module: moduleFixture,
  exports: moduleFixture.exports,
  console: { error: (...args) => errors.push(args) },
  require(name) {
    if (name === '../config/db') return db;
    if (name === '../middleware/publicEndpointProtection') return { publicRfqContract };
    throw new Error(`Unexpected dependency in public RFQ intake: ${name}`);
  }
});
const controller = moduleFixture.exports;

async function invoke(body, rawBody) {
  const req = { body, rawBody, headers: {} };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await controller.createRFQ(req, res);
  return res;
}

async function run() {
  assert.deepEqual(Object.keys(controller), ['createRFQ'], 'retired listing and approval methods must be absent');
  const valid = {
    customer_name: '  Customer Example  ',
    email: '  buyer@example.com  ',
    phone: '  +61 400 000 000 ',
    material: '  Aluminium  ',
    quantity: 3,
    application: '  Test enclosure  '
  };

  for (const body of [
    undefined, [], {},
    { ...valid, customer_name: '' },
    { ...valid, customer_name: 'x'.repeat(121) },
    { ...valid, email: 'invalid' },
    { ...valid, quantity: -1 },
    { ...valid, quantity: 0 },
    { ...valid, quantity: 1.5 },
    { ...valid, quantity: 'Infinity' },
    { ...valid, quantity: 1000001 },
    { ...valid, application: 'x'.repeat(4001) },
    { ...valid, status: 'approved' },
    { ...valid, rfq_id: 1 },
    { ...valid, role: 'super_admin' }
  ]) {
    const result = await invoke(body);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, 'REQUEST_VALIDATION_FAILED');
  }
  assert.equal((await invoke(valid, Buffer.alloc(16 * 1024 + 1))).statusCode, 400);
  assert.equal(writes.length, 0, 'rejected enquiries must not write');

  let result = await invoke(valid);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.rfq_id, 802);
  assert.equal(result.body.message, 'RFQ created successfully');
  assert.deepEqual(writes[0].params, ['Customer Example', 'buyer@example.com', '+61 400 000 000', 'Aluminium', 3, 'Test enclosure', 'pending']);
  assert.equal((writes[0].sql.match(/\?/g) || []).length, 7);

  const text = "Enquiry'); UPDATE rfqs SET status='approved'; --";
  result = await invoke({ ...valid, customer_name: text, application: text, quantity: '4' });
  assert.equal(result.statusCode, 200);
  assert.equal(writes[1].params[0], text);
  assert.equal(writes[1].params[5], text);
  assert.equal(writes[1].params[4], 4);
  assert.equal(writes[1].params[6], 'pending');
  assert.equal(writes[1].sql.includes(text), false, 'imported text must remain a parameter');
  assert.doesNotMatch(writes[1].sql, /\b(?:UPDATE|DELETE|DROP)\b/i);

  failWrite = true;
  result = await invoke(valid);
  assert.equal(result.statusCode, 500, 'database errors must not appear as saved enquiries');
  assert.equal(result.body.rfq_id, undefined);
  assert.equal(result.body.error, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /Sensitive|provider|ER_CONNECTION_LOST/);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], 'ER_CONNECTION_LOST');
  console.log('Customer RFQ intake tests passed: retained contract, pending-only parameterized inserts, rejected status/ERP actions, and truthful safe database failure.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
