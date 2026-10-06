# Verification record

Implementation checked in the development Linux environment on 5 October 2026.

- 215 automated tests pass, covering booking operations, security, backup restoration, content upgrades, catalogue lifecycle, short booking requests, cloud configuration and public SEO.
- Checks include concurrent final-room allocation, whole room-night boundaries, shared-person and vehicle conflicts, travel buffers, expired holds and driver offers, stale quote acceptance, pending/verified/voided payments, refund limits, quote snapshots, guest links and rotation, taxi acceptance and reassignment, staff access restrictions, TOTP replay prevention, CSRF and backup restoration.
- Public and admin templates render through the Flask test client. All three JavaScript files pass Node syntax checks; shell scripts pass Bash syntax checks.
- An isolated Linux setup smoke test confirmed random secret creation, restrictive file permissions, setup rerun data preservation and ZIP backup creation.
- MarkupSafe's source package built successfully without a C compiler, using its pure-Python fallback. The tzdata dependency provides timezone information if Android's system database is not found.

Not verified: actual execution on an Android/Termux device, public DNS/HTTPS deployment, a real bank transaction or message integration, owner-approved Georgian translations, and live traveller operations. Browser screenshot testing was attempted but the available Chromium binaries could not launch in this execution environment; phone-browser layout and keyboard checks remain part of the device pilot.

Run the automated suite after changes:

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
bash scripts/test.sh
```

The repository includes GitHub Actions test configuration. A local test result is not a claim that hosted CI or a deployment has succeeded.

The catalogue-first update activates eight untouched Svaneti outings once and
retains eleven researched drafts. Tests check whole-record preservation, owner
disable/delete decisions, the selected activity through form errors and request
submission, and absence of accidental bookings or inventory holds. Activity
WhatsApp tests decode the exact title and trusted public link from the message;
QR-only contact uses an editable copy/paste fallback. FAQ tests cover its public
route, canonical URL, sitemap and catalogue-before-custom-contact order. jsdom
checks cover selected tour/stay/transfer payloads and clipboard success, denial
and manual-copy fallback. These checks do not send messages or establish that
WhatsApp is installed on a guest's device.

The port/contact update was also smoke-tested with Waitress actually serving on `127.0.0.1:8095`: the health endpoint responded, and the homepage contained the exact WhatsApp QR destination and Riverside Svaneti Instagram URL. The temporary server was then stopped. Existing configuration/content preservation and rejection of an occupied port are covered by automated tests. This does not establish that port 8095 is free on the user’s phone; the configuration command checks it there.

The destination/authentication update additionally checks password-only sign-in for enrolled and unenrolled users, opt-in authenticator enrollment and replay protection, invalidation of password-only sessions when TOTP is required again, and once-only guide-profile migration without overwriting owner edits. HTTP tests exercise photo upload, persistence across settings saves, SVG-upload rejection, escaped captions and restoration of illustration placeholders.

Three original SVG scenes were parsed, rasterized and visually reviewed. Slideshow controls passed a deterministic DOM/timer harness for automatic advance, manual navigation, dots, keyboard controls, pause/resume, hover/focus/tab visibility handling, reduced-motion preferences and hidden-slide focus protection. This harness is not a real browser/device layout test.

The researched-catalogue update adds 17 unpriced, unpublished drafts. Tests cover additive migration from a legacy catalogue, preserved owner edits and slug collisions, no seed-created inventory, complete field editing, validation error recovery, image removal, publication/disable/delete/restore, history preservation, deleted-service rejection for new enquiries/quotes, source-note privacy, filters and owner-only preview access. The new-offering page and every researched preview render in both language modes. All 23 current offerings also passed editor, preview and public-page rendering checks in an isolated database.

The shorter-enquiry update adds date-only preferences without turning them into a booking schedule. Tests cover local calendar boundaries, optional taxi times, service preselection and kind matching, duplicate submissions, consent/CSRF/spam controls, preserved legacy enquiries, explicit quote scheduling at both HTTP and domain boundaries, and exports using the agreed quote schedule. The two new short-break drafts install as a separate once-only batch; tests verify that previous edits, prices, publication and deletions stay untouched.

The enquiry JavaScript passed 108 jsdom assertions against Flask-rendered forms: all four modes with and without JavaScript, relevant trip choices, retained input, disabled-field submission, selected-trip summaries, stay date boundaries and the mobile menu. This temporary verification tool adds no runtime dependency and does not substitute for an Android browser layout check.

The discovery redesign rendered all 25 saved offerings in staff preview in English and Georgian, 50 public detail pages after isolated publication, and 12 homepage/catalogue combinations. All 11 referenced local static assets returned HTTP 200. Draft previews do not expose a selected-service enquiry action, and operator notes and research sources remain private.

The SEO and hosting preparation checks unique public metadata, configured-origin canonicals under hostile Host headers, stable language URLs, legacy/renamed-slug redirects, sitemap publication/deletion behavior, private/error noindex responses, safe JSON-LD serialization and CSP nonces, cookie-free cached assets and disabled indexing before configuration. Cloud checks cover WAL/DELETE validation, unchanged owner configuration and secrets on setup reruns, portable backup/restore of records and media, and the secure WSGI entry point. The social preview illustration was rasterized to a 1200×630 PNG and visually checked. These results do not establish that a hosting account, domain, DNS, Search Console property or live deployment exists; those remain account-owner steps.

The discovery/offer update adds checks for server-controlled promotion rates,
invalid or unavailable stays, tour/stay date matching, partner exclusion,
per-unit minor-currency rounding, unchanged room/transfer prices, saved quote
immutability and owner promotion controls. Search and effort filters remain
public-only and noindex; quick homepage choices follow current owner content
and publication. DOM checks passed for optional stay controls, dates crossing
month boundaries, form payloads, retained selections and bundle navigation.
A real Chromium render was attempted again, but the process exited with SIGTRAP
before opening a page; no browser screenshot or Android visual verification is
claimed for this update.

Review on 6 October 2026: removed visitor free-text search and duplicate trip
sections; filters are optional, category-scoped and stack in one column on
narrow screens. Checks cover legacy search redirects, bundle context through
navigation, stale promotion review, quote types derived from linked catalogue
items, booking-unavailable guidance, malformed snapshots and long Georgian
offer terms. The suite continues to cover inventory conflicts, quote/payment
boundaries, CSRF, role restrictions, backup restoration and SEO. Phone-browser
visual verification remains outstanding; no new screenshot verification is
claimed.
