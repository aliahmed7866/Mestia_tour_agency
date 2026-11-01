# Svaneti Guide — SEO launch checklist

## Brand and audience
Public brand: **Svaneti Guide**. Primary destination: Svaneti, Georgia. Key searches: Svaneti tours, Mestia tours, Ushguli day trips, Koruldi Lakes, Mestia guesthouse, Svaneti private transfers. Do not claim every route is operated until an actual service is verified.

## What this change prepares
- Descriptive homepage title, description, Open Graph and Twitter metadata.
- Location-specific homepage heading and introductory copy.
- Existing owner settings displaying the old default Mestia Travel/Mestia Tours label are normalized to Svaneti Guide without changing a custom owner-entered name.
- Existing request, quote, inventory and dispatch behavior stays unchanged.

## Before indexing (required)
The Sites application is an **owner-private pilot**. Its metadata intentionally uses **noindex, nofollow**. Do not remove this until the business is publicly ready.
1. Confirm public domain and set `NEXT_PUBLIC_SITE_URL` to its HTTPS origin without trailing slash.
2. Confirm owner approval of the final business name, contact number, actual services, privacy policy, and cancellation terms.
3. Make the site publicly accessible, add a public robots.txt and sitemap.xml, then review the index/follow policy.
4. Create genuine dedicated pages for Mestia tours, Ushguli tours, Koruldi Lakes, transfers and stays with distinct helpful copy, real photos, route safety information and accurate availability.
5. Add appropriate JSON-LD Organization/WebSite and relevant service structured data **only with verified business details**. Do not invent reviews, aggregate ratings, prices, addresses, opening hours or guide qualifications.
6. Verify the site in Google Search Console and Bing Webmaster Tools, submit the sitemap and monitor indexing.
7. Keep /admin, /api, guest request tokens and private statuses out of search results. Index only public pages.
8. Add English/Georgian alternate URLs and hreflang only when equivalent translated pages exist.
9. Check Core Web Vitals, mobile readability, descriptive image alt text and real-image compression.
10. If an older public domain exists, implement permanent redirects for equivalent pages and update canonical URLs.

## Scope caveat
Metadata alone cannot guarantee search rankings. This PR is brand and SEO preparation, not a public SEO launch, and does not enable indexing.
