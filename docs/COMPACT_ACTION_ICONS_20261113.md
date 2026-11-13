# Compact original-application actions — 13 November 2026

The user requested recognisable icons instead of large record-action labels, with direct actions replacing the record-level More disclosure. The current sidebar, approved home charts, original logo, permissions and business behaviour remain in place. Form decisions and the prominent attendance action retain their readable text.

## Refreshed baseline and scope

Main and production both identified `7d76c00b5b40f4e935b589e1d679567df47fdc3e`; Railway deployment `c68933e4-de72-4cd6-8af5-b61615a909c6` was successful. The invoice-email company signature added immediately beforehand is preserved. No provider, scheduling, sender, database or native signing configuration is changed by this release. Banking and the separate added ERP portal remain retired.

The shared icon registry and stylesheet serve every retained page through `globalBrandRenderer`. Explicit semantic attributes cover commercial, inventory, workforce, staff, workflow, client, procurement, quality, expense and shop-floor record actions. The shared report-email control and PDF reader use the same icons. Invoice list/detail and payment-history actions are directly available; their status and permission guards, callbacks and existing confirmations are retained. Mobile quick navigation uses its existing destinations, permissions and menu drawer with compact icons. The current sidebar is excluded.

The controls retain their original DOM text, accessible names, contextual titles and listeners. Bare text is wrapped in a visually hidden label so ID-specific legacy button fonts cannot overlap the icon. There are 44px touch targets, wrapping toolbars, keyboard focus and a body-level tooltip that does not change the modal/native Back contract. Existing inline/class/attribute hiding and disabled states remain authoritative. External ARIA updates, including unread counts, are preserved. Charts, notifications, form Save/Cancel/OK controls and primary clock actions are excluded from generic compaction.

## Issue register

| Reproduction | Cause | Change and verification |
| --- | --- | --- |
| Invoice cards devote several rows to View/PDF/More and expanded actions | Full-width buttons and nested record-action disclosure | Direct semantic icon toolbar; unchanged allowed callbacks across invoice states; original MFA/confirmation entry points remain |
| Some icon buttons still paint overlapping letters | ID-specific legacy font rules outrank a generic font-size rule | Preserve the exact text inside a visually hidden label; actual browser screenshots and accessible-name/listener assertions verify it |
| Import confirmation text squeezed into a compact grid cell | Existing phone procurement grids use narrow icon tracks | Non-icon decisions span the grid; mixed toolbar test keeps the full confirmation readable |
| Tablet actions have layout bounds beyond the viewport | The retained desktop/tablet register uses a local horizontal table scroller | Limit table action groups to 194px and verify each action is reachable by focus/local scrolling, with no horizontal page overflow; phone actions fit directly |

## Evidence and release process

The before/after browser gate uses the real original invoice controller and the same two saved fixture invoices and filters. Each baseline record is measured with its own More menu expanded, because the original UI permits only one expanded menu at a time. Both themes and 320/360/390/430/768/1024/1440px are tested. Representative phone/desktop screenshots are retained. No production records or email are used.

At 390px, the fixture action area reduced from 243/292px to 106px; at 320px, from approximately 341/390px to 106px. These are fixture measurements, not customer business figures. The gate also verifies meaningful names and tooltips, 44px targets, original view/email callbacks, hidden permissions, disabled/busy states, readable import confirmation, unchanged unread badges, form values, sidebar and chart boundaries.

Local syntax and UTC/Australia-Melbourne builds cover 470 JavaScript files and 99 regression scripts. The procurement browser fixture loads the actual shared icon assets and retains its import/edit/archive/report assertions. Fresh CI additionally runs the established role, document, staff, MySQL, security, chart/sidebar, Chromium/WebKit and installed-emulator gates. Before/after icon evidence is uploaded as `compact-actions-<source SHA>`.

After the exact candidate and merged-main gates pass, use the existing separate marker-only `.railway-release` workflow. Observe terminal Railway SUCCESS, verify the actual live SHA and asset bytes, and retain the previous healthy deployment. Record final PR/source/marker/deployment/live evidence in the PR handoff. No publication or private recipient/native-device verification is implied by local fixtures.
