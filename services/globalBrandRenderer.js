'use strict';

const BRAND_CSS = '/global-brand.css?v=20260918-global-loader';
const BRAND_JS = '/global-brand.js?v=20260918-global-loader';
const FINANCE_PDF_ENHANCER_JS = '/finance-pdf-import-enhancer.js?v=20260918-pdf-parser2'; // retained as legacy asset reference only
const ADVANCED_BANKING_JS = '/premium-banking-app.js?v=20260919-banking-error-fix';
const CANONICAL_LOGO = '/logo.png';

function canonicalizeLogoPaths(html) {
  return String(html || '')
    .replace(/(?:\.\/|\/)?voxel-veda-logo\.png(?:\?[^"'\s>]*)?/gi, CANONICAL_LOGO)
    .replace(/(?:\.\/|\/)?Frame(?:%20| )1\.png(?:\?[^"'\s>]*)?/gi, CANONICAL_LOGO)
    .replace(/(?:\.\/|\/)?og-image\.png(?:\?[^"'\s>]*)?/gi, CANONICAL_LOGO)
    .replace(/(?:https?:)?\/\/logo\.png(?:\?[^"'\s>]*)?/gi, CANONICAL_LOGO);
}

function injectGlobalBrand(html) {
  let rendered = canonicalizeLogoPaths(html);
  if (!rendered) return rendered;

  if (!rendered.includes(BRAND_CSS)) rendered = rendered.replace(/<\/head>/i, `  <link rel="stylesheet" href="${BRAND_CSS}">\n</head>`);

  const loaderMarkup = `\n<div id="vvGlobalBrandPresence" aria-hidden="true"><img src="${CANONICAL_LOGO}" alt=""></div>\n<div id="vvGlobalBrandLoader" aria-hidden="true" role="status" aria-live="polite" aria-label="Voxel Veda is loading">\n  <div class="vv-brand-loader-scene">\n    <div class="vv-brand-orbit" aria-hidden="true">\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-one"></span>\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-two"></span>\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-three"></span>\n      <span class="vv-brand-scan-line"></span>\n      <div class="vv-brand-loader-logo-stage">\n        <img class="vv-brand-loader-logo" src="${CANONICAL_LOGO}" alt="Voxel Veda">\n      </div>\n    </div>\n    <div class="vv-brand-loader-pill">\n      <span class="vv-brand-loader-dot" aria-hidden="true"></span>\n      <span class="vv-brand-loader-label">Voxel Veda</span>\n    </div>\n    <p class="vv-brand-loader-context" id="vvGlobalBrandLoaderContext">Loading securely…</p>\n  </div>\n</div>\n`;

  if (!rendered.includes('id="vvGlobalBrandLoader"')) rendered = rendered.replace(/<body([^>]*)>/i, (match) => `${match}${loaderMarkup}`);
  // PDF v3 is loaded by the Finance-only advanced banking client. Do not inject the
  // legacy PDF parser globally because two capture-phase import handlers can compete.
  if (!rendered.includes(ADVANCED_BANKING_JS)) rendered = rendered.replace(/<\/body>/i, `  <script src="${ADVANCED_BANKING_JS}" defer></script>\n</body>`);
  if (!rendered.includes(BRAND_JS)) rendered = rendered.replace(/<\/body>/i, `  <script src="${BRAND_JS}" defer></script>\n</body>`);

  return rendered;
}

module.exports = { BRAND_CSS, BRAND_JS, FINANCE_PDF_ENHANCER_JS, ADVANCED_BANKING_JS, CANONICAL_LOGO, canonicalizeLogoPaths, injectGlobalBrand };
