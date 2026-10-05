# Verification record

Implementation checked in the development Linux environment on 5 October 2026.

- 47 automated tests pass: 19 booking-domain tests, 16 security/configuration/backup tests, 9 HTTP integration tests and 3 business-content upgrade/contact tests.
- Checks include concurrent final-room allocation, whole room-night boundaries, shared-person and vehicle conflicts, travel buffers, expired holds and driver offers, stale quote acceptance, pending/verified/voided payments, refund limits, quote snapshots, guest links and rotation, taxi acceptance and reassignment, staff access restrictions, TOTP replay prevention, CSRF and backup restoration.
- Public and admin templates render through the Flask test client. Both JavaScript files pass Node syntax checks; shell scripts pass Bash syntax checks.
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
