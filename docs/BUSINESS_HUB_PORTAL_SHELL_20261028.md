# Shared portal shell, 28 October 2026

The prior release applied the Business Hub palette and panel corners. Retained
layout rules with higher specificity still won on navigation, search, grouped
menus and mobile branding. This change applies the actual shell presentation
consistently instead of adding another portal application.

## Changes

- Retained admin and workforce portals keep their links, role filtering, click
  handlers and module content. The shared shell adds navigation icons, compact
  grouped menus, a readable navy rail, a flat header and navigation search access.
- Staff, HR, manager, supervisor, production and sales use their existing role
  workflows. Existing administrative and customer role aliases remain supported.
- Client, profile, account, security, quality, shop-floor, recruitment, employee
  identity and invoice-view pages gain the same rail. Navigation reuses their
  existing same-origin page links and common own-account links. No new module
  authority is granted. Public login, signup and attendance-display pages do not
  gain a workspace sidebar.
- Mobile dedicated-page drawers restore focus/scroll on dismissal, trap keyboard
  focus, close on navigation/Escape, and release their lock on desktop resize.
- Permission-hidden and search-hidden links stay hidden even when previously
  selected. Existing backend permission checks remain authoritative.
- Original logo bytes, chart configuration, renderer functions, aggregation,
  chart grids, content gutters and canvas geometry remain unchanged.
- Versioned shell assets use the existing renderer and update on page reload.

## Verification

`npm run build` covers the 85 retained application regression scripts. The release
workflow also runs the existing Chromium/WebKit attendance, approval, weekly PDF,
invoice, procurement, account and portal gates, real MySQL tests, security checks
and installed Android verification. Its chart gate compares 28 before/after cases
and 84 exact canvas dimensions against the preserved chart baseline.

The added `business-hub-shell-browser-test.js` exercises 15 retained role names at
320, 768 and 1440px, plus nine dedicated pages. It checks actual permission/search
visibility, menu opening/dismissal, page width, one rail, focus trapping/restoration
and scroll-lock cleanup. Screenshots and machine-readable evidence are retained
as workflow artifacts. These are synthetic authenticated fixtures; they do not
claim physical-phone or private production-account verification.

A disposable managed preview uses these actual assets with synthetic identities.
Its preview-only authentication and iframe configuration are not in the release.

## Existing PDF and weekly-delivery limits

The PDF generation, parser validation, immutable staff snapshots, PDF download
headers, MIME attachment validation, Monday 07:00 Australia/Sydney schedule and
one-designated-recipient policy are retained. Routine approval at verified hours
does not require a note; adjustments and review decisions still require reasons.

Fresh production diagnosis for the last completed 19–25 October work week shows
one otherwise eligible employee without a designated delivery address. No login
email is substituted. The existing HTTPS WordPress relay also fails its health
JSON contract before transport; correct local PDF bytes do not fix that receiver.
WPVibe lists no connected site, and the canonical WordPress connection returns a
non-JSON REST response. Authenticated WordPress administrator access/connection
and a genuine designated address are still needed. No provider, plan, billing,
DNS, recipient or historical attendance record is changed by this release.

Provider acceptance and recipient receipt remain distinct. No staff/customer test
mail is sent by these tests, and a successful deploy does not prove email delivery.

## Release and recovery

Use the existing candidate gates, merged-main gates and marker-only production
release workflow. Previous live source: `1d1ca411fee0c3faf261ed35c86c387df8032e34`;
Railway deployment `d0924611-38aa-4e85-a1b2-4bcd563ce0f8`. This is a presentation
release with no schema migration. Preserve data, attachments, snapshots, audit
history and encryption keys during any rollback. Banking and the added ERP portal
remain retired.
