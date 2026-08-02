# Voxel Veda Operations Platform

Voxel Veda is a Node.js and Express operations platform for RFQs, invoices, customers, suppliers, inventory, workforce, attendance, rostering, expenses and controlled company records.

## Local development

1. Copy `.env.example` to `.env` and provide the database, JWT and email values.
2. Install dependencies with `npm install`.
3. Run `npm run check` and `npm test`.
4. Start the server with `npm run dev` and open `http://localhost:5001/`.

Do not commit `.env`, credentials, signing keys, uploaded customer documents or database exports.

## Production routes

- Public: `/`, `/request-quote`, `/privacy`, `/terms`, `/support`
- Authentication: `/login`, `/register`, `/forgot-password`, `/reset-password`
- Protected: `/admin`, `/dashboard`, `/invoice/view`
- Health: `/api/health`

The intended public origin is `https://app.voxelveda.com`. Keep `FORCE_CANONICAL_HOST=false` until Railway confirms the custom domain and SSL are active.

## Deployment

See `CUSTOM-DOMAIN-SETUP.md` and `DEPLOYMENT-CHECKLIST.md`. Railway remains the application host; the custom domain changes the public address, not the hosting provider.
