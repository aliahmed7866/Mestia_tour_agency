# Termux deployment and recovery

## Install and start

Use the [official Termux installation instructions](https://github.com/termux/termux-app#installation) and keep the app and any Termux add-ons from a compatible source. The app runs under your Termux user. It does not need a rooted phone, `sudo`, Docker, systemd or a separate database daemon.

Keep the checkout in Termux's private home directory. Shared storage such as `/sdcard` has different filesystem semantics and exposes business data to more applications. Do not put the live database there.

Follow the commands in the [README](../README.md). The setup script creates a Python virtual environment and installs the versions in `requirements.txt`. It deliberately does not upgrade Termux's package-managed pip. If compilation of a dependency fails on your device, install Termux's `clang` package, then rerun setup; retain the error output if it still fails. Dependencies are installed into `.venv`, not the system Python.

Setup generates `.env` only when it does not already exist. It never rotates a working secret automatically. Keep the secret private and stable; changing it signs out sessions and can invalidate signed data. Shell environment variables take precedence over `.env`. The app reads `.env` as simple key/value data; it is not a shell script and does not expand variables.

| Setting | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | Random at setup | Session and token security; never share or commit it. |
| `MESTIA_DB` | `instance/mestia.sqlite3` | SQLite database; relative paths start at the project directory. |
| `MESTIA_MEDIA_DIR` | `instance/uploads` | Private local storage for uploaded service photographs. |
| `MESTIA_HOST` | `127.0.0.1` | Bind only to this phone. |
| `PORT` | `8095` | Local HTTP port. |
| `MESTIA_REQUIRE_TOTP` | `0` | Password-only staff login; use `1` to require enrolled authenticator codes. |
| `MESTIA_SECURE_COOKIES` | `0` | Use `1` for a public site served through HTTPS. |
| `MESTIA_TRUST_PROXY` | `0` | Use `1` only behind a single trusted proxy connecting from IPv4 `127.0.0.1`. |

Run `bash scripts/start.sh` to serve using Waitress. The Flask development server is not used for deployment. Restart the app after changing `.env`.

### Change an occupied port

Stop this app with `Ctrl+C`, then run:

```bash
bash scripts/set-port.sh 8095
bash scripts/start.sh
```

Open **http://127.0.0.1:8095** on the phone. The command checks the requested loopback port and saves it in `.env` without changing your secret key, database or other settings. It refuses if the port is occupied; choose another unused port between 1 and 65535 if needed. The availability check applies at the time of the command, so startup can still fail if another process takes the port afterward. If an exported shell `PORT` conflicts, run `unset PORT` and repeat. You can also run `.venv/bin/python -m mestia set-port 8095` directly.

Existing installs retain their saved port until you run this command. To use a different port for only one run, use `bash scripts/start.sh --port 8095`. Update any reverse proxy or tunnel origin to match your chosen port.

## Public access and HTTPS

The initial address is private to the device. Public hosting requires a domain or chosen tunnel address, a user-managed HTTPS reverse proxy/tunnel, and reliable connectivity. These are not installed or configured automatically. Pricing and service conditions depend on the provider you choose; no free hosting plan or permanent tunnel URL is assumed.

Keep the application on `127.0.0.1:8095` (or your configured local port) and have the proxy reach that local address. The proxy must terminate HTTPS and set its own forwarded headers. Do not expose the origin port directly to the internet or set `MESTIA_HOST=0.0.0.0` as a shortcut around the proxy. Waitress itself serves HTTP here.

Before using real guest data publicly:

1. Configure HTTPS at the proxy and redirect HTTP to HTTPS there.
2. Set `MESTIA_SECURE_COOKIES=1` and restart the app. Secure cookies require the HTTPS address for normal sign-in; turn this off only for isolated local HTTP testing.
3. Enable `MESTIA_TRUST_PROXY=1` only when exactly one trusted proxy connects from IPv4 `127.0.0.1` and controls and overwrites the `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers. This mode requires the server to bind to `127.0.0.1`. If your tunnel/proxy has a different chain, leave this disabled until its configuration is reviewed; do not guess the hop count.
4. Run `.venv/bin/python -m mestia check`. Then test guest requests, account sign-in, quotes and uploads through the actual HTTPS URL.
5. Arrange external uptime monitoring and off-device backups. Keep the business domain, device and proxy accounts under the owner's control.

The app's rate limiting is a basic pilot control, not a substitute for an internet-facing proxy's abuse protection. Avoid putting guest names, contact details or private status links in analytics, proxy access-log paths or shared screenshots. Guest status links are bearer credentials: anyone with a valid link can view that request and perform permitted guest actions.

## Keeping it running

The foreground process ends if you stop it. You can use a separate Termux session or `tmux` for convenience, but neither guarantees survival after Android kills the application or reboots. Termux's official project documents Android process restrictions. Battery settings, memory pressure, power loss and switching networks can interrupt service.

For a supervised pilot, keep the device powered and monitor the process. An optional `termux-wake-lock` helps prevent sleep; release it with `termux-wake-unlock` when finished. It does not prevent every Android termination. This project does not configure automatic start after reboot. If missed enquiries would harm the business, move the same app and its data to a maintained always-on host.

## Back up data

Stop the app with `Ctrl+C` first. The supported server, backup and restore commands use a shared process lock; backup refuses to run while that server is active so uploaded photos and database rows represent the same stopped state. Avoid any other process writing to the database or media while backing up.

```bash
bash scripts/backup.sh
# Or choose a destination explicitly:
bash scripts/backup.sh backups/before-update.zip
bash scripts/start.sh
```

The ZIP contains a database snapshot made with SQLite's backup API, uploaded media and a format manifest. Do not copy only the live SQLite file while the app is running: current transactions can be in its WAL file. A database backup includes guest records, staff password hashes and authenticator secrets, so protect it like the live database. The archive is not encrypted.

Back up `.env` separately and securely: the archive deliberately excludes the application's environment secret. Copy archives and the protected secret backup to a separate trusted device or encrypted storage. A backup kept only on the phone will not survive loss, damage or uninstalling Termux.

For this pilot, take a backup after a day's booking work and before updates. Choose a retention period with the owner; automate the same backup command only after an actual scheduler and its failure monitoring are configured. No scheduled task is installed by this repository.

## Restore safely

1. Stop the running app and prevent new writes. Take a fresh backup of the current database if it is still readable.
2. Place the known-good backup in private storage and run:

   ```bash
   .venv/bin/python -m mestia restore --input backups/known-good.zip --yes
   ```

3. The command restores the database and media together. Restore the matching `.env` from your separate protected backup if needed. Do not commit it.
4. Run `.venv/bin/python -m mestia check`, restart, and verify a known booking, quote, payment record, uploaded photo and staff login. Keep the original backup unchanged until this succeeds.

`--yes` authorizes replacement of the configured database and media; double-check the source path, `MESTIA_DB` and `MESTIA_MEDIA_DIR` before running it. ZIP paths, database integrity and references are checked before replacement. Previous data is retained in adjacent `.pre-restore` paths. Preserve these securely after verifying the restore; a further restore refuses to overwrite them. Restoring a database from an older application version may need the matching application version. Do not casually mix newer schemas with older code. Restore drills should use a separate checkout, database path and media path, away from real operations.

## Optional authenticator sign-in

Staff sign in with email and password by default. Passwords must contain at least 12 characters; there are no shared or default credentials. Previously enrolled accounts also use password-only login while `MESTIA_REQUIRE_TOTP=0` or unset. Enrollment secrets are retained so they can be used again later.

To enable authenticator codes, stop the server and prepare each staff account first. For an existing account, run:

```bash
MESTIA_REQUIRE_TOTP=1 .venv/bin/python -m mestia reset-user --email you@example.com
```

Replace the email with that account's address. This prompts for a new password and a working authenticator code, then saves both credentials together. Use `create-user` instead for a new account. Enrollment prints a private setup key and URI; do not share the output. Wait for the next code before signing in because enrollment consumes the current code.

After enrolling the staff who need access, set `MESTIA_REQUIRE_TOTP=1` in `.env`, run `.venv/bin/python -m mestia check`, then restart. Accounts without enrollment cannot sign in while this is enabled. Set it back to `0` and restart to return to password-only login. If you exported this variable in the shell, unset it before relying on the value in `.env`.

## Account recovery

An owner with trusted shell access to the installation can replace a lost staff password:

```bash
.venv/bin/python -m mestia reset-user --email you@example.com
```

Use the existing account's real email. With the default configuration this asks only for a new password and confirmation, preserves any existing authenticator enrollment, and invalidates that account's earlier sessions. With `MESTIA_REQUIRE_TOTP=1`, it also replaces the authenticator enrollment after verifying a code. An unsuccessful enrollment leaves existing credentials unchanged.

If earlier setup was cancelled before enrollment finished, no account was created. Use `create-user` with your email to finish setup under the current password-only default. Protect access to the phone and Termux shell as owner-level access. There are no emailed reset links or recovery-code service in this pilot.

## Update the application

Stop the app, back up the database and uploaded media, then review the changes being installed. In a clean checkout:

```bash
git pull --ff-only
bash scripts/setup-termux.sh
.venv/bin/python -m pip install -r requirements-dev.txt
bash scripts/test.sh
.venv/bin/python -m mestia check
bash scripts/start.sh
```

This update adds catalogue columns without rebuilding existing tables, then installs researched drafts once. Existing rows, operator edits, deleted/disabled offers and configuration are preserved. This is a specific additive migration, not a general promise of compatibility with every future schema change: read future release instructions before updating a live installation. Never reset the working database to make an update succeed. Review dependency security updates as part of ongoing maintenance.

## Official references

- [Termux overview](https://termux.dev/en/) and [installation, compatibility and Android restrictions](https://github.com/termux/termux-app).
- [Python virtual environments and pip](https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/).
- [Flask deployment guidance](https://flask.palletsprojects.com/en/stable/deploying/) and [Waitress deployment](https://flask.palletsprojects.com/en/stable/deploying/waitress/).
- [Flask proxy trust configuration](https://flask.palletsprojects.com/en/stable/deploying/proxy_fix/).

The setup scripts can be checked in a Linux environment, but only running them on the intended Android/Termux device verifies its package versions, permissions and process behavior.

The Python tzdata package is included as a fallback for Android timezone database paths. MarkupSafe can fall back to pure Python if a C compiler is unavailable; no compiler is needed for normal operation.
