'use strict';
const assert=require('node:assert');
const { shiftIsoYear, planLegacyPdfYearRepair }=require('../services/financeDateIntegrityRepair');

assert.strictEqual(shiftIsoYear('2031-08-31',7),'2024-08-31');
assert.strictEqual(shiftIsoYear('2030-02-28',7),'2023-02-28');

const first=planLegacyPdfYearRepair({
  originalName:'78E48FF9-3DDC-4694-831B-0EA413C21513.pdf',
  minDate:'2024-07-01',
  maxDate:'2031-08-31',
  today:'2026-09-25'
});
assert.strictEqual(first.eligible,true);
assert.strictEqual(first.correctedMin,'2017-07-01');
assert.strictEqual(first.correctedMax,'2024-08-31');

const second=planLegacyPdfYearRepair({
  originalName:'7AB548AC-523C-40B0-954A-16930800F4D1.pdf',
  minDate:'2023-02-10',
  maxDate:'2030-02-28',
  today:'2026-09-25'
});
assert.strictEqual(second.eligible,true);
assert.strictEqual(second.correctedMin,'2016-02-10');
assert.strictEqual(second.correctedMax,'2023-02-28');

assert.strictEqual(planLegacyPdfYearRepair({
  originalName:'unrelated.pdf',minDate:'2024-01-01',maxDate:'2031-01-01',today:'2026-09-25'
}).eligible,false);
assert.strictEqual(planLegacyPdfYearRepair({
  originalName:'78E48FF9-3DDC-4694-831B-0EA413C21513.pdf',minDate:'2017-07-01',maxDate:'2024-08-31',today:'2026-09-25'
}).eligible,false);

console.log('FINANCE_DATE_INTEGRITY_REPAIR_TEST_OK');
