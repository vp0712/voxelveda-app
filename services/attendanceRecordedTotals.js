'use strict';
// New records retain integer worked minutes. Round after consolidation instead
// of summing per-shift display decimals (twelve 50-minute shifts are 10 hours).
// Historical unverified hours are preserved as saved until authorised review;
// this helper does not attest their timestamps or change approved records.
function attendanceRecordedHours(rows) {
  let minutes = 0, historicalHours = 0;
  for (const row of rows) {
    if (row.timestamp_basis === 'UTC') {
      const value = Number(row.total_minutes);
      const hours = Number(row.total_hours);
      const exact = value / 60, rounded = Math.round(exact * 100) / 100;
      if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(hours) || hours < 0 ||
        (Math.abs(hours - rounded) > 0.000000001 && Math.abs(hours - exact) > 0.000000001) || !Number.isSafeInteger(minutes + value)) throw Object.assign(new Error('The recorded worked minutes and saved hours require review.'), { code: 'ATTENDANCE_DURATION_INVALID', statusCode: 422 });
      minutes += value;
    } else {
      const value = Number(row.total_hours || 0);
      if (!Number.isFinite(value) || value < 0) throw Object.assign(new Error('The historical recorded hours require review.'), { code: 'ATTENDANCE_DURATION_INVALID', statusCode: 422 });
      historicalHours += value;
      if (!Number.isFinite(historicalHours) || historicalHours > Number.MAX_SAFE_INTEGER / 100) throw Object.assign(new Error('The historical recorded total requires review.'), { code: 'ATTENDANCE_DURATION_INVALID', statusCode: 422 });
    }
  }
  return Math.round((minutes / 60 + historicalHours) * 100) / 100;
}
module.exports = { attendanceRecordedHours };
