# GitHub Pages interactive sandbox

The Pages site is a public, English-language demonstration, separate from the
production Flask/SQLite app. It uses fictional prices and resources. Requests,
quotes and edits are stored only in the current browser. Never enter real guest
information. Reset demo removes the sandbox state.

## Build and preview

```
python scripts/build-pages-demo.py
python -m http.server 8096 --directory _pages_site
```

Open http://127.0.0.1:8096. The builder creates an isolated temporary database,
reads an explicit allowlist of fresh seeded catalogue fields, and copies only
static demo files and illustrations. It never exports the operator's database,
settings, uploads, secrets, booking links or customer records. Production
files and Termux port 8095 are unaffected.

## Publishing

The `GitHub Pages demo` workflow builds `_pages_site`, runs the sandbox model
tests and uploads only that directory to Pages. Deployment uses GitHub Actions.
If automatic enablement is denied by GitHub, an owner must choose **Settings →
Pages → Build and deployment → Source → GitHub Actions**, then rerun the workflow.
Expected project URL: https://aliahmed7866.github.io/Mestia_tour_agency/

## Demonstrated flows

Catalogue browsing and seasonal filtering; researched itineraries; editable
WhatsApp message draft; stay-and-tour request; saved offer and quote terms;
admin catalogue editing, publication, disabling, deletion and restoration;
request review; quote creation, expiry and guest acceptance; sample resource
conflicts and date blocks; deposit/refund recording and verification; driver
acceptance; confirmation, cancellation, completion and no-show outcomes; guest
messages; provider approval; reminders; business settings; history and CSV export.

The sandbox models whole-date, single-resource-per-item conflicts. The live app's
exact-time inventory, room occupancy, seat capacity, multiple resources, travel
buffers and secure permissions remain server functions. The feature guide in
the demo explains these limitations, along with authentication, private links,
backups, media validation and notifications. Browser history and local data are
editable and are not secure audit records. No messages, payments or reservations
are transmitted. Sample quotes with recorded payments cannot be replaced in the
sandbox; start another sample request for that scenario.

## Validation

`node --test pages-demo/*.test.cjs` checks confirmation gates, deposits,
conflicts, cancellation release, discount snapshots, expiry, driver acceptance
and invalid inputs. Catalogue regressions cover URL-backed filters, browser
history restoration, empty-result recovery and escaping. Filter selections
survive opening a trip and returning with Back, or reloading the filtered URL.
Months use readable names; clearing filters keeps the selected category. DOM checks exercised every main route, a complete guest to
admin confirmation and archived listings; CSS and JavaScript syntax checks
passed. Real browser visual verification remains outstanding in this environment.

