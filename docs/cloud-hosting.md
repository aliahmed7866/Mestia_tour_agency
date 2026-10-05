# Cloud hosting for Mestia Travel

Reviewed 5 October 2026. These files prepare a deployment; they do not create an account, publish a site, buy a domain or authorize a paid plan. Local Termux use remains at port **8095**.

## Choose a hosting route

| Route | What it supports | Fit for this app |
| --- | --- | --- |
| PythonAnywhere Beginner, $0 | One hosted app, one worker, 512 MiB storage; provider subdomain; monthly renewal | A small pilot. Keep backups and monitor storage/errors. No custom domain on this plan. |
| Render paid web service + persistent disk | One instance, durable database/uploads, custom domain support | Recommended for a public launch using the existing SQLite architecture. The included Blueprint is **paid**. Review the current checkout total. |
| Render free web service | Temporary filesystem, idle sleep, no persistent disk | **Do not deploy this app's live data here.** Restarts, deployments and sleep can erase SQLite records and uploads. Sleeping sites also receive a provider `robots.txt` that blocks crawling. |
| PythonAnywhere paid | Custom domains and more resources | An alternative, but changing plan alone does not remove SQLite network-storage constraints. A database migration would need separate work. |

PythonAnywhere's new free accounts do not include MySQL or scheduled tasks. Their storage uses a network filesystem: PythonAnywhere staff explicitly confirm that SQLite WAL mode is unsupported. The pilot setup selects `MESTIA_SQLITE_JOURNAL_MODE=DELETE`; this removes that specific incompatibility but does **not** turn SQLite on network storage into a production database guarantee. Keep one web worker; do not run other processes writing to the same database. If locks or reliability issues appear, use the local persistent-disk route rather than raising worker counts.

