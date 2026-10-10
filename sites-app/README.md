# Mestia Travel — private pilot

A Sites-hosted implementation from the 5 October 2026 Mestia Travel Project Brief and the agreed catalogue-first, combined-request direction. This source is also maintained under `sites-app/` in [Mestia_tour_agency](https://github.com/aliahmed7866/Mestia_tour_agency), alongside the Flask/Termux app and browser-only Pages demo. Each has its own runtime and data store. The hosted app remains an owner-private pilot.

## Using the pilot

1. Open `/admin`, sign in through ChatGPT, and select **Set up owner access**. The initial claim relies on the Site's owner-only hosting policy. Initialise before sharing or making the site public. All subsequent admin operations require this saved, site-specific owner identity.
2. In **Settings**, confirm the business name, central WhatsApp number (country code, digits only), operating hours, privacy text, cancellation policy and policy version. WhatsApp remains disabled until a real number is entered. The proposed 10% stay-plus-tour saving is off by default; enable only if agreed. It discounts tour amounts only.
3. Edit the proposed catalogue or add real services. Mark proposals as confirmed only after checking routes, capacity, inclusions and seasonal conditions. The starter catalogue has no asserted prices, inventory, credentials or reviews.
4. Add real rooms, guides, approved drivers and vehicles under **Resources**. Room capacity is occupants; a room is reserved as one physical unit for each night, with checkout night free. Each named guide, driver and vehicle can do one job at a time. Jobs use conservative 15-minute slots and their travel buffers.
   In **Inventory**, set the maximum simultaneous tours (1–20; initially 1), then add dated tour departures with their total places (1–50), start/finish times, guide and optional vehicle. Each departure reserves its guide, vehicle and one simultaneous-tour slot once; separate guest bookings share its places. The catalogue's maximum people per booking is separate from the departure's total places. Vehicle passenger capacity also limits places. Copy a departure to create another date quickly.
5. Save traveller requests through the site; enter phone/WhatsApp enquiries manually into the same queue. Every request gets a random secure link. The token remains in the URL fragment and is sent in a JSON body, rather than public URL query strings. Links expire after 180 days.
6. Quote every requested service with an explicit GEL amount, local scheduled interval, assigned resources, expiry, deposit requirement and written inclusions/cancellation terms. All local schedules use `+04:00` (Asia/Tbilisi); room intervals represent check-in and checkout dates.
7. Copy the secure link and share it with the guest through your normal contact channel. The guest must review and accept this exact quote and policy version. A revised quote needs fresh acceptance. No messages are sent automatically.
8. Record a two-way contact exchange with evidence. Record settled deposits/payments using a receipt reference only after checking funds. Screenshots, phone input and quote acceptance do not verify funds or guarantee attendance.
9. For taxis, offer a suitable driver and vehicle, then record the driver's acceptance with evidence. Offers expire after 30 minutes; an expired offer must be sent again. Guest fare acceptance is required before recording driver acceptance. Replacing a quote resets taxi dispatch, so the driver must accept the revised fare and schedule too.
10. Confirm. One D1 transaction locks the request revision and reserves all requested room nights, private guide/driver/vehicle slots and scheduled-tour seats. Private tours also count against the simultaneous-tour limit. A conflicting or concurrent confirmation fails without partially reserving the trip. Requests and quotes do not reserve seats; Inventory shows requested places separately from confirmed and free places.
11. To reassign a confirmed taxi, offer a replacement. The taxi becomes pending transport reconfirmation, while the other confirmed services retain their inventory. Recording replacement acceptance checks and swaps only the taxi inventory atomically, including conflicts with another service in the same package. Earlier completed tours do not prevent a later taxi reassignment. The fare and accepted terms remain fixed.
12. Cancel through the owner panel to release booking inventory, including scheduled-tour seats. In Inventory, **Closed** pauses new requests while retaining the guide, vehicle and tour slot; **Cancelled** releases the departure's schedule only when no guests remain confirmed. Capacity cannot fall below confirmed places, and a departure's tour, times, guide and vehicle cannot change while guests are confirmed. The simultaneous limit cannot fall below existing overlapping commitments. Record refunds separately according to the accepted policy. Guest changes/cancellations are review requests; they never silently change the reservation. Complete a booking only after all services have ended; completed departure headcounts remain visible.
13. Export the owner JSON regularly and keep it in a secure location; it includes guest details and secure tokens. This export is a manual copy, not a verified automated backup. A restoration process must be implemented and tested before real launch.

## What is implemented

- Responsive public catalogue, service details, FAQs and combined request form; no free-text catalogue search.
- D1-persisted requests, catalogue, settings, resources, resource blocks and audit histories.
- Server-side owner authorisation and same-origin write checks, bounded validation, honeypot, rate limiting and retry-safe request creation.
- Separate enquiry, quote acceptance, booking, dispatch and recorded-payment states.
- Quote snapshots, expiry, manual payments/refunds, resource conflict checks, taxi reassignment and owner JSON export.
- Dated shared tour departures, per-date seats, simultaneous-tour limits, guide/vehicle scheduling and safe capacity editing. Existing confirmed private tours are included when enforcing new tour limits.
- Secure guest status, acceptance and change-request page.

## Before public launch

Confirm real catalogue, policies, room/vehicle inventory, contact details and approved photography. Replace the artistic landscape with approved imagery where appropriate. Provide owner-validated Georgian translations, stronger admin account protection, staff roles, a data retention/deletion process, monitoring, and tested database backups/restoration. Test in real phone browsers and with keyboard/screen-reader use. This build has automated workflow/SQL checks; browser visual QA was unavailable in the managed environment.

There are no online payments, synchronised WhatsApp inbox, automated messages, channel-manager integration, temporary inventory holds, public partner accounts or automatic driver matching. Owner task prompts support manual operations. Hosting remains private; changing the audience requires an explicit action after setup.

## Development

Preserve the Sites/Vinext build integration. Install dependencies through the Sites helper. Use Node 24 for the native SQLite test harness. Run `node node_modules/typescript/bin/tsc --noEmit` and `node --test tests/*.test.mjs`. `app/lib/domain.ts` and `app/lib/tour-domain.ts` own validation and booking rules; `app/lib/server.ts` and `app/lib/inventory-server.ts` own authorised D1 operations; UI components call JSON routes. `db/schema.ts` and the generated `drizzle/` migrations are versioned. D1 batch operations are transactional, with database constraints protecting revisions and resource units. Never modify applied migrations.

Source is synced to the Site repository by the Sites publication workflow. Keep credentials and local runtime files out of version control.
