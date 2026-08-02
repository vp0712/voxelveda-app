# Railway Custom Domain Setup

Target application origin: `https://app.voxelveda.com`

Railway remains the hosting provider. The custom domain only changes the public address. Do not remove the Railway-generated domain during migration; it is the tested fallback and rollback path.

## 1. Prepare Railway variables

In the Railway service, open **Variables** and set:

```text
PUBLIC_WEBSITE_URL=https://voxelveda.com
PUBLIC_APP_URL=https://app.voxelveda.com
APP_ORIGIN=https://app.voxelveda.com
COOKIE_DOMAIN=.voxelveda.com
ALLOWED_ORIGINS=https://app.voxelveda.com,https://voxelveda.com,<current Railway HTTPS origin>
FORCE_CANONICAL_HOST=false
RAILWAY_FALLBACK_HOST=<current Railway hostname only>
```

Keep `FORCE_CANONICAL_HOST=false` until the custom hostname resolves publicly and Railway shows an active certificate.

## 2. Add the domain in Railway

1. Open the production service in Railway.
2. Open **Settings**.
3. Find **Networking** or **Public Networking**.
4. Select **+ Custom Domain**.
5. Enter `app.voxelveda.com`.
6. Railway will display the required DNS records. Copy the exact CNAME and TXT names and values from Railway.

Do not guess DNS values. Railway currently requires both the displayed CNAME and TXT records; a missing validation TXT record can result in a 404 even when the CNAME looks correct.

## 3. Add DNS records

At the DNS provider for `voxelveda.com`:

1. Create the CNAME exactly as Railway displays it.
2. Create the TXT verification record exactly as Railway displays it.
3. Remove only conflicting records for the same `app` hostname after confirming they are not used by another service.
4. Do not proxy the record unless Railway and the DNS provider explicitly support that configuration.

DNS propagation can take time. Railway documents that changes can take up to 72 hours, although they often complete sooner.

## 4. Verify before redirecting

Confirm all of the following:

- `https://app.voxelveda.com/api/health` returns HTTP 200.
- Railway shows the custom domain as active.
- The browser shows a valid TLS certificate for `app.voxelveda.com`.
- `/`, `/login`, `/request-quote`, `/privacy`, `/terms` and `/support` load.
- Anonymous `/admin` redirects to `/login`.
- Admin and staff login, API data, logout, invoice PDF and QR flows work.
- The Railway fallback URL still works.

Only then set `FORCE_CANONICAL_HOST=true`. This performs a temporary 302 redirect from the configured Railway fallback hostname to the custom domain. Change it to a permanent redirect only after a monitored migration period.

## 5. Native application warning

`capacitor.config.json` now targets `https://app.voxelveda.com`. Do not publish a new Android or iOS build until DNS, TLS and authenticated mobile testing succeed on that origin.

## Rollback

1. Set `FORCE_CANONICAL_HOST=false` immediately.
2. Use the Railway fallback URL.
3. Roll back Railway to the last healthy deployment if needed.
4. Keep DNS records in place while investigating unless they point to the wrong service.

References:

- [Railway Public Networking](https://docs.railway.com/networking/public-networking)
- [Railway Working with Domains](https://docs.railway.com/networking/domains/working-with-domains)
