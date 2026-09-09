const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];

function expect(file, pattern, message) {
  if (!pattern.test(read(file))) failures.push(`${file}: ${message}`);
}

const trashService = read('services/trashService.js');
const notificationController = read('controllers/notificationController.js');
const trashRoutes = read('routes/trashRoutes.js');
const permissionCatalog = read('config/permissionCatalog.js');
const app = read('app.js');
const server = read('server.js');
const adminHtml = read('public/admin-dashboard.html');
const adminJs = read('public/admin-dashboard.js');
const staffHtml = read('public/staff-dashboard.html');
const staffJs = read('public/staff.js');

expect('migrations/20260909_erp_wave1_trash_notifications.sql', /CREATE TABLE IF NOT EXISTS trash_items/i, 'central Trash migration is missing');
expect('migrations/20260909_erp_wave1_trash_notifications.sql', /notification_preferences/i, 'notification preferences migration is missing');
expect('services/trashService.js', /const RETENTION_DAYS = 15;/, 'retention is not exactly 15 days');
expect('services/trashService.js', /crypto\.randomUUID\(\)/, 'Trash records do not receive an opaque UUID');
expect('services/trashService.js', /TRASH_RESTORE_CONFLICT/, 'restore uniqueness conflict is not enforced');
expect('services/trashService.js', /retention_hold/, 'retention holds are not enforced');
expect('services/trashService.js', /supplier_bills WHERE supplier_id/, 'financial supplier retention hold is missing');
expect('services/trashService.js', /DELETE FROM supplier_files WHERE supplier_id/, 'supplier attachment purge is missing');
expect('services/trashService.js', /fs\.promises\.unlink/, 'supplier attachment disk cleanup is missing');
expect('services/trashService.js', /options\.lock \? ' FOR UPDATE'/, 'Trash restore and purge locking is missing');
expect('services/trashService.js', /manager_id = \?/, 'manager team-scoped Trash access is missing');
expect('services/trashService.js', /MOVED_TO_TRASH/, 'delete audit event is missing');
expect('services/trashService.js', /RESTORED_FROM_TRASH/, 'restore audit event is missing');
expect('services/trashService.js', /TRASH_PERMANENT_DELETE/, 'permanent-delete audit event is missing');
expect('services/trashPurgeService.js', /purge_at <= NOW\(\)/, 'scheduled expiry filter is missing');
expect('services/trashPurgeService.js', /recordPurgeFailure/, 'purge failures are not recorded');

for (const entity of ['customer', 'supplier', 'meeting', 'task', 'announcement', 'staff_message', 'staff_work_request', 'notification']) {
  if (!new RegExp(`\\b${entity}:\\s*\\{`).test(trashService)) failures.push(`eligible Trash entity missing: ${entity}`);
}
for (const forbidden of ['audit_log', 'invoice', 'payment', 'quality_release', 'coc']) {
  if (new RegExp(`\\b${forbidden}:\\s*\\{`).test(trashService)) failures.push(`protected record is incorrectly Trash-eligible: ${forbidden}`);
}

for (const route of [
  /router\.get\('\/'/,
  /router\.get\('\/:trashId'/,
  /router\.post\('\/:trashId\/restore'/,
  /router\.delete\('\/:trashId\/permanent'/,
  /router\.post\('\/bulk-restore'/,
  /router\.post\('\/bulk-delete'/
]) if (!route.test(trashRoutes)) failures.push(`Trash route missing: ${route}`);
if (!/requireAnyPermission\('MANAGE_TRASH'\), requireStepUp\('PERMANENT_DELETE'\)/.test(trashRoutes)) failures.push('permanent deletion is not protected by permission plus step-up');
if (!/PERMANENTLY DELETE/.test(trashService)) failures.push('exact permanent-delete confirmation is missing');

for (const permission of ['VIEW_TRASH', 'RESTORE_TRASH', 'MANAGE_TRASH']) {
  if (!permissionCatalog.includes(`'${permission}'`)) failures.push(`permission missing: ${permission}`);
}
if (!/HIGH_RISK_PERMISSIONS[\s\S]*'MANAGE_TRASH'/.test(permissionCatalog)) failures.push('MANAGE_TRASH is not high risk');
if (!/app\.use\('\/api\/trash',auth,trashRoutes\)/.test(app)) failures.push('Trash API is not mounted');
if (!/app\.use\('\/api\/notifications',auth,notificationRoutes\)/.test(app)) failures.push('Notification API is not mounted');
if (!/startTrashPurgeScheduler\(\)/.test(server) || !/stopTrashPurgeScheduler\(\)/.test(server)) failures.push('Trash purge scheduler lifecycle is incomplete');

if (!/function activeNotificationWhere\([^)]*\)[\s\S]*user_id = \?/.test(notificationController)) failures.push('notification ownership filter is missing');
if (!/NOT EXISTS[\s\S]*in_app_enabled = 0/.test(notificationController)) failures.push('in-app category preferences are not enforced');
if (!/findActiveTrashItem\('notification', notificationId, req\.user\.id\)/.test(notificationController)) failures.push('notification restore is not owner-scoped');
if (!/moveToTrash\([\s\S]*entityType: 'notification'/.test(notificationController)) failures.push('notification delete does not use Trash');
for (const action of ['markRead', 'markUnread', 'markAllRead', 'clearRead', 'clearAll', 'getPreferences', 'updatePreference']) {
  if (!notificationController.includes(`exports.${action}`)) failures.push(`notification action missing: ${action}`);
}

if (!/id="trashSection"/.test(adminHtml) || !/data-section="trashSection"/.test(adminHtml)) failures.push('admin Trash workspace/navigation is missing');
if (!/loadTrash/.test(adminJs) || !/restoreTrash/.test(adminJs) || !/bulkPermanentDeleteTrash/.test(adminJs)) failures.push('admin Trash controls are incomplete');
if (!/Notification Centre/.test(adminHtml) || !/deleteNotification/.test(adminJs) || !/showNotificationUndo/.test(adminJs)) failures.push('admin Notification Centre actions are incomplete');
if (!/Notification Centre/.test(staffHtml) || !/deleteStaffNotification/.test(staffJs) || !/showStaffNotificationUndo/.test(staffJs)) failures.push('staff Notification Centre actions are incomplete');
if (!/openStaffNotificationPreferences/.test(staffHtml) || !/data-staff-preference-category/.test(staffJs)) failures.push('staff notification preferences are missing');
if (!/id="staffTrashSection"/.test(staffHtml) || !/data-section="staffTrashSection"/.test(staffHtml)) failures.push('staff-scoped Trash workspace/navigation is missing');
if (!/loadStaffTrash/.test(staffJs) || !/restoreStaffTrashItem/.test(staffJs)) failures.push('staff Trash restore controls are incomplete');
if (!/purge_error[\s\S]*trash-purge-error/.test(adminJs)) failures.push('administrators cannot see recorded purge failures');
if (!/notification-panel[\s\S]*max-height: calc\(100dvh/.test(read('public/style.css'))) failures.push('mobile Notification Centre height protection is missing');

for (const controller of ['customerController.js', 'supplierController.js', 'meetingController.js', 'taskController.js']) {
  if (!/moveToTrash/.test(read(`controllers/${controller}`))) failures.push(`${controller} is not connected to central Trash`);
}

if (failures.length) {
  console.error('ERP Wave 1 Trash/Notification audit failed:');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log('ERP Wave 1 Trash/Notification audit passed.');
