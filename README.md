# Mestia Travel

A mobile-friendly tourism site and owner workspace for tours, guesthouse stays and taxi enquiries in Mestia. Built with Python, Flask, SQLite and Waitress so it can run directly in Termux without Docker, Node.js, root access or a database server.

This is an initial pilot implementation. It starts with an empty catalogue: add the owner's real business information, services, photos, prices, resources and policies before inviting guests. “Mestia Travel” is a provisional name. No real bookings, reviews, drivers or availability are supplied.

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

Use your own email instead of `you@example.com`. Account creation prompts for a password and authenticator enrollment; there is no default administrator password. Open **http://127.0.0.1:8000** on the same phone, then `/admin` for the owner workspace. Stop with `Ctrl+C`.

The setup script creates a private random secret in `.env` and initializes `instance/mestia.sqlite3`. Running it again preserves existing configuration and data. Keep both out of Git. After Python package upgrades, an existing virtual environment may need to be recreated; preserve `.env` and `instance/`.

The same setup and start scripts work on Linux with Python 3.11+ and `venv` installed; skip `pkg` there. See [Termux deployment](docs/termux.md) before making the app public.

## What the pilot covers

- Public service pages, English/Georgian navigation, request forms and private guest status links.
- Owner-managed catalogue, providers, resources and availability blocks.
- Enquiry → quote → guest acceptance → staff confirmation, with expiring inventory holds.
- Room-night and shared guide/driver/vehicle conflict checks in database transactions.
- Manual taxi dispatch, acceptance evidence, reassignment and unavailable-driver outcomes.
- Separate manual payment records, change/cancellation requests, reminders and audit history.
- Individual staff accounts with password and authenticator codes, server-side permissions, CSRF protection, request throttling and a form spam trap.

Opening WhatsApp does not send a message or confirm a booking. Staff handle chats, verify contact, record payments and complete reminder tasks manually. Tours initially reserve guides exclusively for private trips; a shared-seat departure workflow is later work. There is no WhatsApp inbox sync, automatic messaging, card checkout or accommodation-channel sync. Georgian copy needs a native-speaker review. Do a supervised pilot with your real inventory before launch.

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
