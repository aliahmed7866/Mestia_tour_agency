# Svaneti Guide — Cloudflare Free-first deployment

**Status: implementation scaffold, not deployed or verified.** The Sites-hosted version and Cloudflare version have **separate D1 databases**. Do not point the public domain at this deployment until end-to-end testing, owner access and backup restoration are verified.

## Architecture and cost
- Cloudflare Workers Free serves the vinext website and API.
- D1 Free holds services, booking requests, room nights, guides, drivers, taxi dispatch and reservations.
- Use existing static assets for launch; R2 is optional, not needed for initial deployment.
- Cloudflare Access protects the owner. **Do not enable a public bootstrap endpoint without Access and verified owner email.**
- Cloudflare Free has 100,000 requests/day and 10 ms CPU per request (as documented October 2026). Server rendering can exceed the CPU limit; measure real routes before committing to Free. Upgrade only if needed.

## Setup
1. Buy/attach `svanetitour.com` in your own Cloudflare account. Keep the domain off the new Worker until verified.
2. In Workers & Pages → D1 create a database named `svaneti-guide`. Replace `REPLACE_WITH_REAL_D1_DATABASE_ID` in `wrangler.jsonc` with its ID. The ID is not a secret.
3. With Node >=22.13 and pnpm 11, run `pnpm install --frozen-lockfile` from `sites-app`.
4. Apply the existing SQL schemas **once**, in order:
   ```sh
   pnpm exec wrangler d1 execute svaneti-guide --remote --file=drizzle/0000_tricky_sage.sql
   pnpm exec wrangler d1 execute svaneti-guide --remote --file=drizzle/0001_equal_stark_industries.sql
   ```
   Back up D1 before future migrations. Do not reapply blindly.
5. In Cloudflare Zero Trust → Access → Applications, create a self-hosted application for the domain, protecting **/admin*** and **/api/admin*** with an allow policy for your specific email. Include `/api/admin/bootstrap` and `/api/admin/export`. Use the same Access application AUD tag. Configure your login method and test on a private preview first.
6. Set these **Worker secrets** in the Cloudflare dashboard (or via `pnpm exec wrangler secret put NAME`, targeting the deployed Worker):
   - `ACCESS_TEAM_DOMAIN`: the exact team hostname such as `yourteam.cloudflareaccess.com`, no protocol.
   - `ACCESS_AUD`: the Access application's application audience (AUD) tag.
   - `ADMIN_EMAIL`: the single owner email permitted to administer the business.
   Do not commit personal addresses, tokens, account IDs or JWTs. The server verifies Access JWT signature, issuer, audience, expiry and owner email; a spoofed identity header is not accepted on the Cloudflare deployment.
7. Build and deploy from `sites-app`: `node scripts/deploy-cloudflare.mjs`. If secrets were not already set, deploy first then configure them **before any admin login**. The owner API fails closed without them.
8. Set `NEXT_PUBLIC_SITE_URL=https://svanetitour.com` for canonical metadata when enabling public launch. Do not enable indexing until real services, policies, domain and SEO are reviewed.
9. Verify public requests, quotes, quote acceptance, manual contact/deposit evidence, room/tour resource conflicts, taxi dispatch and cancellation; verify the admin API denies anonymous and forged-header requests.
10. Export and restore a D1 backup to a separate test database. Confirm live data from any old host is migrated deliberately; there is **no automatic database sync**.

## Deployment safety
- Use a staging `workers.dev` address for first verification. The production Worker must not be attached to `svanetitour.com` until Access routes and D1 are verified.
- **No deployment has been performed from this change.** It requires the owner's Cloudflare account, D1 ID, Access policy and secrets.
- The previous Sites authentication uses a trusted hosting header. This Cloudflare target switches to signed Access JWTs and checks the configured owner email.
- Use Cloudflare's error monitoring and keep owner contact details off public error responses.
- Never expose admin or booking export endpoints through a public cache.
- Cloudflare Access has its own availability and policy limits. Verify its free-tier suitability for your account before launch.

## Rollback
Keep the existing hosted pilot unchanged. If a Cloudflare deployment fails, disable its route and revert to the previous known-good version. Database writes made to the new D1 instance do not automatically appear in the old pilot.