Sources: [PythonAnywhere pricing](https://www.pythonanywhere.com/pricing/), [free features](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/), [SQLite WAL advice from PythonAnywhere staff](https://www.pythonanywhere.com/forums/topic/36213/), [Render free limits](https://render.com/docs/free), [Render disks](https://render.com/docs/disks), [Render pricing](https://render.com/pricing).

## PythonAnywhere free pilot: initial setup

1. Create a Beginner account on [PythonAnywhere](https://www.pythonanywhere.com/). Choose a usable username: it becomes the public subdomain. Confirm the exact web address shown in your account; EU accounts may use a different provider suffix.
2. Open a **Bash console** there. These commands run on PythonAnywhere, not in Termux. If the project folder already exists, enter it and inspect it instead of cloning over it.

```bash
git clone https://github.com/aliahmed7866/Mestia_tour_agency.git
cd ~/Mestia_tour_agency
```

3. Use the same Python version for setup and the web app. The example uses Python 3.13; any supported 3.11+ interpreter works. Replace the URL with your actual provider address, then enter the owner email. The password prompt does not echo your password.

```bash
read -r -p "Your public HTTPS URL: " mestia_public_url
read -r -p "Your admin email: " mestia_admin_email
MESTIA_PYTHON=python3.13 bash scripts/setup-cloud.sh "$mestia_public_url" "$mestia_admin_email"
```

The script installs dependencies in `.venv`, creates a private `.env` with a random secret, initializes missing database tables and prompts for an owner password. Repeating setup preserves existing configuration, records and staff credentials. If the existing `.env` is from Termux, it stops and names the settings that need review; it never silently changes that installation into a public server. New cloud setup keeps indexing disabled until review.

4. In the **Web** tab, choose **Add a new web app → Manual configuration → Python 3.13** (matching step 3). Set the virtualenv path to `/home/YOUR_USERNAME/Mestia_tour_agency/.venv`.
5. Open the **WSGI configuration file linked by the Web tab**. Replace the sample code with this, substituting the actual username:

```python
import sys

project_path = '/home/YOUR_USERNAME/Mestia_tour_agency'
if project_path not in sys.path:
    sys.path.insert(0, project_path)

from wsgi import application
```

6. Enable **Force HTTPS** in Web → Security. The provider subdomain already has an HTTPS certificate. Do not add `ProxyFix`, change `MESTIA_TRUST_PROXY`, or run `bash scripts/start.sh` in the console: PythonAnywhere runs the WSGI app itself.
7. Click **Reload**, visit your HTTPS address and `/health`, then sign in at `/admin/login`. Inspect the Web tab error log if loading fails. Leave the storage folder, `.env`, uploads and backups out of any static directory mapping. The app serves authorized media itself.

Official setup references: [existing Flask applications](https://help.pythonanywhere.com/pages/Flask/), [HTTPS certificates](https://help.pythonanywhere.com/pages/HTTPSSetup/), [Force HTTPS](https://help.pythonanywhere.com/pages/ForcingHTTPS/).

## Review and enable search indexing

Before inviting guests, review the published service details, contact number, actual photos, privacy notice and booking/cancellation terms in the admin panel. The one-time catalogue launch opens eight untouched Svaneti day outings to requests; eleven further proposals remain drafts, and existing owner edits, disabled routes and deletions are preserved. Review the public FAQ and test an activity booking request and a staff login over HTTPS. The application never invents availability or confirms a booking from a request.

Run the app's deployment check in the hosting Bash console:

```bash
cd ~/Mestia_tour_agency
.venv/bin/python -m mestia check
```

Use PythonAnywhere's file editor to set `MESTIA_INDEXING_ENABLED=1` in the private `.env` when ready, preserving all other settings, then **Reload**. `MESTIA_PUBLIC_URL` must match the one chosen public HTTPS origin. Follow [the SEO launch guide](seo-launch.md) for sitemap submission and verification. Do not submit an unreviewed pilot to search engines.

Use the renewal/expiry controls shown on the free account's Web tab before the monthly expiry. A free account is not a set-and-forget host. Download backups regularly and keep enough room for dependencies, uploaded images and a backup archive within the storage limit.

## Move existing Termux records and pictures

Keep the new cloud site disabled while importing. Never publish two independent copies that both accept bookings: their availability and enquiry records would diverge.

1. On the phone, stop the app with **Ctrl+C**, then make an archive:

```bash
cd ~/Mestia_tour_agency
bash scripts/backup.sh
```

2. Use Android's file picker to upload the archive to PythonAnywhere's **Files** tab, for example into `/home/YOUR_USERNAME/imports/`. If the browser cannot access Termux's private files, use Termux's share command (`termux-share`) when Termux:API is installed, or copy just that archive into a location you can select. Remove temporary shared-storage copies after transfer. The archive contains private guest data and staff password hashes; do not upload it to GitHub or a public URL. It excludes `.env`.
3. Configure the new cloud installation first, then click **Disable** in its Web tab and stop any console commands that use this database. WSGI processes are not protected by the local server's runtime lock; they must actually be stopped for updates, backups and restores. Run:

```bash
cd ~/Mestia_tour_agency
.venv/bin/python -m mestia restore --input /home/YOUR_USERNAME/imports/YOUR_BACKUP.zip --yes
.venv/bin/python -m mestia check
```

4. The restored database contains the phone's staff accounts and catalogue edits. Keep the cloud-generated secret and HTTPS settings; do not copy the Termux `.env` over them. Existing sessions will require a fresh login. Re-enable/reload the web app, check the records and images, and leave the phone instance stopped once cloud enquiries are live.

To update a PythonAnywhere deployment later: **Disable** the web app, make a backup with `bash scripts/backup.sh`, run `git pull --ff-only`, install dependencies with `.venv/bin/python -m pip install -r requirements.txt`, run `.venv/bin/python -m mestia check`, then re-enable/reload. Do not delete an existing project folder to resolve a Git error. Keep downloaded backups off the hosting account as well.

## Render with a persistent disk (paid)

The root `render.yaml` is a prepared Blueprint for one paid `0.5c-512mb` Python service in Frankfurt and a 1 GB disk at `/var/data`. Database and uploaded images both live on that disk. It has no default admin password, and no domain is registered by deploying it. The `.python-version` file selects the latest Python 3.13 patch supported by Render. See [Blueprint fields](https://render.com/docs/blueprint-spec) and [Python versions](https://render.com/docs/python-version).

1. Sign into Render, connect this GitHub repository, and open **New → Blueprint**. Review the plan, disk cost and any usage charges before creating anything. Auto-deploy is deliberately off so upgrades can be backed up and reviewed.
2. At the environment prompt, enter the actual HTTPS origin as `MESTIA_PUBLIC_URL`. If Render has not assigned your service URL yet, leave this value empty for the first private review; add the real dashboard URL in Environment immediately after deployment. Indexing stays disabled until a valid origin is configured and review is complete. Never enter a guessed URL.
3. The runtime starts with `python -m mestia serve`; Render supplies the listening `PORT`. Keep `MESTIA_HOST=0.0.0.0`, `MESTIA_TRUST_PROXY=0`, secure cookies enabled and the disk-backed database/media paths from the Blueprint. Do not change to a free instance or remove the disk while expecting data to persist.
4. In the running service's **Shell**, create the owner with `python -m mestia create-user --email YOUR_EMAIL`. Inspect `/health`, sign in over HTTPS and complete the launch review. Adding staff does not require copying secrets into GitHub.
5. If using your own domain, add it in Render's **Settings → Custom Domains** and use the DNS records Render supplies. Wait for domain verification and the managed certificate before changing `MESTIA_PUBLIC_URL` to it. Set `MESTIA_INDEXING_ENABLED=1` only once the final site is ready, then deploy the environment change.

Persistent disks are available only at runtime, so database initialization belongs at app startup, not the build/pre-deploy command. A disk permits one service instance; deployments briefly stop the existing instance. Keep application-level backups and test a restore before relying on live bookings. Do not treat a provider disk snapshot as a verified SQLite backup. Use a maintenance window with the app process stopped for this repository's backup/restore commands; a live server correctly refuses them. Arrange that operational procedure before moving real booking records to Render.

Forwarded headers remain untrusted. On a managed reverse proxy, rate limiting can therefore use the shared proxy address; check the actual client-address behavior on the chosen host before inviting guests. Do not enable the loopback-only proxy option on Render or blindly trust a user-supplied `X-Forwarded-For` value. The repository has been tested locally; provider-specific routing and an actual public deployment still need verification.

No hosting account or paid resource has been created by adding these files. The final dashboard creation step and any payment need the account owner's action.
