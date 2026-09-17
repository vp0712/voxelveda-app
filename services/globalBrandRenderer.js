'use strict';

const BRAND_CSS = '/global-brand.css?v=20260917b';
const BRAND_JS = '/global-brand.js?v=20260917b';
const CANONICAL_LOGO = '/logo.png';

function injectGlobalBrand(html) {
  let rendered = String(html || '');
  if (!rendered) return rendered;

  // Canonicalise historical aliases to the exact original binary. Do not touch favicons/app icons.
  rendered = rendered
    .replace(/(?:\.\/)?voxel-veda-logo\.png/gi, CANONICAL_LOGO)
    .replace(/(?:\.\/)?Frame(?:%20| )1\.png/gi, CANONICAL_LOGO)
    .replace(/(?:\.\/)?og-image\.png/gi, CANONICAL_LOGO);

  if (!rendered.includes(BRAND_CSS)) rendered = rendered.replace(/<\/head>/i, `  <link rel="stylesheet" href="${BRAND_CSS}">\n</head>`);

  const loaderMarkup = `\n<div id="vvGlobalBrandPresence" aria-hidden="true"><img src="${CANONICAL_LOGO}" alt=""></div>\n<div id="vvGlobalBrandLoader" aria-hidden="true" role="status" aria-live="polite" aria-label="Voxel Veda is loading">\n  <div class="vv-brand-loader-inner">\n    <div class="vv-brand-loader-logo-wrap">\n      <span class="vv-brand-loader-ring" aria-hidden="true"></span>\n      <img class="vv-brand-loader-logo" src="${CANONICAL_LOGO}" alt="Voxel Veda">\n    </div>\n    <div class="vv-brand-loader-copy">\n      <p class="vv-brand-loader-text">Preparing your workspace</p>\n      <p class="vv-brand-loader-subtext">Voxel Veda</p>\n    </div>\n  </div>\n</div>\n`;

  if (!rendered.includes('id="vvGlobalBrandLoader"')) rendered = rendered.replace(/<body([^>]*)>/i, (match) => `${match}${loaderMarkup}`);
  if (!rendered.includes(BRAND_JS)) rendered = rendered.replace(/<\/body>/i, `  <script src="${BRAND_JS}" defer></script>\n</body>`);

  return rendered;
}

module.exports = { BRAND_CSS, BRAND_JS, CANONICAL_LOGO, injectGlobalBrand };
