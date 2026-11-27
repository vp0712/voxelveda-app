'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isQrStaffHost, qrStaffOrigin, qrStaffEmitEnabled } = require('../config/qrStaffOrigin');
const urls = require('../config/urls');
const service = require('../services/attendanceQrService');

function testStaffOrigin() {
  const keys = ['QR_STAFF_ORIGIN', 'QR_STAFF_EMIT', 'SHIFT_QR_SIGNING_KEY', 'SHIFT_QR_SITE_ID'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const staffOrigin = 'https://qr.voxelveda.com';
  const at = new Date('2026-11-27T08:00:00Z');
  try {
    process.env.SHIFT_QR_SIGNING_KEY = crypto.randomBytes(32).toString('hex');
    process.env.SHIFT_QR_SITE_ID = 'fixture-qr-staff-a';
    delete process.env.QR_STAFF_ORIGIN;
    delete process.env.QR_STAFF_EMIT;
    const oldScan = service.createSiteToken(at);
    assert.equal(new URL(oldScan.qr_data).origin, urls.app);
    assert.equal(isQrStaffHost({ headers: { host: 'QR.VOXELVEDA.COM:443' } }), true);
    assert.equal(isQrStaffHost({ headers: { host: 'app.voxelveda.com', 'x-forwarded-host': 'qr.voxelveda.com' } }), false);

    process.env.QR_STAFF_EMIT = 'true';
    for (const setting of ['', 'http://qr.voxelveda.com', 'https://wrong.example', staffOrigin + '/extra']) {
      process.env.QR_STAFF_ORIGIN = setting;
      assert.equal(qrStaffOrigin(), '');
      assert.equal(qrStaffEmitEnabled(), false);
      assert.equal(new URL(service.createSiteToken(at).qr_data).origin, urls.app);
    }

    process.env.QR_STAFF_ORIGIN = staffOrigin + '/';
    assert.equal(qrStaffOrigin(), staffOrigin);
    const issued = service.createSiteToken(at);
    const scan = new URL(issued.qr_data);
    assert.equal(scan.origin, staffOrigin);
    assert.equal(scan.pathname, '/a');
    const token = scan.searchParams.get('t');
    assert.ok(token);
    assert.deepEqual(service.validateSiteToken(scan.href, at), service.validateSiteToken(oldScan.qr_data, at));
    assert.throws(() => service.validateSiteToken(scan.href, new Date(issued.expires_at)), { code: 'ATTENDANCE_QR_EXPIRED' });
    assert.throws(() => service.validateSiteToken(staffOrigin + '/wrong?t=' + token, at), { code: 'ATTENDANCE_QR_INVALID' });
    assert.throws(() => service.validateSiteToken('https://wrong.example/a?t=' + token, at), { code: 'ATTENDANCE_QR_INVALID' });

    process.env.QR_STAFF_EMIT = 'false';
    assert.equal(new URL(service.createSiteToken(at).qr_data).origin, urls.app);
    assert.equal(service.validateSiteToken(scan.href, at).site_id, 'fixture-qr-staff-a');
    assert.equal(service.validateSiteToken(oldScan.qr_data, at).site_id, 'fixture-qr-staff-a');

    const remoteDeviceId = crypto.randomUUID();
    const action = { userId: 123, action: 'CHECK_IN', now: at };
    const remoteProof = service.createActionProof({ ...action, remoteDeviceId }).qr_proof;
    const workplaceProof = service.createActionProof({ ...action, siteToken: token }).qr_proof;
    assert.equal(service.validateActionProof({ ...action, token: remoteProof, remoteDeviceId }).user_id, 123);
    assert.throws(() => service.validateActionProof({ ...action, token: remoteProof }), { code: 'ATTENDANCE_QR_WRONG_DEVICE' });
    assert.throws(() => service.validateActionProof({ ...action, token: workplaceProof, remoteDeviceId }), { code: 'ATTENDANCE_QR_WRONG_DEVICE' });
    assert.throws(() => service.validateActionProof({ ...action, token: remoteProof, remoteDeviceId: crypto.randomUUID() }), { code: 'ATTENDANCE_QR_WRONG_DEVICE' });
    assert.throws(() => service.validateSiteToken(remoteProof, at), { code: 'ATTENDANCE_QR_WRONG_PURPOSE' });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

testStaffOrigin();
console.log('QR staff origin tests passed.');
