'use strict';
// Actual procurement services against synthetic SQL/storage boundaries.
// No production database, object store, scanner or mail provider is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

// Reusable SQL boundary for the entry and import workflow fixtures. queryHook
// receives (sql, parameters, transactionState, isTransaction); `this` also equals
// transactionState. Extend the third argument (or connection.state), so imported
// records/files/batches/audits share commit and rollback with entry mutations.
function createEntryFixture() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const filename = path.join(path.resolve(__dirname, '..'), 'services/procurementEntryService.js');
  const serviceSource = fs.readFileSync(filename, 'utf8');
  const realRequire = createRequire(filename);
  const plain = value => JSON.parse(JSON.stringify(value));
  function transactionCopy(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [transactionCopy(key), transactionCopy(item)]));
    if (value instanceof Set) return new Set([...value].map(transactionCopy));
    if (Array.isArray(value)) return value.map(transactionCopy);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transactionCopy(item)]));
  }
  let committed = { records: [], revisions: [], audits: [], sequences: new Map() };
  let transactionTail = Promise.resolve();
  let tick = 0;
  const controls = { auditFailure: false, reportReadFailure: false, queryHook: null };
  const state = new Proxy({}, {
    get(_target, key) { return Object.hasOwn(controls, key) ? controls[key] : committed[key]; },
    set(_target, key, value) {
      if (Object.hasOwn(controls, key)) controls[key] = value;
      else committed[key] = value;
      return true;
    },
    ownKeys() { return [...new Set([...Reflect.ownKeys(committed), ...Reflect.ownKeys(controls)])]; },
    has(_target, key) { return Object.hasOwn(controls, key) || Object.hasOwn(committed, key); },
    getOwnPropertyDescriptor(_target, key) {
      return Object.hasOwn(controls, key) || Object.hasOwn(committed, key)
        ? { enumerable: true, configurable: true }
        : undefined;
    }
  });
  const queries = [];
  const transactions = { begun: 0, committed: 0, rolledBack: 0, released: 0 };
  const timestamp = () => `2026-10-13 00:${String(Math.floor(++tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}`;
  const suppliers = [{ id: 7, deleted: 0 }, { id: 8, deleted: 0 }, { id: 9, deleted: 1 }];

  function decimalSum(rows, column, scale) {
    const values = rows.map(row => row[column]).filter(value => value != null);
    if (!values.length) return null; // SQL SUM(NULL) remains NULL.
    let sum = 0n;
    for (const value of values) {
      const [integer, fraction = ''] = String(value).split('.');
      sum += BigInt(integer + fraction.padEnd(scale, '0'));
    }
    const divisor = 10n ** BigInt(scale);
    return `${sum / divisor}.${String(sum % divisor).padStart(scale, '0')}`;
  }
  function sqlLike(value, pattern) {
    if (value == null) return false;
    const expression = Array.from(String(pattern), character => {
      if (character === '%') return '.*';
      if (character === '_') return '.';
      return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return new RegExp(`^${expression}$`, 'i').test(String(value));
  }
  function filteredRows(database, sql, parameters) {
    const where = sql.match(/\bWHERE (.*?)(?: ORDER BY | GROUP BY | LIMIT |$)/)?.[1];
    let index = 0;
    const predicates = [];
    for (const clause of where ? where.split(' AND ') : []) {
      if (clause === 'r.archived_at IS NULL') predicates.push(row => row.archived_at == null);
      else if (clause === 'r.archived_at IS NOT NULL') predicates.push(row => row.archived_at != null);
      else if (/^r\.(owner_user_id|classification|category|priority|phase|currency|supplier_id)=\?$/.test(clause)) {
        const column = clause.match(/^r\.(\w+)/)[1], value = parameters[index++];
        predicates.push(row => row[column] != null && row[column] === value);
      } else if (/^r\.issue_date(?:>=|<=)\?$/.test(clause)) {
        const operator = clause.includes('>=') ? '>=' : '<=', value = parameters[index++];
        predicates.push(row => row.issue_date != null && (operator === '>=' ? row.issue_date >= value : row.issue_date <= value));
      } else if (/^r\.id IN \((?:\?,)*\?\)$/.test(clause)) {
        const count = (clause.match(/\?/g) || []).length;
        const values = parameters.slice(index, index + count); index += count;
        predicates.push(row => values.includes(row.id));
      } else if (/^\(r\.record_no LIKE \? OR r\.title LIKE \? OR r\.reference LIKE \? OR r\.description LIKE \? OR r\.item_code LIKE \? OR r\.supplier_name LIKE \?\)$/.test(clause)) {
        const columns = ['record_no', 'title', 'reference', 'description', 'item_code', 'supplier_name'];
        const patterns = parameters.slice(index, index + columns.length); index += columns.length;
        predicates.push(row => columns.some((column, position) => sqlLike(row[column], patterns[position])));
      } else assert.fail(`Unhandled entry WHERE clause: ${clause}`);
    }
    return { rows: database.records.filter(row => predicates.every(predicate => predicate(row))), consumed: index };
  }
  function orderedRows(rows, sql) {
    const order = sql.match(/ ORDER BY (.*?)(?: LIMIT |$)/)?.[1];
    if (!order) return rows;
    const terms = order.split(',').map(term => {
      const parsed = term.match(/^r\.(\w+) (ASC|DESC)$/);
      assert(parsed, `Unhandled entry ORDER BY: ${term}`);
      return { column: parsed[1], direction: parsed[2] === 'ASC' ? 1 : -1 };
    });
    return rows.slice().sort((left, right) => {
      for (const { column, direction } of terms) {
        const a = left[column], b = right[column];
        if (a === b) continue;
        if (a == null) return -direction;
        if (b == null) return direction;
        const comparison = column === 'total_amount'
          ? Number(a) - Number(b)
          : String(a).localeCompare(String(b));
        if (comparison) return comparison * direction;
      }
      return 0;
    });
  }

  async function query(database, sql, parameters = [], transaction = false) {
    const statement = sql.replace(/\s+/g, ' ').trim();
    queries.push({ sql: statement, parameters: plain(parameters), transaction });
    assert(!/supplier_bills|procurement_bill_matches|finance_|purchase_orders|purchase_requisitions/.test(statement), 'draft entry SQL must remain within the procurement record workflow');
    if (typeof controls.queryHook === 'function') {
      const response = await controls.queryHook.call(database, statement, parameters, database, transaction);
      if (response !== undefined) return response;
    }
    if (statement === 'SELECT id FROM users WHERE id=? FOR UPDATE') {
      assert(transaction, 'actor serialization must be transactional');
      return [[{ id: parameters[0] }]];
    }
    if (statement === 'SELECT id FROM suppliers WHERE id=? AND IFNULL(deleted,0)=0 LIMIT 1') {
      return [plain(suppliers.filter(row => row.id === parameters[0] && !row.deleted).map(row => ({ id: row.id })))];
    }
    if (/^SELECT \* FROM procurement_records WHERE id=\?(?: FOR UPDATE)?$/.test(statement)) {
      if (statement.endsWith(' FOR UPDATE')) assert(transaction, 'record serialization must be transactional');
      return [plain(database.records.filter(row => row.id === parameters[0]))];
    }
    if (statement === 'SELECT * FROM procurement_records WHERE request_key=?') {
      return [plain(database.records.filter(row => row.request_key === parameters[0]))];
    }
    if (/^SELECT (?:\*|id) FROM procurement_records WHERE owner_user_id=\? AND fingerprint=\? LIMIT 1$/.test(statement)) {
      const rows = database.records.filter(row => row.owner_user_id === parameters[0] && row.fingerprint === parameters[1]).slice(0, 1);
      return [plain(statement.startsWith('SELECT id ') ? rows.map(row => ({ id: row.id })) : rows)];
    }
    if (statement === 'INSERT INTO procurement_entry_sequences(year_value,next_value) VALUES(?,1) ON DUPLICATE KEY UPDATE year_value=VALUES(year_value)') {
      assert(transaction, 'reference sequence allocation must share the entry transaction');
      assert.equal(parameters.length, 1);
      const year = Number(parameters[0]);
      if (database.sequences.has(year)) return [{ affectedRows: 0 }];
      database.sequences.set(year, { year_value: year, next_value: '1' });
      return [{ affectedRows: 1 }];
    }
    if (statement === 'SELECT next_value FROM procurement_entry_sequences WHERE year_value=? FOR UPDATE') {
      assert(transaction, 'reference sequences must be locked transactionally');
      assert.equal(parameters.length, 1);
      const sequence = database.sequences.get(Number(parameters[0]));
      return [sequence ? [{ next_value: sequence.next_value }] : []];
    }
    if (statement === 'UPDATE procurement_entry_sequences SET next_value=? WHERE year_value=?') {
      assert(transaction, 'reference sequence updates must share the entry transaction');
      assert.equal(parameters.length, 2);
      const sequence = database.sequences.get(Number(parameters[1]));
      assert(sequence, 'reference sequence must exist before allocation');
      assert(BigInt(parameters[0]) > 0n, 'reference sequence must remain positive');
      sequence.next_value = String(parameters[0]);
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO procurement_records\(/.test(statement)) {
      assert(transaction, 'entry inserts must be transactional');
      const columns = statement.match(/^INSERT INTO procurement_records\(([^)]+)\) VALUES/)[1].split(',');
      assert.equal(columns.length, parameters.length);
      const record = Object.fromEntries(columns.map((column, index) => [column, parameters[index]]));
      if (database.records.some(row => row.id === record.id || row.record_no === record.record_no || record.request_key != null && row.request_key === record.request_key)) {
        const error = new Error('Duplicate entry identity'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      database.records.push({ ...record, revision: 1, archived_at: null, archived_by: null, archive_reason: null, created_at: timestamp(), updated_at: timestamp() });
      return [{ affectedRows: 1 }];
    }
    if (/^UPDATE procurement_records SET /.test(statement)) {
      assert(transaction, 'entry updates must be transactional');
      const assignments = statement.match(/^UPDATE procurement_records SET (.+) WHERE id=\?$/)[1].split(',');
      const record = database.records.find(row => row.id === parameters[parameters.length - 1]);
      assert(record, 'update target must exist');
      let index = 0;
      for (const assignment of assignments) {
        const [column, expression] = assignment.split('=');
        if (expression === '?') record[column] = parameters[index++];
        else if (column === 'revision' && expression === 'revision+1') record.revision += 1;
        else if (column === 'archived_at' && expression === 'NOW()') record.archived_at = timestamp();
        else if (column === 'archived_at' && expression === 'NULL') record.archived_at = null;
        else assert.fail(`Unhandled entry assignment: ${assignment}`);
      }
      assert.equal(index, parameters.length - 1);
      record.updated_at = timestamp();
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO procurement_record_revisions\(/.test(statement)) {
      assert(transaction, 'entry revision inserts must be transactional');
      const columns = statement.match(/^INSERT INTO procurement_record_revisions\(([^)]+)\) VALUES/)[1].split(',');
      assert.equal(columns.length, parameters.length);
      const revision = Object.fromEntries(columns.map((column, index) => [column, parameters[index]]));
      assert(!database.revisions.some(row => row.record_id === revision.record_id && row.revision === revision.revision), 'record revision identity must be unique');
      database.revisions.push({ ...revision, created_at: timestamp() });
      return [{ affectedRows: 1 }];
    }
    if (statement === 'SELECT revision,action,old_json,new_json,changed_by,reason,created_at FROM procurement_record_revisions WHERE record_id=? ORDER BY revision DESC') {
      return [plain(database.revisions.filter(row => row.record_id === parameters[0]).sort((a, b) => b.revision - a.revision).map(({ record_id, ...row }) => row))];
    }
    if (statement.startsWith('SELECT ') && / FROM procurement_records r(?: |$)/.test(statement)) {
      const { rows, consumed } = filteredRows(database, statement, parameters);
      if (statement.startsWith('SELECT COUNT(*) total ')) {
        assert.equal(consumed, parameters.length);
        return [[{ total: rows.length }]];
      }
      if (statement.includes(' GROUP BY ')) {
        assert.equal(consumed, parameters.length);
        const dimensions = statement.match(/ GROUP BY (.+)$/)[1].split(',').map(term => {
          assert(/^r\.(classification|currency|unit)$/.test(term), `Unhandled grouping dimension: ${term}`);
          return term.slice(2);
        });
        const groups = new Map();
        for (const row of rows) {
          const key = JSON.stringify(dimensions.map(column => row[column] ?? null));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        }
        const aggregateFields = [
          ['quantity', 'quantity', 3], ['net_amount', 'net', 2],
          ['tax_amount', 'tax', 2], ['total_amount', 'total', 2]
        ];
        return [[...groups.values()].map(group => {
          const result = Object.fromEntries(dimensions.map(column => [column, group[0][column] ?? null]));
          result.record_count = group.length;
          for (const [column, alias, scale] of aggregateFields) {
            if (!statement.includes(`SUM(r.${column})`)) continue;
            const conditionalNull = statement.match(new RegExp(`IF\\(r\\.(\\w+) IS NULL,NULL,SUM\\(r\\.${column}\\)\\)`))?.[1];
            result[alias] = conditionalNull && group[0][conditionalNull] == null ? null : decimalSum(group, column, scale);
          }
          if (statement.includes('COUNT(r.total_amount) priced_count')) result.priced_count = group.filter(row => row.total_amount != null).length;
          return result;
        })];
      }
      assert(statement.startsWith('SELECT r.* '), 'unsupported entry record projection');
      if (controls.reportReadFailure) throw new Error('Injected entry report read failure');
      const hasOffset = statement.endsWith(' LIMIT ? OFFSET ?');
      assert(statement.endsWith(hasOffset ? ' LIMIT ? OFFSET ?' : ' LIMIT ?'), 'entry lists must use a bound limit');
      assert.equal(parameters.length - consumed, hasOffset ? 2 : 1);
      const limit = parameters[consumed], offset = hasOffset ? parameters[consumed + 1] : 0;
      assert(Number.isSafeInteger(limit) && limit >= 0, 'SQL limit must be a nonnegative integer');
      return [plain(orderedRows(rows, statement).slice(offset, offset + limit))];
    }
    assert.fail(`Unhandled entry fixture SQL: ${statement}`);
  }

  const pool = {
    get state() { return committed; },
    query(sql, parameters) { return query(committed, sql, parameters, false); },
    async getConnection() {
      let local = null, unlock = null, active = false;
      return {
        get state() { return active ? local : committed; },
        async beginTransaction() {
          assert(!active, 'transaction must begin once');
          const prior = transactionTail;
          transactionTail = new Promise(resolve => { unlock = resolve; });
          await prior;
          local = transactionCopy(committed); active = true; transactions.begun += 1;
        },
        query(sql, parameters) {
          assert(active, 'connection queries require an active transaction');
          return query(local, sql, parameters, true);
        },
        async captureAudit(payload) {
          assert(active, 'entry audit must share the record transaction');
          if (controls.auditFailure) throw new Error('Injected entry audit failure');
          local.audits.push(plain(payload));
        },
        async commit() {
          assert(active, 'cannot commit a finished transaction');
          committed = local; active = false; transactions.committed += 1; unlock();
        },
        async rollback() {
          assert(active, 'cannot roll back a finished transaction');
          active = false; transactions.rolledBack += 1; unlock();
        },
        release() {
          assert(!active, 'connection must finish its transaction before release');
          transactions.released += 1;
        }
      };
    }
  };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, __filename: filename, __dirname: path.dirname(filename),
    require(specifier) {
      if (specifier === '../config/db') return pool;
      if (specifier === './procurementImportSchema') return { ensureProcurementImportSchema: async () => {} };
      if (specifier === './auditService') return { logAudit: (connection, payload) => connection.captureAudit(payload) };
      return realRequire(specifier);
    }
  };
  vm.runInNewContext(serviceSource, context, { filename });
  return {
    state, db: pool, pool, service: module.exports, queries, transactions, controls,
    snapshot() { return transactionCopy(committed); },
    seedRecords(records) { committed.records.push(...plain(records)); }
  };
}

async function testEntryWorkflows() {
  const assert = require('node:assert/strict');
  const plain = value => JSON.parse(JSON.stringify(value));
  const matchesError = (code, statusCode) => error => {
    assert.equal(error.code, code);
    if (statusCode !== undefined) assert.equal(error.statusCode, statusCode);
    return true;
  };
  const owner = { id: 11, role: 'entry-fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const otherOwner = { id: 12, role: 'entry-fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const viewer = { id: 11, role: 'entry-fixture', permissions: ['VIEW_PROCUREMENT'] };
  const recordManager = { id: 90, role: 'entry-fixture', permissions: ['VIEW_PROCUREMENT', 'MANAGE_PROCUREMENT_RECORDS'] };
  const importWithoutView = { id: 13, role: 'entry-fixture', permissions: ['IMPORT_PROCUREMENT'] };
  const managerWithoutView = { id: 90, role: 'entry-fixture', permissions: ['MANAGE_PROCUREMENT_RECORDS'] };
  const noPermissions = { id: 14, role: 'entry-fixture', permissions: [] };
  function input(overrides = {}) {
    return {
      classification: 'PLAN', title: 'Steel stock draft', category: 'Raw materials', priority: 'high', phase: 'Fabrication', supplier_id: 7,
      supplier_name: 'Synthetic Supplier', reference: 'PLAN-01',
      date: '2026-10-01', due_date: '2026-10-20', currency: 'usd',
      description: '  Steel plate  ', item_code: 'ST-01', quantity: '2.000',
      unit: 'sheet', unit_price: '10.00', tax_rate: '10.00',
      notes: 'Synthetic entry fixture', ...overrides
    };
  }
  function request(key) {
    const headers = {
      'idempotency-key': key, 'user-agent': 'entry-workflow-test',
      'x-request-id': 'entry-fixture-request'
    };
    return {
      ip: '127.0.0.1', id: 'entry-fixture-request', session: { id: 'entry-fixture-session' },
      get(name) { return headers[String(name).toLowerCase()] || null; }
    };
  }


  const f = createEntryFixture(), service = f.service;
  const created = await service.createEntry({ user: owner, input: input({ owner_user_id: otherOwner.id }), req: request('create-key') });
  assert.equal(created.existing, false);
  assert.match(created.entry.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(created.entry.record_no, /^PRC-\d{4}-\d{6,}$/);
  assert.equal(created.entry.record_no.split('-')[2], '000001', 'first committed draft must receive the first sequential reference');
  assert.equal(created.entry.owner_user_id, owner.id, 'manual input cannot transfer record ownership');
  assert.deepEqual(plain({ quantity: created.entry.quantity, currency: created.entry.currency, priority: created.entry.priority, category: created.entry.category, phase: created.entry.phase, net: created.entry.net, tax: created.entry.tax, total: created.entry.total, date: created.entry.date }), {
    quantity: '2', currency: 'USD', priority: 'HIGH', category: 'Raw materials', phase: 'Fabrication', net: '20', tax: '2', total: '22', date: '2026-10-01'
  });
  for (const key of ['request_key', 'request_hash', 'fingerprint']) assert.equal(Object.hasOwn(created.entry, key), false, `${key} must not appear in a public record`);
  assert.equal(created.entry.lines.length, 1);
  const recordId = created.entry.id, recordNo = created.entry.record_no;
  const normalizedRetry = input({ quantity: '2', currency: 'USD', description: 'Steel plate', unit_price: '10', tax_rate: '10' });
  const repeat = await service.createEntry({ user: owner, input: normalizedRetry, req: request('create-key') });
  const bodyKeyRepeat = await service.createEntry({ user: owner, input: { ...normalizedRetry, request_key: 'create-key' } });
  assert.equal(repeat.existing, true);
  assert.equal(bodyKeyRepeat.existing, true);
  assert.equal(repeat.entry.id, recordId);
  assert.equal(bodyKeyRepeat.entry.id, recordId);
  assert.equal(f.snapshot().records.length, 1);
  assert.equal(f.snapshot().revisions.length, 1);
  assert.equal(f.snapshot().audits.length, 1, 'retries must not create another revision or audit');
  const beforeFingerprintRepeat = f.snapshot();
  const sameFingerprint = await service.createEntry({ user: owner, input: input({ title: 'Alternate display title for the same entry' }) });
  assert.equal(sameFingerprint.existing, true);
  assert.equal(sameFingerprint.duplicate, true, 'a title change must not defeat owner-scoped content deduplication');
  assert.equal(sameFingerprint.entry.id, recordId);
  assert.equal(sameFingerprint.entry.record_no, recordNo);
  assert.equal(sameFingerprint.entry.title, created.entry.title, 'duplicate creation must retain the saved entry');
  assert.deepEqual(f.snapshot(), beforeFingerprintRepeat, 'manual content repeat must retain revisions, audits and the next reference');
  const beforeKeyConflict = f.snapshot();
  await assert.rejects(service.createEntry({ user: owner, input: input({ title: 'Different draft' }), req: request('create-key') }), matchesError('IDEMPOTENCY_CONFLICT', 409));
  assert.deepEqual(f.snapshot(), beforeKeyConflict);
  const otherKey = await service.createEntry({ user: otherOwner, input: input(), req: request('create-key') });
  assert.equal(otherKey.existing, false, 'the same raw create key belongs to each authenticated owner');
  assert.notEqual(otherKey.entry.id, recordId);
  assert.equal(BigInt(otherKey.entry.record_no.split('-')[2]), BigInt(recordNo.split('-')[2]) + 1n, 'sequential references must remain unique across owners');
  const concurrentCreates = await Promise.all([
    service.createEntry({ user: owner, input: input({ title: 'Concurrent retry draft', reference: 'PLAN-CONCURRENT' }), req: request('concurrent-create-key') }),
    service.createEntry({ user: owner, input: input({ title: 'Concurrent retry draft', reference: 'PLAN-CONCURRENT' }), req: request('concurrent-create-key') })
  ]);
  assert.equal(concurrentCreates.filter(result => !result.existing).length, 1);
  assert.equal(concurrentCreates.filter(result => result.existing).length, 1);
  assert.equal(concurrentCreates[0].entry.id, concurrentCreates[1].entry.id);
  assert.equal(f.snapshot().revisions.filter(row => row.record_id === concurrentCreates[0].entry.id).length, 1);

  const invalidInputs = [
    [null, 'ENTRY_REQUIRED'], [[], 'ENTRY_REQUIRED'],
    [input({ classification: 'PAYMENT' }), 'CLASSIFICATION_INVALID'],
    [input({ quantity: '0' }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: NaN }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: Infinity }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: '1e3' }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: '1,000' }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: '1.0001' }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ quantity: '1000001' }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ unit_price: '10.001' }), 'ENTRY_VALIDATION_FAILED', 'unit_price'],
    [input({ tax_rate: '101' }), 'ENTRY_VALIDATION_FAILED', 'tax_rate'],
    [input({ date: '2026-02-30' }), 'ENTRY_VALIDATION_FAILED', 'date'],
    [input({ date: '01/02/2026' }), 'ENTRY_VALIDATION_FAILED', 'date'],
    [input({ due_date: '2026-09-30' }), 'ENTRY_VALIDATION_FAILED', 'due_date'],
    [input({ currency: 'USD$' }), 'ENTRY_VALIDATION_FAILED', 'currency'],
    [input({ priority: 'URGENT' }), 'ENTRY_VALIDATION_FAILED', 'priority'],
    [input({ category: 'a'.repeat(121) }), 'ENTRY_VALIDATION_FAILED', 'category'],
    [input({ phase: 'a'.repeat(121) }), 'ENTRY_VALIDATION_FAILED', 'phase'],
    [input({ description: null }), 'ENTRY_VALIDATION_FAILED', 'description'],
    [input({ description: { private: 'object' } }), 'ENTRY_VALIDATION_FAILED', 'description'],
    [input({ quantity: null }), 'ENTRY_VALIDATION_FAILED', 'quantity'],
    [input({ total: '999' }), 'ENTRY_VALIDATION_FAILED', 'total'],
    [input({ notes: 'a'.repeat(4001) }), 'ENTRY_VALIDATION_FAILED', 'notes'],
    [input({ title: 'bad\u0000title' }), 'FIELD_INVALID', 'title'],
    [input({ supplier_id: 0 }), 'SUPPLIER_INVALID', 'supplier_id'],
    [input({ supplier_id: 9 }), 'SUPPLIER_UNAVAILABLE', 'supplier_id'],
    [input({ supplier_id: 999 }), 'SUPPLIER_UNAVAILABLE', 'supplier_id'],
    [input({ request_key: 'k'.repeat(201) }), 'FIELD_INVALID', 'request key']
  ];
  const beforeValidation = f.snapshot();
  for (const [candidate, code, field] of invalidInputs) {
    await assert.rejects(service.createEntry({ user: owner, input: candidate }), error => {
      matchesError(code, 422)(error);
      if (field) assert(Object.hasOwn(error.details.fields, field), `validation must identify ${field}`);
      return true;
    });
    assert.deepEqual(f.snapshot(), beforeValidation, `invalid ${field || code} must leave stored records unchanged`);
  }

  for (const expected_revision of [undefined, null, '', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.editEntry({ user: owner, id: recordId, input: input({ expected_revision }) }), matchesError('REVISION_REQUIRED', 422));
  }
  const editResults = await Promise.allSettled([
    service.editEntry({ user: owner, id: recordId, input: input({ expected_revision: 1, title: 'Editor A', reason: 'First editor' }) }),
    service.editEntry({ user: owner, id: recordId, input: input({ expected_revision: 1, title: 'Editor B', reason: 'Second editor' }) })
  ]);
  assert.equal(editResults.filter(result => result.status === 'fulfilled').length, 1, 'one optimistic edit must win');
  const failedEdit = editResults.find(result => result.status === 'rejected');
  matchesError('REVISION_CONFLICT', 409)(failedEdit.reason);
  assert.equal(failedEdit.reason.details.current_revision, 2);
  let current = await service.getEntry({ user: owner, id: recordId });
  assert.equal(current.revision, 2);
  assert.equal(current.title, editResults.find(result => result.status === 'fulfilled').value.entry.title);
  assert.equal(current.id, recordId);
  assert.equal(current.record_no, recordNo);
  assert.deepEqual(plain(current.history.map(row => [row.revision, row.action])), [[2, 'EDITED'], [1, 'CREATED']]);
  assert.equal(current.history[0].old_value.title, 'Steel stock draft');
  assert.equal(current.history[0].new_value.title, current.title);
  assert.equal(current.history[1].old_value, null);

  async function auditRollback(operation, label) {
    const before = f.snapshot();
    f.controls.auditFailure = true;
    try { await assert.rejects(operation(), /Injected entry audit failure/); }
    finally { f.controls.auditFailure = false; }
    assert.deepEqual(f.snapshot(), before, `${label} audit failure must roll back the record and its revision`);
  }
  await auditRollback(() => service.editEntry({ user: owner, id: recordId, input: input({ expected_revision: 2, title: 'Rolled-back title' }) }), 'edit');
  await auditRollback(() => service.createEntry({ user: owner, input: input({ title: 'Rolled-back create', reference: 'PLAN-ROLLBACK' }), req: request('rolled-back-create-key') }), 'create');
  const recoveredCreate = await service.createEntry({ user: owner, input: input({ title: 'Recovered create', reference: 'PLAN-ROLLBACK' }), req: request('rolled-back-create-key') });
  assert.equal(recoveredCreate.existing, false, 'rolled-back create must not reserve an idempotency key');
  assert.equal(BigInt(recoveredCreate.entry.record_no.split('-')[2]), BigInt(concurrentCreates[0].entry.record_no.split('-')[2]) + 1n, 'audit rollback must not consume a reference');
  await assert.rejects(service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 2 } }), matchesError('FIELD_INVALID', 422));
  await assert.rejects(service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 1, reason: 'Stale archive' } }), matchesError('REVISION_CONFLICT', 409));
  await auditRollback(() => service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 2, reason: 'Rollback archive' } }), 'archive');
  const archived = await service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 2, reason: 'No longer needed' } });
  assert.equal(archived.existing, false);
  assert.equal(archived.entry.status, 'ARCHIVED');
  assert.equal(archived.entry.revision, 3);
  assert.equal(archived.entry.id, recordId);
  assert.equal(archived.entry.record_no, recordNo);
  assert.equal(archived.entry.archive_reason, 'No longer needed');
  assert.equal(archived.entry.archived_by, owner.id);
  assert.equal(f.snapshot().records.filter(row => row.id === recordId).length, 1, 'archive must retain the record');
  await assert.rejects(service.editEntry({ user: owner, id: recordId, input: input({ expected_revision: 3 }) }), matchesError('ENTRY_ARCHIVED', 409));
  const beforeArchiveRepeat = f.snapshot();
  const archiveRepeat = await service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 3, reason: 'Repeat archive' } });
  assert.equal(archiveRepeat.existing, true);
  assert.deepEqual(f.snapshot(), beforeArchiveRepeat, 'archive retry must not add a revision');
  assert(!(await service.listEntries({ user: owner })).entries.some(row => row.id === recordId));
  assert((await service.listEntries({ user: owner, filters: { status: 'ARCHIVED' } })).entries.some(row => row.id === recordId));
  assert(!(await service.listReportRecords({ user: owner })).some(row => row.id === recordId));
  assert((await service.listReportRecords({ user: owner, filters: { status: 'ARCHIVED' } })).some(row => row.id === recordId));
  await assert.rejects(service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 2 }, restore: true }), matchesError('REVISION_CONFLICT', 409));
  await auditRollback(() => service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 3 }, restore: true }), 'restore');
  const restored = await service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 3, reason: 'Reopened after verification' }, restore: true });
  assert.equal(restored.existing, false);
  assert.equal(restored.entry.status, 'DRAFT');
  assert.equal(restored.entry.revision, 4);
  assert.equal(restored.entry.id, recordId);
  assert.equal(restored.entry.record_no, recordNo);
  assert.equal(restored.entry.archived_at, null);
  assert.equal(restored.entry.archived_by, null);
  assert.equal(restored.entry.archive_reason, null);
  const beforeRestoreRepeat = f.snapshot();
  assert.equal((await service.archiveEntry({ user: owner, id: recordId, input: { expected_revision: 4 }, restore: true })).existing, true);
  assert.deepEqual(f.snapshot(), beforeRestoreRepeat, 'restore retry must not add a revision');
  current = await service.getEntry({ user: owner, id: recordId });
  assert.deepEqual(plain(current.history.map(row => [row.revision, row.action])), [[4, 'RESTORED'], [3, 'ARCHIVED'], [2, 'EDITED'], [1, 'CREATED']]);
  assert.equal(current.history[0].reason, 'Reopened after verification');
  assert(current.history[0].old_value.archived_at);
  assert.equal(current.history[0].new_value.archived_at, null);
  assert.equal(current.history[1].old_value.archived_at, null);
  assert(current.history[1].new_value.archived_at);
  assert(current.history.every(row => row.new_value.id === recordId && row.new_value.record_no === recordNo && row.new_value.owner_user_id === owner.id));

  assert.equal((await service.getEntry({ user: viewer, id: recordId })).id, recordId, 'read-only owner can inspect retained history');
  await assert.rejects(service.createEntry({ user: viewer, input: input() }), matchesError('PROCUREMENT_WRITE_REQUIRED', 403));
  await assert.rejects(service.editEntry({ user: viewer, id: recordId, input: input({ expected_revision: 4 }) }), matchesError('PROCUREMENT_WRITE_REQUIRED', 403));
  await assert.rejects(service.archiveEntry({ user: viewer, id: recordId, input: { expected_revision: 4, reason: 'Denied' } }), matchesError('PROCUREMENT_WRITE_REQUIRED', 403));
  const beforeOwnerDenials = f.snapshot();
  await assert.rejects(service.getEntry({ user: otherOwner, id: recordId }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  await assert.rejects(service.editEntry({ user: otherOwner, id: recordId, input: input({ expected_revision: 4 }) }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  await assert.rejects(service.archiveEntry({ user: otherOwner, id: recordId, input: { expected_revision: 4, reason: 'Denied' } }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  await assert.rejects(service.archiveEntry({ user: otherOwner, id: recordId, input: { expected_revision: 4 }, restore: true }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  assert.deepEqual(f.snapshot(), beforeOwnerDenials);
  assert((await service.listEntries({ user: otherOwner, filters: { status: 'ALL' } })).entries.every(row => row.owner_user_id === otherOwner.id));
  assert((await service.listReportRecords({ user: otherOwner, filters: { status: 'ALL' } })).every(row => row.owner_user_id === otherOwner.id));
  const roleOnlyManager = { id: 70, role: 'manager', permissions: [] };
  await assert.rejects(service.getEntry({ user: roleOnlyManager, id: recordId }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  assert.equal((await service.getEntry({ user: recordManager, id: recordId })).owner_user_id, owner.id);
  const managerEdited = await service.editEntry({ user: recordManager, id: recordId, input: input({ expected_revision: 4, title: 'Authorized record manager edit', reason: 'Scoped procurement authority' }) });
  assert.equal(managerEdited.entry.revision, 5);
  assert.equal(managerEdited.entry.owner_user_id, owner.id, 'record manager edits must retain the original owner');
  assert.equal(managerEdited.entry.created_by, owner.id);
  assert.equal(managerEdited.entry.updated_by, recordManager.id);
  const managerArchived = await service.archiveEntry({ user: recordManager, id: recordId, input: { expected_revision: 5, reason: 'Manager archive' } });
  assert.equal(managerArchived.entry.archived_by, recordManager.id);
  const managerRestored = await service.archiveEntry({ user: recordManager, id: recordId, input: { expected_revision: 6 }, restore: true });
  assert.equal(managerRestored.entry.revision, 7);
  const boundedManager = { ...recordManager, permission_boundary: ['VIEW_PROCUREMENT'] };
  await assert.rejects(service.getEntry({ user: boundedManager, id: recordId }), matchesError('PROCUREMENT_RECORD_NOT_FOUND', 404));
  await assert.rejects(service.editEntry({ user: boundedManager, id: recordId, input: input({ expected_revision: 7 }) }), matchesError('PROCUREMENT_WRITE_REQUIRED', 403));
  for (const user of [importWithoutView, managerWithoutView, noPermissions]) {
    await assert.rejects(service.createEntry({ user, input: input() }), matchesError('PROCUREMENT_PERMISSION_REQUIRED', 403));
    await assert.rejects(service.getEntry({ user, id: recordId }), matchesError('PROCUREMENT_PERMISSION_REQUIRED', 403));
    await assert.rejects(service.listEntries({ user }), matchesError('PROCUREMENT_PERMISSION_REQUIRED', 403));
    await assert.rejects(service.listReportRecords({ user }), matchesError('PROCUREMENT_PERMISSION_REQUIRED', 403));
  }
  await assert.rejects(service.createEntry({ user: { ...owner, id: 0 }, input: input() }), matchesError('AUTHENTICATION_REQUIRED', 401));
  await assert.rejects(service.getEntry({ user: owner, id: 'invalid-record-id' }), matchesError('RECORD_ID_INVALID', 400));
  const firstAudit = f.snapshot().audits[0];
  assert.deepEqual({ actorId: firstAudit.actorId, ipAddress: firstAudit.ipAddress, userAgent: firstAudit.userAgent, requestId: firstAudit.requestId, sessionId: firstAudit.sessionId, action: firstAudit.action, module: firstAudit.module, recordId: firstAudit.recordId }, {
    actorId: owner.id, ipAddress: '127.0.0.1', userAgent: 'entry-workflow-test', requestId: 'entry-fixture-request', sessionId: 'entry-fixture-session', action: 'PROCUREMENT_ENTRY_CREATED', module: 'PROCUREMENT', recordId: recordNo
  });
  assert(f.snapshot().audits.filter(row => row.recordId === recordNo && row.action !== 'PROCUREMENT_ENTRY_CREATED').every(row => row.oldValue.id === recordId && row.newValue.id === recordId));
  assert(f.snapshot().audits.some(row => row.action === 'PROCUREMENT_ENTRY_EDITED' && row.actorId === recordManager.id));
  assert(f.queries.filter(query => query.sql.endsWith('FOR UPDATE')).every(query => query.transaction));
  assert.equal(f.transactions.begun, f.transactions.committed + f.transactions.rolledBack);
  assert.equal(f.transactions.released, f.transactions.begun);

  // A separate dataset makes the expected aggregate independent of preceding
  // edit/archive cases. Every ordinary row is created through the real service.
  const listing = createEntryFixture(), entries = listing.service;
  let listingReference = 0;
  const save = async (overrides, user = owner) => (await entries.createEntry({ user, input: input({ reference: `LIST-${++listingReference}`, ...overrides }) })).entry;
  const alpha = await save({ title: 'Steel alpha', description: 'Steel stock alpha' });
  const bravo = await save({ title: 'Steel bravo', description: 'Steel stock bravo', date: '2026-10-02', quantity: '3', unit_price: '20', tax_rate: '0' });
  const charlie = await save({ title: 'Steel charlie', description: 'Steel stock charlie', date: '2026-10-03', quantity: '1', unit_price: '8', tax_rate: '25' });
  const euro = await save({ title: 'Steel delta', description: 'Steel stock euro', date: '2026-10-02', currency: 'EUR', quantity: '4', unit_price: '5', tax_rate: '0' });
  const unpriced = await save({ title: 'Steel echo', description: 'Steel stock unpriced', date: '2026-10-02', currency: 'GBP', quantity: '5', unit_price: null, tax_rate: null });
  const wrongClassification = await save({ title: 'Steel wrong classification', classification: 'QUOTATION' });
  await save({ title: 'Steel wrong supplier', supplier_id: 8 });
  await save({ title: 'Steel wrong category', category: 'Tools' });
  await save({ title: 'Steel wrong priority', priority: 'LOW' });
  await save({ title: 'Steel wrong phase', phase: 'Assembly' });
  const otherOwnerRow = await save({ title: 'Steel other owner', date: '2026-10-02' }, otherOwner);
  await save({ title: 'Steel too early', date: '2026-09-30' });
  await save({ title: 'Unrelated stock', description: 'Copper', item_code: 'CU-01', supplier_name: 'Copper vendor', reference: 'CU-01', notes: 'Steel appears only in notes' });
  const hiddenArchive = await save({ title: 'Steel archived' });
  await entries.archiveEntry({ user: owner, id: hiddenArchive.id, input: { expected_revision: 1, reason: 'Excluded from active totals' } });
  const filters = { status: 'DRAFT', classification: 'PLAN', category: 'Raw materials', priority: 'HIGH', phase: 'Fabrication', search: 'Steel', supplier_id: 7, from_date: '2026-10-01', to_date: '2026-10-03', sort: 'title_asc', page_size: 1 };
  const firstPage = await entries.listEntries({ user: owner, filters });
  const secondPage = await entries.listEntries({ user: owner, filters: { ...filters, page: 2 } });
  assert.equal(firstPage.total, 5);
  assert.equal(firstPage.pages, 5);
  assert.equal(firstPage.entries.length, 1);
  assert.equal(firstPage.entries[0].id, alpha.id);
  assert.equal(secondPage.entries[0].id, bravo.id);
  assert.deepEqual(plain(secondPage.summary), plain(firstPage.summary), 'all filtered totals must remain independent of the visible page');
  assert.deepEqual(plain(firstPage.summary.currency_totals).sort((a, b) => a.currency.localeCompare(b.currency)), [
    { classification: 'PLAN', currency: 'EUR', record_count: 1, net: '20.00', tax: '0.00', total: '20.00', priced_count: 1 },
    { classification: 'PLAN', currency: 'GBP', record_count: 1, net: null, tax: null, total: null, priced_count: 0 },
    { classification: 'PLAN', currency: 'USD', record_count: 3, net: '88.00', tax: '4.00', total: '92.00', priced_count: 3 }
  ]);
  assert.deepEqual(plain(firstPage.summary.quantity_totals), [{ classification: 'PLAN', unit: 'sheet', record_count: 5, quantity: '15.000' }]);
  assert.equal(firstPage.summary.record_count, 5);
  const lastPage = await entries.listEntries({ user: owner, filters: { ...filters, page: 5 } });
  assert.equal(lastPage.entries[0].id, unpriced.id);
  assert.deepEqual(plain(lastPage.summary), plain(firstPage.summary));
  const usd = await entries.listEntries({ user: owner, filters: { ...filters, currency: 'usd', page: 3 } });
  assert.equal(usd.total, 3);
  assert.equal(usd.entries[0].id, charlie.id);
  assert.equal(usd.summary.currency_totals[0].total, '92.00');
  const selected = { status: 'ALL', ids: [alpha.id, otherOwnerRow.id], sort: 'title_asc' };
  assert.deepEqual(plain((await entries.listEntries({ user: owner, filters: selected })).entries.map(row => row.id)), [alpha.id]);
  assert.deepEqual(plain((await entries.listReportRecords({ user: owner, filters: selected })).map(row => row.id)), [alpha.id]);
  assert.equal((await entries.listEntries({ user: recordManager, filters: selected })).total, 2);
  assert.equal((await entries.listReportRecords({ user: recordManager, filters: selected })).length, 2);
  const report = await entries.listReportRecords({ user: owner, filters });
  assert.deepEqual(plain(report.map(row => row.id)), [alpha.id, bravo.id, charlie.id, euro.id, unpriced.id]);
  assert(report.every(row => row.owner_user_id === owner.id && row.status === 'DRAFT'));
  const byClassification = await entries.listEntries({ user: owner, filters: { ids: [alpha.id, wrongClassification.id] } });
  assert.deepEqual(plain(byClassification.summary.currency_totals).sort((a, b) => a.classification.localeCompare(b.classification)), [
    { classification: 'PLAN', currency: 'USD', record_count: 1, net: '20.00', tax: '2.00', total: '22.00', priced_count: 1 },
    { classification: 'QUOTATION', currency: 'USD', record_count: 1, net: '20.00', tax: '2.00', total: '22.00', priced_count: 1 }
  ], 'monetary summaries must preserve classification boundaries');
  const weight = await save({ title: 'Steel weight', category: 'Other', unit: 'kg', quantity: '7', unit_price: '1', tax_rate: '0' });
  const byUnit = await entries.listEntries({ user: owner, filters: { ids: [alpha.id, weight.id] } });
  assert.deepEqual(plain(byUnit.summary.quantity_totals).sort((a, b) => a.unit.localeCompare(b.unit)), [
    { classification: 'PLAN', unit: 'kg', record_count: 1, quantity: '7.000' },
    { classification: 'PLAN', unit: 'sheet', record_count: 1, quantity: '2.000' }
  ], 'quantities with different units must retain separate totals');
  const unspecified = await save({ title: 'Unspecified dimensions', category: 'Other', currency: null, unit: null, quantity: '3', unit_price: '10', tax_rate: '0' });
  const nullDimensions = await entries.listEntries({ user: owner, filters: { ids: [unspecified.id] } });
  assert.deepEqual(plain(nullDimensions.summary.currency_totals), [{ classification: 'PLAN', currency: null, record_count: 1, net: null, tax: null, total: null, priced_count: 1 }]);
  assert.deepEqual(plain(nullDimensions.summary.quantity_totals), [{ classification: 'PLAN', unit: null, record_count: 1, quantity: null }]);
  for (const invalidFilters of [{ status: 'DELETED' }, { classification: 'PAYMENT' }, { currency: 'US' }, { supplier_id: -1 }, { from_date: '2026-02-30' }, { to: 'not-a-date' }, { from_date: '2026-10-03', to_date: '2026-10-01' }, { sort: 'title_asc; DROP TABLE procurement_records' }]) {
    const beforeQueries = listing.queries.length;
    await assert.rejects(entries.listReportRecords({ user: owner, filters: invalidFilters }), matchesError('FILTER_INVALID', 422));
    assert.equal(listing.queries.length, beforeQueries, 'invalid report filters must fail before record SQL');
  }
  for (const invalidFilters of [{ page: -1 }, { page: 1.5 }, { page_size: 101 }, { page: 10000002, page_size: 1 }]) {
    const beforeQueries = listing.queries.length;
    await assert.rejects(entries.listEntries({ user: owner, filters: invalidFilters }), matchesError('PAGINATION_INVALID', 422));
    assert.equal(listing.queries.length, beforeQueries);
  }
  for (const ids of [[], Array(2001).fill(alpha.id)]) await assert.rejects(entries.listReportRecords({ user: owner, filters: { ids } }), matchesError('SELECTION_INVALID', 422));
  await assert.rejects(entries.listReportRecords({ user: owner, filters: { ids: [alpha.id, 'invalid'] } }), matchesError('RECORD_ID_INVALID', 400));
  await assert.rejects(entries.listReportRecords({ user: owner, filters, limit: 2 }), matchesError('REPORT_LIMIT_EXCEEDED', 422));
  assert.equal((await entries.listReportRecords({ user: owner, filters: { ids: [alpha.id, bravo.id] }, limit: 2 })).length, 2, 'exact report cap must succeed');
  listing.controls.reportReadFailure = true;
  try { await assert.rejects(entries.listReportRecords({ user: owner, filters }), /Injected entry report read failure/); }
  finally { listing.controls.reportReadFailure = false; }

  // Preload a large synthetic SQL dataset to test the absolute cap without
  // generating two thousand unrelated create/audit operations.
  const capped = createEntryFixture(), capService = capped.service;
  const template = (await capService.createEntry({ user: owner, input: input({ title: 'Report cap template' }) })).entry;
  const rawTemplate = capped.snapshot().records[0];
  capped.seedRecords(Array.from({ length: 2000 }, (_, index) => ({
    ...rawTemplate, id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    record_no: `PRC-REPORT-${index + 1}`, request_key: null, request_hash: null
  })));
  assert.equal(capped.snapshot().records.length, 2001);
  await assert.rejects(capService.listReportRecords({ user: owner }), matchesError('REPORT_LIMIT_EXCEEDED', 422));
  await assert.rejects(capService.listReportRecords({ user: owner, limit: 9999 }), matchesError('REPORT_LIMIT_EXCEEDED', 422));
  const capQuery = capped.queries[capped.queries.length - 1];
  assert.equal(capQuery.parameters[capQuery.parameters.length - 1], 2001, 'absolute report cap must request one overflow row');
  const exactIds = capped.snapshot().records.slice(0, 2000).map(row => row.id);
  assert.equal((await capService.listReportRecords({ user: owner, filters: { ids: exactIds }, limit: 9999 })).length, 2000);
  const beforeDeniedReport = capped.queries.length;
  await assert.rejects(capService.listReportRecords({ user: noPermissions }), matchesError('PROCUREMENT_PERMISSION_REQUIRED', 403));
  assert.equal(capped.queries.length, beforeDeniedReport, 'report permission rejection must fail before private record SQL');
  assert.equal((await capService.listReportRecords({ user: otherOwner })).length, 0, 'a private overflow dataset must not affect another owner');
  assert.equal(template.owner_user_id, owner.id);
  for (const fixtureResult of [listing, capped]) {
    assert.equal(fixtureResult.transactions.begun, fixtureResult.transactions.committed + fixtureResult.transactions.rolledBack);
    assert.equal(fixtureResult.transactions.released, fixtureResult.transactions.begun);
  }
}

function createPrivateSourceFixture() {
  const fixture = createEntryFixture();
  fixture.state.batches = [];
  fixture.state.files = [];
  fixture.state.rows = [];
  const objects = new Map(), puts = [], gets = [];
  const controls = { failPutOrdinal: null, extractionGate: null, storageConfigured: true };
  const environment = { NODE_ENV: 'test' };
  const copy = value => {
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
    return value;
  };
  const storage = {
    isConfigured: () => controls.storageConfigured,
    configuration() { const error = new Error('Selected private provider is incompletely configured'); error.code = 'FIXTURE_STORAGE_CONFIGURATION'; throw error; },
    async putObject(key, buffer, mimeType) {
      puts.push({ key, buffer: Buffer.from(buffer), mimeType });
      if (puts.length === controls.failPutOrdinal) {
        const error = new Error('Synthetic private store outage'); error.code = 'FIXTURE_STORAGE_UNAVAILABLE'; throw error;
      }
      objects.set(key, Buffer.from(buffer));
    },
    async getObject(key) {
      gets.push(key); assert(objects.has(key), 'source must have a durable private object');
      return Buffer.from(objects.get(key));
    }
  };
  function splitAssignments(source) {
    const parts = []; let start = 0, level = 0, quote = false;
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (character === "'") quote = !quote;
      else if (!quote && character === '(') level++;
      else if (!quote && character === ')') level--;
      else if (!quote && level === 0 && character === ',') { parts.push(source.slice(start, index)); start = index + 1; }
    }
    parts.push(source.slice(start)); return parts;
  }
  function groupedRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.file_id}:${row.status}`;
      if (!groups.has(key)) groups.set(key, { file_id: row.file_id, status: row.status, count: 0 });
      groups.get(key).count++;
    }
    return [...groups.values()];
  }
  const eligible = row => Number(row.attempts) < 3 && (row.status === 'STORED' || row.status === 'EXTRACTING' && Number(row.processing_expires_at) < Date.now());
  fixture.controls.queryHook = (sql, parameters, state, transaction) => {
    const now = Date.now();
    let match;
    if ((match = sql.match(/^INSERT INTO (procurement_import_batches|procurement_import_files|procurement_import_rows)\(([^)]+)\) VALUES/))) {
      assert(transaction, 'source manifests and extraction rows require a transaction');
      const table = { procurement_import_batches: 'batches', procurement_import_files: 'files', procurement_import_rows: 'rows' }[match[1]];
      const columns = match[2].split(','); assert.equal(columns.length, parameters.length);
      const record = Object.fromEntries(columns.map((column, index) => [column, copy(parameters[index])]));
      if (table === 'rows' && state.rows.some(row => row.file_id === record.file_id && row.sheet_name === record.sheet_name && row.source_row === record.source_row)) return [{ affectedRows: 0 }];
      assert(!state[table].some(row => row.id === record.id), 'synthetic SQL identity must be unique');
      state[table].push({ revision: 1, status: table === 'batches' ? 'UPLOADED' : 'PENDING_MAPPING', preview_token: null, confirmed_at: null,
        attempts: 0, storage_type: null, processing_claim_token: null, created_at: now, ...record });
      return [{ affectedRows: 1 }];
    }
    if ((match = sql.match(/^UPDATE (procurement_import_batches|procurement_import_files) SET (.+) WHERE (.+)$/))) {
      const table = match[1] === 'procurement_import_batches' ? 'batches' : 'files';
      let index = 0;
      const assignments = splitAssignments(match[2]).map(assignment => {
        const parsed = assignment.match(/^(\w+)=(.+)$/); assert(parsed, assignment);
        const [_, column, expression] = parsed;
        if (expression === '?') return [column, () => copy(parameters[index++])];
        if (expression === 'NULL') return [column, () => null];
        if (/^'.*'$/.test(expression)) return [column, () => expression.slice(1, -1)];
        if (expression === 'NOW()') return [column, () => now];
        if (expression === 'DATE_ADD(NOW(),INTERVAL 5 MINUTE)') return [column, () => now + 300000];
        if (expression === `${column}+1`) return [column, row => Number(row[column]) + 1];
        if (expression === "IF(confirmed_at IS NULL,'UPLOADED','PARTIALLY_COMMITTED')") return [column, row => row.confirmed_at == null ? 'UPLOADED' : 'PARTIALLY_COMMITTED'];
        assert.fail(`Unhandled private source assignment: ${assignment}`);
      });
      // Capture parameter assignments once; applying them must not consume the
      // WHERE parameters or vary between rows in a guarded multi-row update.
      const values = assignments.map(([column, value]) => [column, typeof value === 'function' ? value : () => value]);
      const setters = values.map(([column, value]) => {
        const expression = splitAssignments(match[2]).find(item => item.startsWith(`${column}=`)).slice(column.length + 1);
        return [column, expression === '?' ? (() => { const item = value(); return () => copy(item); })() : value];
      });
      const where = match[3], remaining = parameters.slice(index);
      let predicate;
      if (where === 'id=?') predicate = row => row.id === remaining[0];
      else if (where === 'id=? AND processing_claim_token=?') predicate = row => row.id === remaining[0] && row.processing_claim_token === remaining[1];
      else if (where === "status='EXTRACTING' AND processing_expires_at<NOW() AND attempts>=3") predicate = row => row.status === 'EXTRACTING' && Number(row.processing_expires_at) < now && row.attempts >= 3;
      else if (where === "batch_id=? AND storage_type IS NOT NULL AND status='EXTRACTION_FAILED'") predicate = row => row.batch_id === remaining[0] && row.storage_type != null && row.status === 'EXTRACTION_FAILED';
      else assert.fail(`Unhandled private source UPDATE condition: ${where}`);
      let count = 0;
      for (const row of state[table].filter(predicate)) { for (const [column, value] of setters) row[column] = value(row); count++; }
      return [{ affectedRows: count }];
    }
    if (/^SELECT .* FROM procurement_import_batches WHERE (?:id|request_key)=\?(?: FOR UPDATE)?$/.test(sql)) {
      const field = sql.includes('WHERE request_key=') ? 'request_key' : 'id';
      if (sql.endsWith(' FOR UPDATE')) assert(transaction);
      return [copy(state.batches.filter(row => row[field] === parameters[0]))];
    }
    if (sql === 'SELECT f.*,b.owner_user_id FROM procurement_import_files f JOIN procurement_import_batches b ON b.id=f.batch_id WHERE f.id=?') {
      return [copy(state.files.filter(row => row.id === parameters[0]).map(row => ({ ...row, owner_user_id: state.batches.find(batch => batch.id === row.batch_id)?.owner_user_id })))];
    }
    if (sql.startsWith('SELECT f.id FROM procurement_import_files f JOIN procurement_import_batches b ON b.id=f.batch_id WHERE b.owner_user_id=?')) {
      return [copy(state.files.filter(row => state.batches.find(batch => batch.id === row.batch_id)?.owner_user_id === parameters[0] && row.content_sha256 === parameters[1] && row.storage_type != null && row.id !== parameters[2]).slice(0, 1))];
    }
    if (sql.startsWith("SELECT f.id FROM procurement_import_files f JOIN procurement_import_batches b ON b.id=f.batch_id WHERE b.status<>'COMMITTED'")) {
      return [copy(state.files.filter(row => state.batches.find(batch => batch.id === row.batch_id)?.status !== 'COMMITTED' && eligible(row)).slice(0, 10).map(row => ({ id: row.id })))];
    }
    if (/^SELECT .* FROM procurement_import_files WHERE batch_id=\?(?: ORDER BY ordinal_no)?$/.test(sql)) {
      return [copy(state.files.filter(row => row.batch_id === parameters[0]).sort((a, b) => a.ordinal_no - b.ordinal_no))];
    }
    if (/^SELECT .* FROM procurement_import_files WHERE id=\?(?: FOR UPDATE)?$/.test(sql)) return [copy(state.files.filter(row => row.id === parameters[0]))];
    if (sql === "SELECT * FROM procurement_import_files WHERE id=? AND attempts<3 AND (status='STORED' OR status='EXTRACTING' AND processing_expires_at<NOW()) FOR UPDATE") {
      assert(transaction); return [copy(state.files.filter(row => row.id === parameters[0] && eligible(row)))];
    }
    if (sql === 'SELECT file_id,status,COUNT(*) count FROM procurement_import_rows WHERE batch_id=? GROUP BY file_id,status') return [groupedRows(state.rows.filter(row => row.batch_id === parameters[0]))];
    if (/^SELECT COUNT\(\*\) total FROM procurement_import_rows WHERE batch_id=\?(?: AND file_id=\?)?$/.test(sql)) {
      return [[{ total: state.rows.filter(row => row.batch_id === parameters[0] && (parameters.length === 1 || row.file_id === parameters[1])).length }]];
    }
    if (/^SELECT \* FROM procurement_import_rows WHERE batch_id=\?(?: AND file_id=\?)? ORDER BY file_id,sheet_name,source_row LIMIT \? OFFSET \?$/.test(sql)) {
      const fileFiltered = sql.includes(' AND file_id=?');
      const rows = state.rows.filter(row => row.batch_id === parameters[0] && (!fileFiltered || row.file_id === parameters[1]));
      rows.sort((a, b) => a.file_id.localeCompare(b.file_id) || a.sheet_name.localeCompare(b.sheet_name) || a.source_row - b.source_row);
      const limit = parameters[parameters.length - 2], offset = parameters[parameters.length - 1];
      return [copy(rows.slice(offset, offset + limit))];
    }
    if (sql.includes('procurement_import_')) assert.fail(`Unhandled private source SQL: ${sql}`);
    return undefined;
  };
  function load() {
    const filename = path.resolve(__dirname, '../services/procurementImportService.js');
    const realRequire = createRequire(filename), module = { exports: {} };
    const securityFilename = path.resolve(__dirname, '../middleware/uploadSecurity.js');
    const securityModule = { exports: {} }, securityRequire = createRequire(securityFilename);
    vm.runInNewContext(fs.readFileSync(securityFilename, 'utf8'), {
      module: securityModule, exports: securityModule.exports, Buffer, process: { env: { NODE_ENV: 'test' } },
      require(specifier) { return specifier === '../services/malwareScannerService'
        ? { configured: () => false, scannerConfig: () => ({}), scanFile: async () => assert.fail('fixture must not contact an external scanner') }
        : securityRequire(specifier); }
    }, { filename: securityFilename });
    const extraction = realRequire('./procurementImportExtractionService');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, __filename: filename, __dirname: path.dirname(filename), Buffer, console, setInterval, clearInterval,
      process: { env: environment },
      require(specifier) {
        if (specifier === '../config/db') return fixture.pool;
        if (specifier === './objectStorageService') return storage;
        if (specifier === '../middleware/uploadSecurity') return securityModule.exports;
        if (specifier === './procurementImportSchema') return { ensureProcurementImportSchema: async () => {} };
        if (specifier === './auditService') return { logAudit: (connection, payload) => connection.captureAudit(payload) };
        if (specifier === './procurementEntryService') return fixture.service;
        if (specifier === './procurementLocalOcrService') return { localOcrOptions: () => ({}), ocrCapability: () => ({ configured: false }) };
        if (specifier === './procurementImportExtractionService') return { ...extraction, async extractImportFile(file, options) {
          if (controls.extractionGate) await controls.extractionGate(file);
          return extraction.extractImportFile(file, options);
        } };
        return realRequire(specifier);
      }
    }, { filename });
    return module.exports;
  }
  return { ...fixture, objects, puts, gets, sourceControls: controls, environment, load };
}

async function testPrivateSourcesAndClaims() {
  const fixture = createPrivateSourceFixture(), user = { id: 31, role: 'source-fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const other = { ...user, id: 32 }, manager = { id: 33, role: 'source-fixture', permissions: ['VIEW_PROCUREMENT', 'MANAGE_PROCUREMENT_RECORDS'] };
  const directory = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'voxel-procurement-source-'));
  const csv = Buffer.from('Description,Quantity,Unit price\r\n"Original, exact bytes",2,3\r\n');
  const secondary = Buffer.from('Description,Quantity\nRetry source,1\n');
  const badPdf = Buffer.from('A CSV body wearing a PDF filename');
  const sources = [ ['register.csv', 'text/csv', csv], ['retry.csv', 'text/csv', secondary], ['signature.pdf', 'application/pdf', badPdf] ];
  const req = key => ({ get: name => name === 'Idempotency-Key' ? key : name === 'User-Agent' ? 'Synthetic procurement workflow' : undefined });
  async function uploads(items = sources) {
    return Promise.all(items.map(async ([name, mime, bytes], index) => {
      const filename = path.join(directory, `${crypto.randomUUID()}-${index}`);
      await fs.promises.writeFile(filename, bytes);
      return { path: filename, originalname: name, filename: path.basename(filename), mimetype: mime };
    }));
  }
  const errorCode = code => error => { assert.equal(error.code, code); return true; };
  let service = fixture.load();
  try {
    // Only the second put fails. The manifest remains durable before storage,
    // while invalid signature metadata records a rejected outcome.
    const originalPut = fixture.puts;
    fixture.sourceControls.failPutOrdinal = 2;
    const staged = await uploads();
    const initial = await service.createUpload({ user, files: staged, req: req('stable-manifest') });
    assert.equal(initial.counts.uploaded_files, 3);
    assert.equal(initial.counts.stored_files, 1);
    assert.equal(initial.counts.failed_files, 1);
    assert.equal(initial.counts.rejected_files, 1);
    assert.equal(initial.files[2].error_code, 'FILE_SIGNATURE_INVALID');
    assert(initial.files.every(file => !Object.hasOwn(file, 'object_key') && !Object.hasOwn(file, 'original_bytes')), 'private source paths and bytes must not enter metadata DTOs');
    assert(staged.every(file => !fs.existsSync(file.path)), 'staging files must be removed after per-file outcomes persist');
    const batchId = initial.batch.id, ids = initial.files.map(file => file.id);
    assert.equal(fixture.state.files[0].storage_type, 'OBJECT_STORAGE');
    assert.equal(fixture.state.files[0].original_bytes, null, 'configured object storage must not silently copy original bytes into SQL');
    assert.equal(originalPut.length, 2);
    fixture.sourceControls.failPutOrdinal = null;
    const retried = await service.createUpload({ user, files: await uploads(), req: req('stable-manifest') });
    assert.equal(retried.existing, true);
    assert.equal(retried.batch.id, batchId);
    assert.deepEqual(Array.from(retried.files, file => file.id), Array.from(ids));
    assert.equal(retried.counts.stored_files, 2);
    assert.equal(retried.counts.failed_files, 0);
    assert.equal(retried.files[1].error_code, null, 'recovered durable storage must clear the old failure diagnostic');
    assert.equal(retried.files[1].error_message, null);
    assert.equal(originalPut.length, 3, 'retry must store only the failed source');

    fixture.environment.OBJECT_STORAGE_PROVIDER = 'synthetic-private-provider';
    fixture.sourceControls.storageConfigured = false;
    const incompleteStore = await service.createUpload({ user, files: await uploads([['selected-storage.csv', 'text/csv', secondary]]), req: req('selected-storage-incomplete') });
    assert.equal(incompleteStore.counts.failed_files, 1);
    assert.equal(incompleteStore.files[0].storage, null, 'a selected but incomplete private provider must not silently use SQL storage');
    assert.equal(incompleteStore.files[0].error_code, 'FIXTURE_STORAGE_CONFIGURATION');
    await assert.rejects(service.readSourceFile({ user, fileId: incompleteStore.files[0].id }), errorCode('SOURCE_NOT_STORED'));
    assert.equal(fixture.state.files.find(file => file.id === incompleteStore.files[0].id).original_bytes ?? null, null);
    delete fixture.environment.OBJECT_STORAGE_PROVIDER;
    fixture.sourceControls.storageConfigured = true;
    const replay = await service.createUpload({ user, files: await uploads(), req: req('stable-manifest') });
    assert.equal(replay.batch.id, batchId); assert.equal(originalPut.length, 3, 'durable sources must survive retry without another put');
    await assert.rejects(service.createUpload({ user, files: await uploads([['changed.csv', 'text/csv', csv]]), req: req('stable-manifest') }), errorCode('IDEMPOTENCY_CONFLICT'));

    service = fixture.load();
    for (const [index, bytes] of [[0, csv], [1, secondary]]) {
      const source = await service.readSourceFile({ user, fileId: ids[index] });
      assert.deepEqual(source.buffer, bytes, 'service reload must read the exact retained original');
      assert.equal(source.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    }
    const beforeDeniedGet = fixture.gets.length;
    await assert.rejects(service.readSourceFile({ user: other, fileId: ids[0] }), errorCode('PROCUREMENT_RECORD_NOT_FOUND'));
    assert.equal(fixture.gets.length, beforeDeniedGet, 'owner isolation must precede private source retrieval');
    assert.deepEqual((await service.readSourceFile({ user: manager, fileId: ids[0] })).buffer, csv);
    const retainedKey = fixture.state.files[0].object_key;
    fixture.objects.set(retainedKey, Buffer.from('corrupted durable bytes'));
    await assert.rejects(service.readSourceFile({ user, fileId: ids[0] }), errorCode('SOURCE_INTEGRITY_FAILED'));
    fixture.objects.set(retainedKey, Buffer.from(csv));
    fixture.state.files[0].scan_status = 'QUARANTINED';
    await assert.rejects(service.readSourceFile({ user, fileId: ids[0] }), errorCode('SOURCE_SECURITY_PENDING'));
    fixture.state.files[0].scan_status = 'UNAVAILABLE';

    const sameOwner = await service.createUpload({ user, files: await uploads([sources[0]]), req: req('new-upload') });
    assert.equal(sameOwner.files[0].duplicate_of_file_id, ids[0]);
    const privateOwner = await service.createUpload({ user: other, files: await uploads([sources[0]]), req: req('new-upload') });
    assert.equal(privateOwner.files[0].duplicate_of_file_id, null, 'a duplicate file must not expose another owner source');

    await service.processPendingImports();
    const extracted = await service.getImport({ user, id: batchId });
    assert.equal(extracted.counts.pending_mapping, 2);
    assert.equal(extracted.counts.rejected_files, 1);
    assert.equal(extracted.counts.failed_files, 0);
    assert.equal(extracted.files[0].status, 'EXTRACTED');
    assert.equal(extracted.rows.find(row => row.file_id === ids[0]).raw.cells[0], 'Original, exact bytes');
    const rowIds = Array.from(extracted.rows, row => row.id).sort();
    service = fixture.load(); await service.processPendingImports();
    assert.deepEqual(Array.from((await service.getImport({ user, id: batchId })).rows, row => row.id).sort(), rowIds, 'restart must preserve unique extracted rows');

    // Block one real extraction after its claim is committed, then replace the
    // lease. The old worker must preserve the new claim and publish no rows.
    const fenced = await service.createUpload({ user, files: await uploads([['fenced.csv', 'text/csv', secondary]]), req: req('fenced') });
    let arrived, release;
    const started = new Promise(resolve => { arrived = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    fixture.sourceControls.extractionGate = async file => { if (file.filename === 'fenced.csv') { arrived(); await gate; } };
    const running = service.processPendingImports();
    await Promise.race([started, running.then(() => assert.fail('controlled extraction must reach its durable claim'))]);
    const fencedFile = fixture.state.files.find(file => file.id === fenced.files[0].id);
    assert.equal(fencedFile.status, 'EXTRACTING'); assert(fencedFile.processing_claim_token);
    const newClaim = crypto.randomUUID(); fencedFile.processing_claim_token = newClaim;
    release(); await running; fixture.sourceControls.extractionGate = null;
    assert.equal(fixture.state.files.find(file => file.id === fencedFile.id).processing_claim_token, newClaim);
    assert.equal(fixture.state.rows.filter(row => row.file_id === fencedFile.id).length, 0, 'stale extraction must not publish source rows');
    fixture.state.files.find(file => file.id === fencedFile.id).processing_expires_at = Date.now() - 1;
    await service.processPendingImports();
    assert.equal(fixture.state.files.find(file => file.id === fencedFile.id).status, 'EXTRACTED');
    assert.equal(fixture.state.rows.filter(row => row.file_id === fencedFile.id).length, 1);
    assert.deepEqual((await service.readSourceFile({ user, fileId: fencedFile.id })).buffer, secondary);
    assert.equal(fixture.transactions.begun, fixture.transactions.committed + fixture.transactions.rolledBack);
    assert.equal(fixture.transactions.released, fixture.transactions.begun);
    assert.equal(fixture.state.audits.filter(audit => audit.action === 'PROCUREMENT_IMPORT_REQUESTED').length, 5, 'upload replay must retain one request audit per manifest');
  } finally {
    await service.stopProcurementImportWorker();
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  await testEntryWorkflows();
  await testPrivateSourcesAndClaims();
  console.log('Procurement import workflow fixtures passed: entry revisions, owner scopes, full totals, durable private originals, retries and worker fencing.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
