# Scope, decisions and remaining inputs

Baseline: **Mestia Travel and Guesthouse Web App**, dated 5 October 2026, supplied by the owner. Subsequent instruction: implement the application in `aliahmed7866/Mestia_tour_agency` and make it deployable on Termux.

## Confirmed direction

- One local business offering tours, a guesthouse and taxis through one central WhatsApp number.
- A request → quote → confirm model, manual deposits and manual dispatch initially.
- Separate enquiry, quote, booking, assignment and payment records.
- Shared resources, expiring holds, transaction-protected confirmation and historical quote snapshots.
- English and Georgian public content, a phone-friendly owner workspace, real content rather than fabricated inventory.
- Partner/provider records now; a public marketplace and partner accounts later.

## Implementation decisions

| Decision | Reason and consequence |
| --- | --- |
| Python 3.11+, Flask, SQLite and Waitress | A small modular application that can run under Termux without a Node build or database service. SQLite suits one small operator; growth may require a server database and migration. |
| Server-rendered pages and lightweight assets | Keep phone downloads and build tooling small; forms work without a large client application. |
| Private local host by default | The owner can test on the phone immediately. Public deployment needs their own HTTPS proxy/tunnel and operations setup. |
| Manual communications and payment verification | Avoid presenting unimplemented WhatsApp or payment integrations as working automation. |
| Private tours initially | A tour reserves its guide exclusively. Shared departures with separately sold seats need a dedicated later workflow. |
| Supplied service catalogue | The owner supplied five card services and the Riverside Svaneti guesthouse profile on 5 October 2026. These are enquiry-only listings with no invented prices, inventory or availability. “Mestia Travel” remains a provisional umbrella name. |
| Owner and dispatcher staff roles | Individual access for the current operation without implementing the full future partner marketplace. |
| Password-only staff login for now | Requested by the owner on 5 October 2026. Authenticator enrollment remains available through `MESTIA_REQUIRE_TOTP=1`; passwords, role checks, CSRF protection and throttling remain required. |

These are reversible implementation choices, not confirmation of business facts.

## Owner inputs before launch

Confirm the business name, contact details and central WhatsApp number; actual inventory and capacity; approved photos; guide/driver/vehicle availability and travel buffers; rates and currency; deposit/cancellation/refund terms and policy version; operating hours and backup dispatcher; final Georgian translations; privacy and data-retention rules; and the intended public hosting arrangement.

Confirm that private tours are sufficient for the pilot. Shared group departures are a scope gap against the brief's full capacity-management goal and need a dedicated workflow before selling independent seats. Decide who handles backups, account recovery, enquiries and updates while the owner is guiding.

## Pilot limits and deferred work

The repository does not establish business terms or legal liability. Online card payments, provider webhook processing, automatic messaging, WhatsApp chat synchronization, guesthouse channel-manager synchronization, live taxi tracking, partner logins, public partner registration, payouts and marketplace commissions remain separate work.

Admin reminder tasks require a person to send a message. Backup archives include database and photos and require the server to be stopped briefly; a scheduler, protected off-device storage, monitoring, public HTTPS and a domain need deployment configuration. Android device behavior must be verified on the intended phone. A general migration system, formal accessibility audit, reviewed translations and a supervised operational pilot remain launch preparation.

Use real owner-approved content and complete representative bookings, conflicts, cancellations and restore drills before treating this as the business's live operating system.

## Owner update on 5 October 2026

The owner chose port **8095** after finding port 8000 occupied. Existing installations change their saved configuration with `bash scripts/set-port.sh 8095`.

The supplied card lists Private Transfers, Mountain Tours, City Trips, Airport Pickup and 4x4 Off-Road Adventures. Its QR decodes to `https://wa.me/qr/DWVZTCF73QY5L1`. The visible printed digits are 593282478; the country prefix is covered, so the application uses the exact QR destination rather than inferring a full phone number.

The supplied Instagram link and screenshot identify **Riverside Svaneti Guest House**, profile `https://www.instagram.com/riverside_svaneti/`. The screenshot describes river and mountain views, camps/events, breakfast and dinner, and free pickup from Mestia. Rooms, occupancy, rates, meal inclusions and pickup timing still need to be agreed by the host. The owner subsequently supplied the guide's profile, `https://www.instagram.com/guledaniakaki/`. No Instagram photos were copied or scraped.

The owner also requested SVG mountain artwork and destination image placeholders that become a slideshow. Illustrated placeholders are clearly distinguished from real destination photography; the owner can replace them with approved images in Admin Settings.

This content update is transactional and runs once, preserving existing nonempty settings, matching owner-created services, and later operator edits. It creates no rooms, vehicles, drivers, prices or bookings.

## Researched offering catalogue · 5 October 2026

The owner requested research-informed presets using TravelMestia and Budget Georgia for reference. Seventeen original route proposals were prepared, ten centered on Svaneti. The [research record](offering-research.md) distinguishes source facts, planning estimates and unresolved local delivery decisions. Presets start as drafts with no invented prices, group limits or resource inventory, matching the brief's requirement for guide review before publication.

Offering fields are stored as editable service data, including bilingual itinerary/season/logistics, private operator notes and dated source URLs. Month filters are discovery aids, not availability rules. New columns are added in place to existing SQLite installations. A once-only seed marker prevents future restarts from overriding changes or recreating removed offers.

Catalogue deletion is a reversible soft deletion: the offering leaves the public catalogue and new-selection lists while linked enquiry, quote and allocation history survives. Existing agreements retain their snapshots. Restoring a deleted service makes it a draft. Owners control these actions; dispatchers retain operational access without catalogue mutation rights.
