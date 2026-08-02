# Production Security Checklist

## Required before custom-domain launch

- [ ] Rotate `JWT_SECRET` to a long random production-only value.
- [ ] Store all secrets only in Railway Variables; never in Git or frontend code.
- [ ] Set `NODE_ENV=production`.
- [ ] Set trusted `ALLOWED_ORIGINS` explicitly.
- [ ] Keep cookies `HttpOnly`, `Secure` and `SameSite=Lax`.
- [ ] Verify TLS on the custom domain before publishing native builds.
- [ ] Test admin, staff and customer permission boundaries with separate accounts.
- [ ] Review every user and disable accounts that are no longer required.
- [ ] Confirm uploaded documents and invoice files are not linked publicly.
- [ ] Confirm API and private pages return `noindex` and `no-store` headers.
- [ ] Configure SMTP using a provider-specific application password or API credential.
- [ ] Enable database backups and test restoration.
- [ ] Review Railway logs for authentication failures, 403s, 429s and 500s.

## Current limitations requiring follow-up

- Logout token revocation is process-local; use a shared session/revocation store before horizontal scaling.
- Legacy bearer-token support remains for existing mobile clients. Remove it only after all installed apps use cookie sessions or an approved native secure-token store.
- Administrator-verified password reset is used. Do not add reset links without hashed, single-use, expiring server-side tokens and verified email delivery.
- Public static upload directories should be migrated to per-file authorised download routes or private object storage.
- CSP temporarily permits inline scripts/styles because the existing portals use them. Migrate inline handlers to external scripts, then remove `unsafe-inline`.

## Incident response

If credentials or data may be exposed: disable affected accounts, rotate secrets, preserve logs, invalidate sessions, review access, notify the responsible company contact and follow applicable Australian privacy obligations.
