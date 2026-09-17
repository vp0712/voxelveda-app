'use strict';

const BRAND_CSS = '/global-brand.css?v=20260917c';
const BRAND_JS = '/global-brand.js?v=20260917c';
const CANONICAL_LOGO = '/logo.png?v=20260917c';

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

  const loaderMarkup = `\n<div id="vvGlobalBrandPresence" aria-hidden="true"><img src="${CANONICAL_LOGO}" alt=""></div>\n<div id="vvGlobalBrandLoader" aria-hidden="true" role="status" aria-live="polite" aria-label="Voxel Veda is loading">\n  <div class="vv-brand-loader-inner">\n    <div class="vv-brand-loader-logo-wrap">\n      <span class="vv-brand-loader-ring" aria-hidden="true"></span>\n      <div class="vv-brand-loader-logo-stage">\n        <img class="vv-brand-loader-logo" src="${CANONICAL_LOGO}" alt="Voxel Veda">\n      </div>\n    </div>\n    <div class="vv-brand-loader-copy">\n      <p class="vv-brand-loader-text">Preparing your workspace</p>\n      <p class="vv-brand-loader-subtext">Voxel Veda</p>\n    </div>\n  </div>\n</div>\n`;

  if (!rendered.includes('id="vvGlobalBrandLoader"')) rendered = rendered.replace(/<body([^>]*)>/i, (match) => `${match}${loaderMarkup}`);
  if (!rendered.includes(BRAND_JS)) rendered = rendered.replace(/<\/body>/i, `  <script src="${BRAND_JS}" defer></script>\n</body>`);

  return rendered;
}

module.exports = { BRAND_CSS, BRAND_JS, CANONICAL_LOGO, canonicalizeLogoPaths, injectGlobalBrand };
