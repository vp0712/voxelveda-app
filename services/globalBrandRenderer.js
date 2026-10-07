'use strict';

const BRAND_CSS = '/global-brand.css?v=20260918-global-loader';
const BRAND_JS = '/global-brand.js?v=20260918-global-loader';
const WORKSPACE_CSS = '/workspace-theme.css?v=20261007-sidebar-recovery';
const FINANCE_PDF_ENHANCER_JS = '/finance-pdf-import-enhancer.js?v=20260918-pdf-parser2'; // retained as legacy asset reference only
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
  // All role pages receive the same release of the legacy base assets after
  // ownership of shared navigation layout moves to workspace-theme.css.
  rendered=rendered.replace(/(["'])(\/?(?:style|advanced-theme)\.css)(?:\?[^"'\s>]*)?\1/g, '$1$2?v=20261007-sidebar-recovery$1');

  // One appearance contract for every portal, including generated and role pages.
  // Additive metadata never changes role, permission, hidden or workflow attributes.
  rendered = rendered.replace(/<body([^>]*)>/i, (match, attributes) =>
    /\bdata-vv-theme\s*=/i.test(attributes) ? match : `<body${attributes} data-vv-theme="sapphire">`);
  if (/<meta\b[^>]*name=["']theme-color["'][^>]*>/i.test(rendered)) {
    rendered = rendered.replace(/<meta\b[^>]*name=["']theme-color["'][^>]*>/gi,
      '<meta name="theme-color" content="#F4F7FB">');
  } else {
    rendered = rendered.replace(/<\/head>/i, '  <meta name="theme-color" content="#F4F7FB">\n</head>');
  }

  if (!rendered.includes(BRAND_CSS)) rendered = rendered.replace(/<\/head>/i, `  <link rel="stylesheet" href="${BRAND_CSS}">\n</head>`);
  if (!rendered.includes(WORKSPACE_CSS)) rendered = rendered.replace(/<\/head>/i, `  <link rel="stylesheet" href="${WORKSPACE_CSS}">\n</head>`);
  if (!rendered.includes('/workspace-theme.js')) rendered = rendered.replace(/<head([^>]*)>/i, '<head$1>\n<script src="/workspace-theme.js?v=20261007-sidebar-recovery"></script>');
  if (!rendered.includes('/workspace-shell.js')) rendered = rendered.replace(/<\/body>/i, '<script src="/workspace-shell.js?v=20261007-sidebar-recovery" defer></script>\n</body>');

  const loaderMarkup = `\n<div id="vvGlobalBrandPresence" aria-hidden="true"><img src="${CANONICAL_LOGO}" alt=""></div>\n<div id="vvGlobalBrandLoader" aria-hidden="true" role="status" aria-live="polite" aria-label="Voxel Veda is loading">\n  <div class="vv-brand-loader-scene">\n    <div class="vv-brand-orbit" aria-hidden="true">\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-one"></span>\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-two"></span>\n      <span class="vv-brand-orbit-ring vv-brand-orbit-ring-three"></span>\n      <span class="vv-brand-scan-line"></span>\n      <div class="vv-brand-loader-logo-stage">\n        <img class="vv-brand-loader-logo" src="${CANONICAL_LOGO}" alt="Voxel Veda">\n      </div>\n    </div>\n    <div class="vv-brand-loader-pill">\n      <span class="vv-brand-loader-dot" aria-hidden="true"></span>\n      <span class="vv-brand-loader-label">Voxel Veda</span>\n    </div>\n    <p class="vv-brand-loader-context" id="vvGlobalBrandLoaderContext">Loading securely…</p>\n  </div>\n</div>\n`;

  if (!rendered.includes('id="vvGlobalBrandLoader"')) rendered = rendered.replace(/<body([^>]*)>/i, (match) => `${match}${loaderMarkup}`);
  // The unified Finance OS owns Finance and Banking interactions. No retired Banking frontend is injected globally.
  // The legacy PDF enhancer also stays uninjected because the current statement parser owns its loading path.
  if (!rendered.includes(BRAND_JS)) rendered = rendered.replace(/<\/body>/i, `  <script src="${BRAND_JS}" defer></script>\n</body>`);

  return rendered;
}

module.exports = { BRAND_CSS, BRAND_JS, WORKSPACE_CSS, FINANCE_PDF_ENHANCER_JS, CANONICAL_LOGO, canonicalizeLogoPaths, injectGlobalBrand };
