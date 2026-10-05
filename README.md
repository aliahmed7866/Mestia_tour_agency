# Mestia Travel

A mobile-friendly tourism site and owner workspace for tours, guesthouse stays and taxi enquiries in Mestia. Built with Python, Flask, SQLite and Waitress so it can run directly in Termux without Docker, Node.js, root access or a database server.

This is an initial pilot implementation. It includes the services from the supplied business card and Riverside Svaneti Guest House, with its Instagram and the card's exact WhatsApp QR destination. Add actual prices, photos, resources and policies before inviting guests. “Mestia Travel” is a provisional name. No real bookings, reviews, drivers or availability are supplied.

## Run on Android with Termux

Install Termux using its [official installation guidance](https://github.com/termux/termux-app#installation). Run these commands **inside Termux's private home directory**, rather than Android shared storage:

```bash
pkg update
pkg install python python-pip git
cd ~
git clone https://github.com/aliahmed7866/Mestia_tour_agency.git
cd Mestia_tour_agency
bash scripts/setup-termux.sh
.venv/bin/python -m mestia create-user --email you@example.com
bash scripts/start.sh
```

Use your own email instead of `you@example.com`. Account creation asks you to enter and confirm a password of at least 12 characters. Staff sign in with email and password; no authenticator is required by default, and there is no default administrator password. Open **http://127.0.0.1:8095** on the same phone, then `/admin` for the owner workspace. Stop with `Ctrl+C`.

The setup script creates a private random secret in `.env` and initializes `instance/mestia.sqlite3`. Running it again preserves existing configuration and data. Keep both out of Git. After Python package upgrades, an existing virtual environment may need to be recreated; preserve `.env` and `instance/`.

If you already installed the app, stop it with `Ctrl+C` and switch the saved port after updating:

```bash
git pull --ff-only
bash scripts/set-port.sh 8095
bash scripts/start.sh
```

On the next startup, the supplied service/contact content is added once; existing operator edits and nonempty contact settings are preserved. The guide's supplied Instagram is [@guledaniakaki](https://www.instagram.com/guledaniakaki/), alongside the Riverside Svaneti guesthouse profile.

Updating and restarting enables password-only login when `MESTIA_REQUIRE_TOTP` is absent or `0`. Existing accounts keep their passwords. If an earlier account setup was cancelled during authenticator enrollment, rerun the `create-user` command above; an unfinished enrollment did not save an account. Optional authenticator setup is documented in [Termux deployment](docs/termux.md#optional-authenticator-sign-in).

The port command preserves the other `.env` settings and secret key, and refuses to change the file if the requested local port is occupied. Choose another unused port with the same command if necessary. An existing `.env` is never replaced by setup, so updating alone keeps its previous port. If you have exported `PORT` in your shell, run `unset PORT` before changing the saved port. Startup prints the address actually in use.

The same setup and start scripts work on Linux with Python 3.11+ and `venv` installed; skip `pkg` there. See [Termux deployment](docs/termux.md) before making the app public.

## What the pilot covers

- Public service pages, English/Georgian navigation, request forms and private guest status links.
- Seventeen researched offering drafts, focused on Svaneti, with editable itineraries, seasons, logistics and source notes.
- Owner-managed catalogue with preview, publish, disable, delete and restore; providers, resources and availability blocks.
- Enquiry → quote → guest acceptance → staff confirmation, with expiring inventory holds.
- Room-night and shared guide/driver/vehicle conflict checks in database transactions.
- Manual taxi dispatch, acceptance evidence, reassignment and unavailable-driver outcomes.
- Separate manual payment records, change/cancellation requests, reminders and audit history.
- Individual staff accounts with passwords and optional authenticator codes, server-side permissions, CSRF protection, request throttling and a form spam trap.

Opening WhatsApp does not send a message or confirm a booking. The supplied QR business link opens the chat; guests must include their request reference manually. If the owner enters a full international WhatsApp number in settings, guest links can prefill the reference. Staff handle chats, verify contact, record payments and complete reminder tasks manually. Tours initially reserve guides exclusively for private trips; a shared-seat departure workflow is later work. There is no WhatsApp inbox sync, automatic messaging, card checkout or accommodation-channel sync. Georgian copy needs a native-speaker review. Do a supervised pilot with your real inventory before launch.

## Researched offering presets

The next startup adds 17 route drafts once: ten Svaneti outings, western transfers and touring, plus Tbilisi-based Kazbegi and Kakheti extensions. They do not replace existing services or publish themselves. Open **Admin → Services → Drafts**, edit a route, preview it and publish when the guide has confirmed delivery. Prices, actual resources and group limits are deliberately unfilled. Source URLs, checked date and private planning notes live in each editor.

Every offering's public copy and logistics can be changed without code. Disabling hides it; deleting removes it from the active catalogue while preserving enquiry/quote history; restoring returns it as a draft. Later restarts preserve those choices. Calendar filters describe the planned season, not live availability. Read the [research and route decisions](docs/offering-research.md).

## Operations and development

```bash
# Review deployment configuration.
.venv/bin/python -m mestia check

# Stop the server first, then back up the database and uploaded photos.
bash scripts/backup.sh

# Install optional development dependencies and run automated checks.
.venv/bin/python -m pip install -r requirements-dev.txt
bash scripts/test.sh
```

See the [operator guide](docs/operator-guide.md) for first setup and daily booking work, [deployment guide](docs/termux.md) for HTTPS, backups and recovery, and [scope decisions](docs/decisions.md) for owner inputs and deferred work.

The database, uploads and secret stay on the device unless you arrange a protected off-device backup. Termux is practical for a pilot, but Android can stop its processes and a phone is not an always-on hosting service. Public HTTPS, a domain, monitoring and off-device backups are deployment responsibilities; this repository does not provision them.
