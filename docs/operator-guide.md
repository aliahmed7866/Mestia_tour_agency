# Owner and dispatcher guide

## Before accepting real enquiries

Create an individual owner account with the CLI and choose a password of at least 12 characters. Staff use email and password by default; authenticator enrollment is optional through the deployment setting described in the [Termux guide](termux.md#optional-authenticator-sign-in). Store recovery access securely under the business owner's control. Do not share one login among staff. Owners manage business settings, catalogue and permissions; dispatchers receive a narrower operational role. Partner records do not create partner logins.

In the admin workspace:

1. Replace the provisional business name. Enter the real contact details, central WhatsApp number, hours and response expectations.
2. Add approved providers, then the actual rooms, guides, drivers and vehicles. Set capacities and realistic travel buffers. A driver is not automatically approved because a record exists.
3. Add real services and upload approved photography. Confirm descriptions, inclusions, occupancy, price basis, currency and translations before publishing. Blank prices mean a quote is needed, not a free service.
4. Add unavailable dates for holidays, maintenance and bookings already taken by telephone, WhatsApp or another channel. Shared guides and vehicles must use the same resource records across services.
5. Enter owner-approved booking and privacy terms, deposit rules and policy version. Public request submission is blocked until a privacy notice has been saved. Have Georgian text reviewed. This implementation does not determine your cancellation policy or the local legal requirements.
6. Make a supervised test enquiry and complete quoting, acceptance, payment recording, confirmation, cancellation and backup restoration with your own test details before public launch.

Use rooms as individual room resources for exclusive room-night inventory. Record a stay as local check-in and check-out dates in Asia/Tbilisi; departure day is not an additional occupied night. Scheduled tours and taxis use local dates and times. Tours initially reserve a guide exclusively for a private trip; do not sell independently bookable shared departure seats through this pilot. Keep realistic buffers for getting between jobs.

### Homepage destination slideshow

In Admin Settings, add approved destination photos to the three slideshow slots and edit their English and Georgian titles and captions. An empty slot displays mountain artwork as an illustration placeholder. Upload JPEG, PNG or WebP files, each no larger than 6 MB; the whole form must stay under 8 MB, so upload large photos one at a time. Use images you have permission to publish and describe the pictured destination accurately. These homepage images do not create bookable services or establish availability.

## Edit, publish or remove an offering

Go to **Services** and select **Drafts** to find the 17 researched route presets. Open **Edit** for a single offering. The groups cover the name and story, route and itinerary, season and weather alternative, meeting point, walking/driving, requirements, inclusions/exclusions, prices and photos. English and Georgian fields are independent; blank Georgian fields use English on the public page. Enter a three-letter currency and a price basis such as per group or per vehicle when supplying a rate. A blank price requests a quote. The group-size field does not create bookable inventory.

Research sources, checked date and operator notes are private. Check the proposed route against current local access, available guides/drivers and accommodation before publishing. The month checkboxes drive catalogue filtering; they neither reserve resources nor approve a departure. A four-day trek's arrival night, onward travel and weather buffer must be reflected in the final guest quote. See the [research notes](offering-research.md) for the evidence and route choices.

Use **Preview** to see a draft without making it public. **Publish** makes it visible; **Disable** returns it to draft. **Delete** requires the confirmation checkbox and removes it from the active catalogue and new selection lists. It keeps historical enquiry and quote references. In **Deleted**, use **Restore** to recover it as a draft. Neither restarting nor updating this preset pack recreates or republishes removed offers. Catalogue edits do not rewrite saved quote prices or inclusions; revise the guest's quote separately if their agreement changes.

## An enquiry is not a reservation

A website request enters the enquiry queue and gives the guest a reference and private status link. No stock is reserved merely because a request exists. Enter direct phone and WhatsApp requests in the same queue so they follow the same checks.

Review the guest's needs, verify the contact through an actual two-way conversation and record evidence. A typed phone number or opening a WhatsApp link is not verification.

Create a quote with each service item, its accepted price basis, dates, inclusions, currency, terms, policy version, required deposit and explicit expiry. Allocate the real resources needed for each item. A combined trip uses separate priced and scheduled items. Check the temporary hold before promising availability.

Share the guest's private link using your chosen communication channel. The app does not send messages for you. Guest acceptance records agreement; if staff record an acceptance received elsewhere, record the actual evidence. A changed quote needs renewed acceptance. Catalogue price changes do not change an already quoted agreement.

Record payments only after checking the actual funds, not merely a screenshot. Deposits, remaining balance and refunds are separate records. Confirm only after the guest accepted, the contact was verified, the required deposit was verified and availability passed the final check. The app checks conflicts again in a transaction. A failed confirmation requires resolving the issue before promising a reservation.

Expired quote holds release inventory. Refresh or revise the quote with a new expiry and seek fresh acceptance as needed; do not treat an expired quote as a guaranteed place.

## Taxi work

Check pickup, destination, local departure time, passengers, luggage and any special requirements. Obtain guest acceptance of the fare, then offer the job to an approved, suitable driver and vehicle. Record the driver's actual acceptance; dispatch status must not imply a message was automatically sent.

A taxi can be confirmed only after a suitable driver accepts as well as the other booking checks. If the driver declines, times out or becomes unavailable, record that outcome and reassign. If a confirmed trip loses its driver, resolve the operational warning and tell the guest; retaining a booking record does not mean transport is still secured. Mark unavailable honestly if no suitable driver can take it.

Share driver/vehicle and pickup details manually through the agreed channel. Progress a delivered job to completion and keep payment records accurate. Do not promise immediate replies or 24-hour service unless staff can support them.

## Daily work and changes

Review unanswered enquiries, expiring quotes, upcoming jobs, open guest change requests, reminders and balances due. Reminders are staff tasks; marking a task complete should mean you actually performed it. Check that WhatsApp conversations and any outside bookings have been recorded.

A guest change or cancellation request needs staff handling. Follow the accepted policy, record the decision, release inventory when cancellation is processed and record any refund separately. For a material replacement quote, release or cancel the old commitment deliberately and obtain acceptance of the new dates/price/terms before confirming again. Never silently overwrite a historical agreement.

After service, record completion, cancellation or no-show accurately. Take a daily backup and periodically rehearse restoration in a separate environment. A verified contact and accepted terms cannot guarantee attendance or automatically collect cancellation fees.

## Privacy and access

Collect only details required to run the service. Private guest links are access credentials; share them only with the relevant guest and never post them publicly. Exported booking data, database backups, authenticator secrets and uploaded guest photos need restricted access. Agree a retention/deletion procedure before launch; no automatic data-retention policy is assumed.

If a staff member leaves, disable their account promptly. If a device, password, authenticator secret or private guest link is exposed, suspend the affected access and arrange replacement through the owner before continuing operations.

### Rejected receipts and shared people

A pending receipt that never settles can be voided with an explanation; it remains in history and contributes nothing to paid totals. Verified payments require a recorded refund, not deletion. Quotes with collected money or unresolved receipts cannot be replaced: reconcile the old quote first.

A person who both guides and drives must use the same resource record for both roles. Guide and driver resource types can be used in either role, so overlapping tours and taxi work share the same availability and travel buffer. Do not create a second resource record for the same person.

Each quote supports one taxi leg. Additional legs need separate enquiries and quotes. For confirmed booking changes, record the guest request, agree the replacement, then cancel and requote with fresh acceptance; the current booking remains committed until you cancel it. There is no automatic amendment or refund.

### Supplied service card and social contacts

The website now includes the supplied card's five service categories and Riverside Svaneti Guest House. Edit or pause them in Services. These listings have no price or inventory until you configure them. For a 4x4 tour, reserve the appropriate guide/driver and vehicle for its entire route, including travel buffers.

Settings accepts either a full international WhatsApp number or the supplied QR business link. A configured number takes priority and allows guest-reference prefill. The QR destination cannot promise a prefilled message; guests are shown the reference to include manually. The guesthouse and guide Instagram profile fields are separate. Keep the guide field blank until its exact profile is confirmed.
