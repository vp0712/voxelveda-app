'use strict';
const CLIENT_ROLES = new Set(['client', 'customer', 'viewer', 'view_only']);
function customerScoped(user) { return CLIENT_ROLES.has(String(user?.role || '').toLowerCase()); }
function customerEmail(user) { return String(user?.email || '').trim().toLowerCase(); }
function ownsCustomerRecord(user, email) { return !customerScoped(user) || Boolean(customerEmail(user) && customerEmail(user) === String(email || '').trim().toLowerCase()); }
function assertCustomerRecord(user, email) { if (!ownsCustomerRecord(user, email)) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'CUSTOMER_RECORD_NOT_FOUND' }); }
module.exports = { customerScoped, customerEmail, ownsCustomerRecord, assertCustomerRecord };
