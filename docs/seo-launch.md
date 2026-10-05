# Search launch and ongoing maintenance

This guide prepares the existing website for search. A configured domain, a deployed server and search-engine indexing are separate steps. Nothing here registers a domain, creates a hosting account or guarantees rankings.

## 1. Choose the public address

Choose one HTTPS origin: either the apex domain or its `www` version. Check the domain's first-year **and renewal** price, availability and any similar business names before purchasing. Follow the chosen host's DNS instructions and wait for its TLS certificate to be valid. Redirect the other hostname to the preferred one through the host or DNS provider's supported redirect service.

Set the deployment environment to your actual address. `example.com` below is a placeholder:

```dotenv
MESTIA_PUBLIC_URL=https://example.com
MESTIA_INDEXING_ENABLED=0
MESTIA_SECURE_COOKIES=1
```

Use the same origin for canonical tags, social metadata, structured data and the sitemap. Do not point these at a domain before it serves this application. On Termux, keep local HTTP development separate from public HTTPS deployment; enable proxy trust only for a deliberately configured trusted proxy. Keep `.env` and the database private.

## 2. Complete the business and trip information

In **Admin → Settings**, check the actual business name, WhatsApp contact, public email, guesthouse and guide Instagram links, accurate location/contact information, privacy notice and booking terms. Use the real service address and customer-contact hours where appropriate; do not invent an address for search visibility.

In **Admin → Services**, review each draft before publishing. Confirm the operating route, start point, season, walking effort, transport, group suitability, inclusions, exclusions and cancellation arrangements. Enter a price and its basis only when the operator can actually offer it; “price on request” is preferable to a guessed price. Disable routes that cannot currently be delivered. Unpublished and deleted offerings stay out of the public sitemap.

Add your own, or properly licensed, photos of the actual places and accommodation. Keep useful subjects visible on a phone; export compressed WebP or JPEG files, ideally a few hundred kilobytes rather than the upload limit. The illustrations are deliberately labelled as illustrations. Do not replace them with another operator's photos or mark them as actual tour photographs.

English and Georgian navigation are available. Main offering text falls back to English when its Georgian field is empty. Have complete Georgian trip descriptions reviewed before treating them as translated search pages. The `/visit-svaneti` planning article is currently an English guide, with a language notice in Georgian navigation.

## 3. Check the real deployment, then enable indexing

Open the public website on a phone and check the home page, categories, a published trip, planning guide, enquiry submission, private enquiry page and staff sign-in. Check that uploaded photographs survive a restart. Back up the database and media before accepting real bookings.

When the owner has approved the public content, set and restart:

```dotenv
MESTIA_INDEXING_ENABLED=1
```

Check `/robots.txt` and `/sitemap.xml` at the chosen HTTPS origin. The sitemap should contain only public canonical pages and published offerings. Check that each listed address returns the intended page. Open page source and verify one descriptive title, one description, the canonical address and the expected language. Changing the public origin requires a restart and a fresh check.

Enquiry forms, staff pages, private booking links and error responses must retain their `noindex` controls. Do not add them to a sitemap or link to private booking URLs in social posts. `robots.txt` is not access control: authentication and private-link checks remain in place. Do not block a page with `Disallow` while expecting a crawler to read its `noindex` response.

## 4. Connect Google Search Console

1. The domain owner opens [Google Search Console](https://search.google.com/search-console) and adds a **Domain property** for the purchased domain.
2. Add the exact verification TXT record supplied by Google in the domain's DNS dashboard. Leave existing DNS records in place. Complete verification after DNS propagation; retain the record.
3. Submit `https://your-actual-domain/sitemap.xml` in **Sitemaps**. Inspect the home page, a published trip and `/visit-svaneti` using **URL Inspection** and its live test. Request indexing for those representative pages after fixing reported problems.
4. Watch **Page indexing** for unexpected exclusions, **Performance** for actual visitor queries and **Core Web Vitals** once field data exists. An empty report on a new site is not a failure; crawling and reporting take time.

Use Google's [Rich Results Test](https://search.google.com/test/rich-results) for supported markup and the [Schema.org validator](https://validator.schema.org/) for other types. Valid structured data helps describe a page; it does not promise a rich result. Do not add review stars, supplier credentials, offers or availability that the page cannot substantiate.

## 5. Build a useful local presence

If eligible, the actual business owner should create or claim its [Google Business Profile](https://www.google.com/business/) and complete the required verification. Use the true business name, appropriate category, accurate address or service area and contact details. Do not create a fictional office or a separate listing for every itinerary. Keep the website and business profile consistent.

Link the website from the supplied guide and guesthouse Instagram profiles when their owners agree. Ask real guests for honest reviews without inventing testimonials or offering incentives. Add practical route updates and real photographs because they help guests choose, not to fill pages with repeated destination keywords.

Review seasonal route text before each operating season and after a material change. Refresh the planning guide's checked date only after actually checking its sources. Preserve existing URLs where possible; use permanent redirects when changing a public address. Keep source research and supplier notes private.

## Primary references

Checked 5 October 2026:

- [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: localized page versions](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google: noindex and crawl access](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Google: creating and submitting sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Search Console: ownership verification](https://support.google.com/webmasters/answer/9008080)
- [Google Business Profile: representation guidelines](https://support.google.com/business/answer/3038177)

Route sources and the distinction between researched drafts and actual departures are recorded in [offering-research.md](offering-research.md) and [short-break-research.md](short-break-research.md).
