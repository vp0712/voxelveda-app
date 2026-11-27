'use strict';

const { DateTime } = require('luxon');
const { fail } = require('./attendanceMobilePolicy');

const MAX_CAPTURE_AGE_MS = 120_000;
const MAX_CAPTURE_CLOCK_SKEW_MS = 15_000;
const MAX_ADDRESS_LENGTH = 500;
const GEOCODER_TIMEOUT_MS = 5000;

function locationRequired(env = process.env) {
  return String(env.ATTENDANCE_LOCATION_REQUIRED || '').trim().toLowerCase() === 'true';
}

function validateCapture(location, now) {
  if (location == null) {
    throw fail('Allow location access before recording attendance.', 'ATTENDANCE_LOCATION_REQUIRED', 422);
  }
  const { latitude, longitude, accuracy, captured_at: capturedAt } = location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 || typeof capturedAt !== 'string' ||
      capturedAt.length > 40 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)) {
    throw fail('The phone did not return a valid location. Try again.', 'ATTENDANCE_LOCATION_INVALID', 422);
  }
  const captured = DateTime.fromISO(capturedAt, { setZone: true });
  if (!captured.isValid) {
    throw fail('The phone did not return a valid location. Try again.', 'ATTENDANCE_LOCATION_INVALID', 422);
  }
  const age = now.getTime() - captured.toMillis();
  if (!Number.isFinite(age) || age > MAX_CAPTURE_AGE_MS || age < -MAX_CAPTURE_CLOCK_SKEW_MS) {
    throw fail('Your location is too old or the phone clock differs. Get your location again.', 'ATTENDANCE_LOCATION_STALE', 422);
  }
  return { latitude, longitude };
}

async function resolveAddress(location, now = new Date(), env = process.env, fetcher = fetch) {
  const point = validateCapture(location, now);
  let endpoint;
  try {
    endpoint = new URL(String(env.ATTENDANCE_GEOCODER_URL || '').trim());
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
  } catch {
    throw fail('Attendance address lookup is awaiting configuration.', 'ATTENDANCE_GEOCODER_NOT_CONFIGURED', 503);
  }
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = String(env.ATTENDANCE_GEOCODER_TOKEN || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;

  try {
    const response = await fetcher(endpoint.href, {
      method: 'POST', headers, body: JSON.stringify(point), redirect: 'error',
      signal: AbortSignal.timeout(GEOCODER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    const address = typeof result?.address === 'string' ? result.address.trim().replace(/\s+/gu, ' ') : '';
    if (!address || address.length > MAX_ADDRESS_LENGTH || /[\x00-\x1f\x7f]/.test(address)) throw new Error();
    return address;
  } catch {
    throw fail('Your attendance address could not be found. Try again.', 'ATTENDANCE_GEOCODER_UNAVAILABLE', 503);
  }
}

async function recordAddress(db, { attendanceId, userId, action, address }) {
  await db.query('INSERT INTO attendance_punch_locations (attendance_id,user_id,action,address) VALUES (?,?,?,?)',
    [attendanceId, userId, action, address]);
}

async function addressesBySession(db, userId, sessionIds) {
  const addresses = new Map();
  if (!sessionIds.length) return addresses;
  const [records] = await db.query('SELECT attendance_id,action,address FROM attendance_punch_locations WHERE user_id=? AND attendance_id IN (?)',
    [userId, sessionIds]);
  for (const { attendance_id: attendanceId, action, address } of records) {
    const id = Number(attendanceId);
    const entry = addresses.get(id) || {};
    entry[action === 'CHECK_IN' ? 'check_in_address' : 'check_out_address'] = address;
    addresses.set(id, entry);
  }
  return addresses;
}

module.exports = { locationRequired, validateCapture, resolveAddress, recordAddress, addressesBySession };
