'use strict';
// QR_PHONE_TEST=1 DB_PORT=3307 node scripts/qr-phone-mysql-test.js
// Uses a uniquely named disposable schema on the local test server.
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const phones = require('../services/qrPhoneService');

async function run() {
  assert.equal(process.env.QR_PHONE_TEST, '1', 'Set QR_PHONE_TEST=1 to run against a disposable local database.');
  const settings = {
    host: '127.0.0.1', port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || ''
  };
  const schema = 'vv_qr_phone_test_' + randomBytes(8).toString('hex');
  process.env.SHIFT_QR_SITE_ID = 'TestGate';
  const admin = await mysql.createConnection(settings);
  let db;
  let created = false;
  try {
    await admin.query('CREATE DATABASE ' + schema);
    created = true;
    db = mysql.createPool({ ...settings, database: schema, connectionLimit: 5 });
    await db.query(`CREATE TABLE users (
      id INT PRIMARY KEY, name VARCHAR(40), username VARCHAR(40), role VARCHAR(30),
      permissions JSON, employee_number VARCHAR(30), active INT, deleted_at DATETIME,
      account_status VARCHAR(30), session_version BIGINT
    ) ENGINE=InnoDB`);
    await db.query(`INSERT INTO users VALUES
      (1,'Staff One','staff1','staff','[]','EMP1',1,NULL,'ACTIVE',1),
      (2,'Staff Two','staff2','staff','[]','EMP2',1,NULL,'ACTIVE',1),
      (3,'Customer','customer','customer','["VIEW_ATTENDANCE"]','',1,NULL,'ACTIVE',1),
      (4,'Contractor','contractor','contractor','["VIEW_ATTENDANCE"]','EMP4',1,NULL,'ACTIVE',1)`);
    const hash = value => createHash('sha256').update(value).digest('hex');
    async function approval(userId = 1) {
      const start = phones.begin();
      const { code } = await phones.issueHandoff({ userId, challenge: start.challenge }, db);
      return { code, verifier: start.verifier };
    }
    const handoff = await approval();
    const pending = (await db.query('SELECT * FROM attendance_phone_links'))[0][0];
    assert.equal(pending.code_hash, hash(handoff.code));
    assert.equal(pending.challenge, hash(handoff.verifier));
    assert(!JSON.stringify(pending).includes(handoff.code));
    assert(!JSON.stringify(pending).includes(handoff.verifier));
    const invalidLink = { code: 'QR_PHONE_LINK_INVALID' };
    const unlinked = { code: 'QR_PHONE_UNLINKED', statusCode: 401 };
    await assert.rejects(phones.redeem({ ...handoff, verifier: phones.begin().verifier }, db), invalidLink);
    const attempts = await Promise.allSettled([phones.redeem(handoff, db), phones.redeem(handoff, db)]);
    assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(a => a.status === 'rejected').reason.code, invalidLink.code);
    const { deviceId, credential } = attempts.find(a => a.status === 'fulfilled').value;
    const linked = (await db.query('SELECT * FROM attendance_phone_links WHERE id=?', [deviceId]))[0][0];
    assert.equal(linked.code_hash, null);
    assert.equal(linked.credential_hash, hash(credential));
    assert(!JSON.stringify(linked).includes(credential));
    const identity = await phones.verify(credential, db);
    assert.equal(identity.user.id, 1);
    assert.deepEqual(identity.user.permission_boundary, ['VIEW_ATTENDANCE']);
    await phones.authorizeAction(db, 1, deviceId);
    await assert.rejects(phones.authorizeAction(db, 2, deviceId), unlinked);
    await assert.rejects(phones.redeem(handoff, db), invalidLink);
    await assert.rejects(approval(3), { code: 'QR_PHONE_INELIGIBLE' });
    const contractor = await phones.redeem(await approval(4), db);
    await db.query("UPDATE users SET permissions='[]' WHERE id=4");
    await assert.rejects(phones.verify(contractor.credential, db), unlinked);
    process.env.SHIFT_QR_SITE_ID = 'testgate';
    await assert.rejects(phones.verify(credential, db), unlinked);
    process.env.SHIFT_QR_SITE_ID = 'TestGate';
    await db.query('UPDATE users SET active=0 WHERE id=1');
    await assert.rejects(phones.verify(credential, db), unlinked);
    await db.query('UPDATE users SET active=1, session_version=2 WHERE id=1');
    await assert.rejects(phones.verify(credential, db), unlinked);

    const expired = await approval();
    await db.query('UPDATE attendance_phone_links SET expires_at=UTC_TIMESTAMP(3) WHERE code_hash=?', [hash(expired.code)]);
    await assert.rejects(phones.redeem(expired, db), invalidLink);
    const first = await phones.redeem(await approval(), db);
    const second = await phones.redeem(await approval(), db);
    const otherUser = await phones.redeem(await approval(2), db);
    await phones.revoke(first.credential, db);
    await assert.rejects(phones.verify(first.credential, db), unlinked);
    await assert.rejects(phones.authorizeAction(db, 1, first.deviceId), unlinked);
    await phones.verify(second.credential, db);
    const waiting = await approval();
    await phones.revokeAll(1, db);
    await assert.rejects(phones.verify(second.credential, db), unlinked);
    await assert.rejects(phones.redeem(waiting, db), invalidLink);
    await phones.verify(otherUser.credential, db);
    await db.query('UPDATE attendance_phone_links SET expires_at=UTC_TIMESTAMP(3) WHERE id=?', [otherUser.deviceId]);
    await assert.rejects(phones.verify(otherUser.credential, db), unlinked);
    console.log('PASS QR phone credential lifecycle, concurrency, expiry, account and ownership boundaries.');
  } finally {
    if (db) await db.end();
    try {
      if (created) await admin.query('DROP DATABASE ' + schema);
    } finally {
      await admin.end();
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
