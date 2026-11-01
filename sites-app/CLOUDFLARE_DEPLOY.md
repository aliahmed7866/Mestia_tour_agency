# Svaneti Guide — Cloudflare Free-first deployment

**Status: implementation scaffold, not deployed or verified.** The Sites-hosted version and Cloudflare version have **separate D1 databases**. Do not point the public domain at this deployment until end-to-end testing, owner access and backup restoration are verified.

## Architecture and cost
- Cloudflare Workers Free serves the vinext website and API.
- D1 Free holds services, booking requests, room nights, guides, drivers, taxi dispatch and reservations.
- Use existing static assets for launch; R2 is optional, not needed for initial deployment.
- Cloudflare Access protects the owner. **Do not enable a public bootstrap endpoint without Access and verified owner email.**
- Cloudflare Free has 100,000 requests/day and 10 ms CPU per request (as documented October 2026). Server rendering can exceed the CPU limit; measure real routes before committing to Free. Upgrade only if needed.

## Setup
1. Buy/attach `svanetiguide.com` in your own Cloudflare account. Keep the domain off the new Worker until verified.
2. The owner has created D1 database `svaneti-guide`, and its ID is configured in `wrangler.jsonc`. The binding remains `DB`. No need to recreate it.
3. With Node >=22.13 and pnpm 11, run `pnpm install --frozen-lockfile` from `sites-app`.
4. Apply the existing SQL schemas **once**, in order:
   ```sh
   pnpm exec wrangler d1 execute svaneti-guide --remote --file=drizzle/0000_tricky_sage.sql
   pnpm exec wrangler d1 execute svaneti-guide --remote --file=drizzle/0001_equal_stark_industries.sql
   ```
   Back up D1 before future migrations. Do not reapply blindly.
5. In Cloudflare Zero Trust → Access → Applications, create a self-hosted application for the domain, protecting **/admin*** and **/api/admin*** with an allow policy for your specific email. Include `/api/admin/bootstrap` and `/api/admin/export`. Use the same Access application AUD tag. Configure your login method and test on a private preview first.
6. Access identity configuration is already included as non-credential Worker vars in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ADMIN_EMAIL`. These are identifiers, **not API credentials**. The server verifies Access JWT signature, issuer, audience, expiry and owner email. Never commit JWTs, API tokens or passwords. If protecting /admin with a separate Access application, add its AUD tag to the comma-separated `ACCESS_AUD` setting.
   **Important:** the application protects owner API data even on the unprotected `workers.dev` preview, but Cloudflare Access login itself is configured only for the production hostname. Verify admin login and policy behavior on the production hostname before launch.
7. Recommended phone-friendly route: configure GitHub Actions repository secrets `CLOUDFLARE_API_TOKEN` (a narrowly scoped Cloudflare API token with Workers Scripts Edit and D1 Edit for the correct account) and `CLOUDFLARE_ACCOUNT_ID`. **Never paste either into chat or commit them.** After this PR is merged, open GitHub → Actions → **Svaneti Guide - Cloudflare Worker** → Run workflow. Choose `initialize-d1`, enter `INITIALIZE` (only on an empty database), then separately choose `deploy-staging`. Check the run logs. The workflow does not attach the custom domain. Alternatively, build and deploy from `sites-app` with `node scripts/deploy-cloudflare.mjs` using your own Wrangler login.
8. Set `NEXT_PUBLIC_SITE_URL=https://svanetiguide.com` at build time for canonical metadata when enabling public launch. Do not enable indexing until real services, policies, domain and SEO are reviewed.
9. Verify public requests, quotes, quote acceptance, manual contact/deposit evidence, room/tour resource conflicts, taxi dispatch and cancellation; verify the admin API denies anonymous and forged-header requests.
10. Export and restore a D1 backup to a separate test database. Confirm live data from any old host is migrated deliberately; there is **no automatic database sync**.

## Deployment safety
- Use a staging `workers.dev` address for first verification. The production Worker must not be attached to `svanetiguide.com` until Access routes and D1 are verified.
- **No deployment has been performed from this change.** It requires the owner's Cloudflare account, D1 ID, Access policy and secrets.
- The previous Sites authentication uses a trusted hosting header. This Cloudflare target switches to signed Access JWTs and checks the configured owner email.
- Use Cloudflare's error monitoring and keep owner contact details off public error responses.
- Never expose admin or booking export endpoints through a public cache.
- Cloudflare Access has its own availability and policy limits. Verify its free-tier suitability for your account before launch.

## Rollback
Keep the existing hosted pilot unchanged. If a Cloudflare deployment fails, disable its route and revert to the previous known-good version. Database writes made to the new D1 instance do not automatically appear in the old pilot.

## Confirmed Access configuration (2026-11-01)
- Production hostname: `svanetiguide.com`
- Owner allow-policy email: `svanetiguide@gmail.com`
- Access application AUD tag: `f6f2cbcfb75d4f7d62e38a15ef9217f289eca7715ace28d680cb1b60567ecf10`
- Zero Trust team domain: `autumn-unit-071c.cloudflareaccess.com`.
- These values identify an Access application; they are not login credentials. Configure `ADMIN_EMAIL` and `ACCESS_AUD` as Worker environment settings during deployment; keep JWTs, API tokens and account credentials private.
