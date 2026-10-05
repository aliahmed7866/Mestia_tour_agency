# Request catalogue launch

The catalogue now opens eight researched Svaneti day outings to booking requests:

- Mestia culture and museum walk
- Hatsvali–Zuruldi lift and short walk
- Chalaadi forest and glacier viewpoint walk
- Koruldi Lakes full-day hike
- Koruldi Lakes by 4×4
- Ushguli village day from Mestia
- Mazeri and Shdugra lower waterfall viewpoint
- Heshkili viewpoint and village

These are route proposals with a stated season, pace, itinerary and conditions.
A guest chooses a route and submits dates and group details. The request does
not confirm a departure or reserve a guide, vehicle or other resource. The
operator still checks the route, conditions, guide or driver, guest suitability
and price before sending a quote. No prices, seats, guides, vehicles, lift hours
or availability have been invented. Existing weather and safety conditions in
each route remain in force.

The other eleven researched proposals remain drafts, including overnight and
multi-day packages, winter partner services and the broader Georgia routes.
The owner can review, amend and publish those separately.

## Existing installations

The launch runs once, marked by the private setting
`_request_catalogue_launch_20261005_v1`. A route is activated only if its complete
record still matches its original seed, its creation and update timestamps match,
and it has no service audit history. A changed title, translation, price, image,
season, provider or any other field prevents automatic activation. Previously
published, deliberately disabled, archived and deleted routes are preserved.
Ambiguous duplicate preset keys are left alone.

After the marker exists, restarts do not republish routes or restore deleted
records. The normal admin Publish, Disable, Delete and Restore actions remain
the authority over the catalogue. Restoring a deleted service still returns it
as a draft. No bulk re-publication is performed on future updates.

The original research and sources are in [offering-research.md](offering-research.md)
and [short-break-research.md](short-break-research.md). Operator notes and research
source fields remain private in the admin.
