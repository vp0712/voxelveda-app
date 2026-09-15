const fs = require('node:fs');
const path = require('node:path');

function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
function expect(source, needle, message) { if (!source.includes(needle)) throw new Error(message || `Expected ${needle}`); }

const reliability = read('public/finance-action-reliability.js');
const banking = read('public/finance-banking-readiness.js');
const authRoutes = read('routes/authRoutes.js');
const stepUpController = read('controllers/stepUpController.js');
const finance = read('public/finance-intelligence.js');
const advanced = read('public/finance-intelligence-advanced.js');

expect(reliability, "payload?.code !== 'STEP_UP_REQUIRED'", 'Reliability layer must identify step-up responses.');
expect(reliability, "'/api/auth/step-up'", 'Reliability layer must use the authenticated step-up endpoint.');
expect(reliability, "return originalFetch(input, init)", 'Original finance request must be retried after successful verification.');
expect(reliability, '6-digit authenticator code', 'Step-up dialog must clearly request the authenticator code.');
expect(reliability, 'Never enter your bank password, bank PIN or bank OTP', 'Step-up UI must distinguish app credentials from bank credentials.');
expect(reliability, "button.id === 'importStatement'", 'Import action guard is missing.');
expect(reliability, "document.getElementById('addAccount')?.click()", 'Import with no account must direct the user to Add Account.');
expect(reliability, "form.reportValidity()", 'Forms must visibly report invalid required fields.');
expect(reliability, 'financeActionToast', 'Global finance action status toast is missing.');
expect(reliability, "['notice', 'advancedNotice']", 'Existing finance notices must be mirrored to the visible status toast.');
expect(banking, '/finance-action-reliability.js?v=20260916-reliability', 'Banking UI must load the reliability layer.');
expect(authRoutes, "router.post('/step-up'", 'Step-up API route is missing.');
expect(stepUpController, 'PASSWORD_TOTP', 'Step-up verification must require password and TOTP assurance.');
expect(finance, "$('accountForm').addEventListener('submit'", 'Add Account handler must remain wired.');
expect(finance, "$('importForm').addEventListener('submit'", 'Import Statement handler must remain wired.');
expect(finance, "$('commitReview').addEventListener('click'", 'Review commit handler must remain wired.');
expect(finance, "$('rejectReview').addEventListener('click'", 'Review reject handler must remain wired.');
expect(advanced, "Object.defineProperty(event, 'currentTarget'", 'Mobile Safari submit-event compatibility guard is missing.');
expect(advanced, "value: form", 'Mobile Safari compatibility guard must preserve the submitting form.');
expect(advanced, "document.addEventListener('submit'", 'Mobile form guard must run in capture phase before finance submit handlers.');
expect(advanced, "$('analyseTransactions')?.addEventListener('click', runAnalysis)", 'Analyse button handler must remain wired.');
expect(advanced, "data-action=\"apply\"", 'Apply suggestion action must remain rendered.');

console.log('Finance action reliability regression checks passed.');
