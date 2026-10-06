# Discovery and booking UX review

Reviewed 5 October 2026 against the supplied Mestia Travel project brief. This
is a source-informed design review, not a usability study with this company's
guests. Conversion improvements have not yet been measured.


## Refinement on 6 October 2026

Following owner feedback, free-text visitor search was removed. The homepage
now has one three-trip selection rather than two overlapping trip sections.
Filters sit behind one optional disclosure, retain active selections and only
show choices from the current service category. The destination slideshow and
owner-managed images remain. These refinements supersede the initial search
and separate illustrated-choice implementation described below.

Stay-offer context persists when changing trips, clearing filters and following
listing redirects. A changed offer requires the guest to review its new rate
and terms before resubmitting. Quote item types follow linked catalogue records,
and excluded extras should use separate lines without a catalogue reference.

## Findings applied

| Evidence | Change in this app | Intended benefit |
| --- | --- | --- |
| [Baymard's travel research](https://baymard.com/research-articles/travel-site-ux-best-practices) identifies missing tour information and useful filters as obstacles to choosing. | Destination/experience search, an effort filter alongside duration/activity/season, larger card facts and readable detail copy. | Guests can narrow the catalogue before opening every route. Search includes only published, non-deleted offerings. |
| [NN/g: recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/) explains why visible choices are easier than remembering what to ask for. | Three illustrated starting points: Ushguli village day, Koruldi by 4×4, and Chalaadi forest walk. Selected activities remain attached to requests. | Replace a blank planning problem with concrete routes. These links use current listing names and photographs; disabled or deleted trips disappear from the choices. |
| [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping secondary decisions out of the main task. | Stay add-on lives in an optional disclosure; its date fields become required only when selected. Additional catalogue filters remain expandable. | Keep a tour-only request short, while supporting a combined request without starting again. |
| [TravelMestia's day-trip catalogue](https://www.travelmestia.com/one-day-tours) names destinations and presents practical trip facts beside individual offerings. | Destination-led choice cards and prominent duration, effort and season facts. | Let visitors recognise the trip and assess whether it suits them. Competitor prices, reviews, availability and photographs were not copied. |
| [Budget Georgia](https://www.budget-georgia.com/) separates day tours, multi-day journeys and transfers by starting place. | Preserve distinct tours, stays and transfers, with regional and duration filters rather than a single generic contact funnel. | Different travel needs stay easy to locate. Its large operator menu is not reproduced for this smaller catalogue. |
| [W3C's carousel guidance](https://www.w3.org/WAI/tutorials/carousels/) calls for pause controls, keyboard operation and clear state changes. | Retain the existing pausable, keyboard-operated slideshow. New visual treatments need no autoplay, external library or remote font; hover effects honour reduced-motion settings. | Add atmosphere without making motion essential to understanding or booking. |
| [NN/g: trustworthy design](https://www.nngroup.com/articles/trustworthy-design/) describes the value of disclosure, content quality and links to outside evidence. | Keep price-on-request honest, preserve guide/guesthouse profile links, label illustrations, and explain the offer exclusions beside its CTA. | Avoid fabricated ratings, scarcity, savings baselines or destination photographs. |

The brief's priorities remain intact: mobile-first controls, an owner-approved
quote before confirmation, separate room/tour/transport prices, retained booking
history and lightweight pages suitable for phone connections.

## Stay & explore offer

The requested starting rate is **10% off the eligible tour service** when the
same guests book Riverside Svaneti and an owner-operated tour together. The
tour must fall within the stay dates. Rooms, transfers, meals, entrance tickets
and third-party extras are excluded and must be quoted separately. This is an
operator-set promotion, not a research-derived claim about profitability.

The owner can change the rate, edit public terms or disable new requests in
**Admin → Settings → Stay & explore offer**. Core eligibility is enforced in
code and described in that editor. The public offer disappears if the matching
Riverside listing is unpublished or deleted.

A request records the server's rate, terms and stay dates at submission. It
does not reserve inventory. The original offer remains visible on the guest's
private status page even if settings later change. In the quote editor, the
requested tour and stay are suggested as separate lines. Enter undiscounted
tour-service prices and use the preselected offer checkbox; the server checks
the linked catalogue items and dates and applies the saved percentage. Prices
round to the nearest currency minor unit per unit, using half-up rounding.
The quote records the original unit price, saving and offer terms. Room and
transfer lines retain their original prices. Accepted quotes are never
recalculated from current settings.

If a stay cannot be supplied, staff can uncheck the offer and communicate a
revised quote. If an accepted booking changes, use the existing revision and
cancellation process; changing the promotion settings does not amend it.

## Pilot checks

Ask guests to find a suitable trip, compare effort and season, submit a request,
and explain when the booking becomes confirmed. Try both tour-only and
stay-plus-tour flows. Check readability, keyboard placement and horizontal
overflow on real Android devices, including a narrow screen and Georgian mode.

Compare qualified requests, confirmed bookings, request-to-quote time and
combined-stay uptake with the pre-change baseline. Review actual discount
cost and service margins before expanding the offer. No analytics scripts or
third-party tracking were added. Actual destination and guesthouse photography
remains an owner-content task; supplied placeholders stay visibly labelled.
