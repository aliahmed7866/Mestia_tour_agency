# Recent-change refinement — 1 November 2026

Baseline: GitHub main `dbe94f1`, including owner-login PR #11 and display-preferences PR #12. Scope: the active `sites-app` implementation. Existing catalogue data, agreed prices, inventory settings and production authentication flags are unchanged.

## Changes

- Preserve the existing Sites and Cloudflare Access owner flows until native login is explicitly enabled. Offer password setup as an optional owner action after the migration and secret exist; missing optional tables no longer strand the owner at a setup form.
- Add native sign-out, bounded client requests, retryable session checks, duplicate-submit protection, clear errors, appropriate input autocomplete and keyboard focus. Refine the sign-in layout to match the forest/cream site design.
- Enforce Access after rollback, bind sessions/challenges to the configured owner, restrict setup to the saved owner, limit code sends across IP addresses and clear challenges when email delivery fails or times out.
- Give language/currency controls their own row on small screens with 44px tap targets; keep the WhatsApp shortcut above the selected-trip dock.
- Preserve language/currency preferences without writing defaults before stored values load. Label the partial Georgian translation explicitly and identify translated fragments for screen readers, keeping English booking copy correctly marked.
- Fetch indicative rates through a same-origin endpoint using the [National Bank of Georgia JSON feed](https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json). Invert GEL-per-quantity quotes correctly, reject invalid, incomplete, future or more-than-seven-day-old rates, cache successful responses for one hour and bound upstream requests to eight seconds.
- Show the rate date, approximate foreign prices and original GEL amount together. Keep GEL decimal precision. Show an explicit GEL fallback and retry action when conversion fails. Quotes and payment records remain in GEL.
- Add standalone Cloudflare build validation to the hosted-app CI workflow.

## Verification

- 78 existing hosted-app tests passed before changes.
- 100 hosted-app tests passed after refinement, including 22 new auth, client-error and rate/preference regressions. Existing room-night, concurrent confirmation, shared tour capacity, private-guide conflicts, cancellations, taxi reassignment and quote acceptance checks remain passing.
- 27 browser-only Pages model/catalogue tests passed.
- All 244 Flask/Termux tests passed (JUnit report: zero failures, errors or skips).
- TypeScript check passed.
- Standard Sites and standalone Cloudflare production builds passed.
- PBKDF2 with 310,000 iterations succeeded in the installed local Worker runtime using its supported 2026-05-15 compatibility date. The installed runtime predates the project's 2026-10-01 date, so this is a crypto compatibility probe, not full production runtime validation.

## Limits and follow-through

Browser QA could not run: the managed preview daemon mailbox is missing. Responsive layout, persistent preferences across reload, keyboard/modal flows, and actual email delivery/sign-in must still be checked in a real browser. Automated auth tests mock the email provider and never send messages. The existing staged rollout remains in place; no secrets, Access policies, live data or production deployment have been changed.

Owner-approved Georgian catalogue/forms/terms remain unfinished. Currency estimates are for comparison, not card charges or agreed booking totals. Existing gaps such as automatic Booking.com synchronisation and verified backup restoration are not introduced by or completed in this refinement.
