'use strict';

// This separate, reserved hostname shares the deployment, never the portal origin.
const QR_HOSTNAME = 'qr.voxelveda.com';
const QR_ORIGIN = 'https://' + QR_HOSTNAME;

function qrStaffOrigin() {
  const setting = String(process.env.QR_STAFF_ORIGIN || '').trim();
  if (!setting) return '';
  try {
    const url = new URL(setting);
    return url.origin === QR_ORIGIN && url.href === QR_ORIGIN + '/' ? QR_ORIGIN : '';
  } catch {
    return '';
  }
}

function isQrStaffHost(req) {
  // Railway forwards the public Host. Ignore client-supplied X-Forwarded-Host.
  // Reserve this host even before activation so it cannot serve the main portal.
  const authority = String(req.headers.host || '').toLowerCase();
  return /^qr\.voxelveda\.com\.?(?::[0-9]+)?$/.test(authority);
}

function qrStaffEmitEnabled() {
  return !!qrStaffOrigin() && String(process.env.QR_STAFF_EMIT || '').trim().toLowerCase() === 'true';
}

module.exports = { qrStaffOrigin, isQrStaffHost, qrStaffEmitEnabled };
