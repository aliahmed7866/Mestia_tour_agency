# Verification record

Implementation checked in the development Linux environment on 5 October 2026.

- 83 automated tests pass: 19 booking-domain tests, 24 security/configuration/backup tests, 13 HTTP integration tests, 7 business-content upgrade/contact tests, 17 catalogue lifecycle/editing tests and 3 researched-preset preservation tests.
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

The port/contact update was also smoke-tested with Waitress actually serving on `127.0.0.1:8095`: the health endpoint responded, and the homepage contained the exact WhatsApp QR destination and Riverside Svaneti Instagram URL. The temporary server was then stopped. Existing configuration/content preservation and rejection of an occupied port are covered by automated tests. This does not establish that port 8095 is free on the user’s phone; the configuration command checks it there.

The destination/authentication update additionally checks password-only sign-in for enrolled and unenrolled users, opt-in authenticator enrollment and replay protection, invalidation of password-only sessions when TOTP is required again, and once-only guide-profile migration without overwriting owner edits. HTTP tests exercise photo upload, persistence across settings saves, SVG-upload rejection, escaped captions and restoration of illustration placeholders.

Three original SVG scenes were parsed, rasterized and visually reviewed. Slideshow controls passed a deterministic DOM/timer harness for automatic advance, manual navigation, dots, keyboard controls, pause/resume, hover/focus/tab visibility handling, reduced-motion preferences and hidden-slide focus protection. This harness is not a real browser/device layout test.

The researched-catalogue update adds 17 unpriced, unpublished drafts. Tests cover additive migration from a legacy catalogue, preserved owner edits and slug collisions, no seed-created inventory, complete field editing, validation error recovery, image removal, publication/disable/delete/restore, history preservation, deleted-service rejection for new enquiries/quotes, source-note privacy, filters and owner-only preview access. The new-offering page and every researched preview render in both language modes. All 23 current offerings also passed editor, preview and public-page rendering checks in an isolated database.
