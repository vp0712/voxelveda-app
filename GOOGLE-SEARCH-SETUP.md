# Google Search Setup

Only public pages should be indexed. Authenticated portals, APIs, invoices, uploads and internal records are excluded by route headers and `robots.txt`.

## Search Console

1. Open Google Search Console and add a **Domain property** for `voxelveda.com` if it does not already exist.
2. Add the DNS TXT verification record supplied by Google.
3. After verification, submit `https://app.voxelveda.com/sitemap.xml` in **Sitemaps**.
4. Use **URL Inspection** for:
   - `https://app.voxelveda.com/`
   - `https://app.voxelveda.com/request-quote`
   - `https://app.voxelveda.com/privacy`
   - `https://app.voxelveda.com/terms`
   - `https://app.voxelveda.com/support`
5. Request indexing only after the custom domain and canonical tags are live.

## Expected exclusions

The following should remain non-indexed: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/admin`, `/dashboard`, `/invoice/view`, `/attendance-terminal`, `/api/*`, `/uploads/*` and `/invoices/*`.

Do not expose private URLs in the sitemap or publish access tokens in links. Search Console may continue to report historical Railway URLs until Google recrawls them.

References:

- [Google URL Inspection](https://support.google.com/webmasters/answer/9012289?hl=en)
- [Google Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en)
- [Google robots meta and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
