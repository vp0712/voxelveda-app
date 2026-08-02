# Route Migration

## Public routes

| Previous path | Clean path |
| --- | --- |
| `/index.html` | `/` |
| `/login.html` | `/login` |
| `/register.html` | `/register` |
| `/customer.html` | `/request-quote` |
| `/privacy-policy.html` | `/privacy` |
| `/shift-qr.html` | `/attendance-terminal` |

## Protected routes

| Previous path | Clean path |
| --- | --- |
| `/admin-dashboard.html` | `/admin` |
| `/staff-dashboard.html` | `/dashboard` |
| `/dashboard.html` | `/dashboard` |
| `/invoice-pdf.html` | `/invoice/view` |

Legacy paths return temporary 302 redirects and preserve query parameters. Clean protected routes validate the user against the database before serving private HTML. Existing bearer-token sessions use `/api/auth/session` once to establish the secure session cookie.

Module links such as `/invoices`, `/expenses`, `/roster` and `/timesheets` redirect to the appropriate portal and open the matching existing section.

Do not change the legacy redirects to permanent redirects until the custom domain and installed mobile applications have completed a monitored migration period.
