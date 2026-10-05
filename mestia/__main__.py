"""Termux-friendly application commands: python -m mestia --help."""
import argparse
from getpass import getpass
import os
from pathlib import Path
import re
import socket
import sqlite3
import sys
import tempfile
import zipfile
from urllib.parse import quote, urlencode

from .db import connect, init_db
from .ops import backup, restore, runtime_lock
from .security import hash_password, new_totp_secret, verify_totp


def set_port(port, env_path):
    """Persist a checked local port without loading the app or changing its secret."""
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535.")
    env_path = Path(env_path)
    if env_path.is_symlink():
        raise ValueError("Refusing to replace a linked .env file. Update its PORT setting directly.")
    if not env_path.is_file():
        raise ValueError("First run bash scripts/setup-termux.sh to create .env.")
    exported_port = os.environ.get("PORT")
    if exported_port is not None and exported_port != str(port):
        raise ValueError("An exported PORT overrides .env. Run unset PORT, then repeat this command.")
    content = env_path.read_bytes().decode("utf-8")
    # The probe checks availability now; another process could claim the port before startup.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", port))
    except OSError as exc:
        raise ValueError(f"Port {port} is unavailable on 127.0.0.1. Stop the app or choose another port; .env was not changed.") from exc
    lines = content.splitlines(keepends=True)
    found = False
    for index, line in enumerate(lines):
        if re.match(r"^[ \t]*PORT[ \t]*=", line):
            ending = "\r\n" if line.endswith("\r\n") else ("\n" if line.endswith("\n") else "")
            lines[index] = f"PORT={port}{ending}"
            found = True
    if not found:
        newline = "\r\n" if "\r\n" in content else "\n"
        if lines and not lines[-1].endswith(("\r", "\n")):
            lines[-1] += newline
        lines.append(f"PORT={port}{newline}")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", prefix=".env-port-", dir=env_path.parent, delete=False) as output:
            temporary = Path(output.name)
            os.chmod(temporary, 0o600)
            output.write("".join(lines).encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, env_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"Saved PORT={port} in .env. Other settings and the secret key were preserved.")
    print(f"Start with bash scripts/start.sh, then open http://127.0.0.1:{port} on this phone.")


def _password():
    first = getpass("New password (at least 12 characters): ")
    second = getpass("Confirm password: ")
    if first != second:
        raise ValueError("Passwords do not match.")
    return hash_password(first)


def _enroll(email):
    secret = new_totp_secret()
    label = quote("Mestia Travel:" + email, safe="")
    uri = "otpauth://totp/" + label + "?" + urlencode({
        "secret": secret, "issuer": "Mestia Travel", "algorithm": "SHA1", "digits": 6, "period": 30,
    })
    print("Add this account to your authenticator. Keep this secret private.")
    print("Manual setup key:", secret)
    print("Authenticator URI:", uri)
    step = verify_totp(secret, getpass("Enter the current 6-digit authenticator code: ").strip())
    if step is None:
        raise ValueError("Authenticator code was not valid. Account was not changed.")
    return secret, step


def _manage_user(conn, args, require_totp=False):
    email = args.email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Enter a valid email address.")
    existing = conn.execute("SELECT id,role,active FROM users WHERE email=?", (email,)).fetchone()
    if args.command == "create-user" and existing:
        raise ValueError("This user already exists. Use reset-user explicitly to replace credentials.")
    if args.command == "reset-user" and not existing:
        raise ValueError("No user with that email exists.")
    password = _password()
    secret, step = _enroll(email) if require_totp else (None, None)
    role = args.role or (existing["role"] if existing else "owner")
    conn.execute("BEGIN IMMEDIATE")
    try:
        if existing:
            current = conn.execute("SELECT id,role,active FROM users WHERE id=?", (existing["id"],)).fetchone()
            if not current:
                raise ValueError("User no longer exists.")
            if role != "owner":
                _protect_last_owner(conn, current)
            if require_totp:
                conn.execute("""UPDATE users SET password_hash=?,totp_secret=?,totp_last_step=?,role=?,active=1
                             WHERE id=?""", (password, secret, step, role, existing["id"]))
            else:
                # Keep any existing enrollment for a later opt-in to two-factor login.
                conn.execute("""UPDATE users SET password_hash=?,role=?,active=1 WHERE id=?""",
                             (password, role, existing["id"]))
        else:
            conn.execute("""INSERT INTO users(email,password_hash,totp_secret,totp_last_step,role)
                         VALUES (?,?,?,?,?)""", (email, password, secret, step, role))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    print(f"{'Reset' if existing else 'Created'} {role} account {email}.")
    if require_totp:
        print("Wait for the next authenticator code before signing in. Store your credentials securely.")
    else:
        print("Sign in with your email and password. Store your credentials securely.")


def _protect_last_owner(conn, user):
    if user["role"] == "owner" and user["active"]:
        others = conn.execute("SELECT count(*) FROM users WHERE id<>? AND role='owner' AND active=1",
                              (user["id"],)).fetchone()[0]
        if not others:
            raise ValueError("Create another active owner before disabling or downgrading the last owner.")


def _disable_user(conn, email):
    conn.execute("BEGIN IMMEDIATE")
    try:
        user = conn.execute("SELECT id,role,active FROM users WHERE email=?", (email.strip().lower(),)).fetchone()
        if not user:
            raise ValueError("No user with that email exists.")
        _protect_last_owner(conn, user)
        conn.execute("UPDATE users SET active=0 WHERE id=?", (user["id"],))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    print("Account disabled. Its existing sessions can no longer access the admin panel.")


def deployment_check(app):
    """Return (errors, warnings), without displaying secret values or guest data."""
    errors, warnings = [], []
    config = app.config
    key = config.get("SECRET_KEY") or ""
    if len(key) < 32:
        errors.append("Set a random SECRET_KEY of at least 32 characters.")
    if config.get("DEBUG"):
        errors.append("DEBUG must be disabled.")
    if not config.get("SESSION_COOKIE_SECURE"):
        warnings.append("Secure session cookies are disabled. Enable them for an HTTPS deployment.")
    if not config.get("PUBLIC_URL"):
        warnings.append("Set MESTIA_PUBLIC_URL to your live HTTPS origin for canonical URLs and a sitemap.")
    if not config.get("INDEXING_ENABLED"):
        warnings.append("Search indexing is disabled. Set MESTIA_INDEXING_ENABLED=1 after reviewing the public site.")
    if config.get("SQLITE_JOURNAL_MODE") == "DELETE":
        warnings.append("SQLite uses DELETE journal mode for this host. Keep backups and check provider database guidance before live operations.")
    dbpath = Path(config["DATABASE"])
    if not dbpath.exists():
        errors.append("Database is missing; run init-db.")
    else:
        conn = connect(dbpath, journal_mode=config.get('SQLITE_JOURNAL_MODE'))
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                errors.append("Database integrity check failed.")
            if conn.execute("PRAGMA foreign_key_check").fetchone():
                errors.append("Database contains invalid references.")
            owner_query = "SELECT count(*) FROM users WHERE role='owner' AND active=1"
            if config.get("REQUIRE_TOTP"):
                owner_query += " AND totp_secret IS NOT NULL AND totp_secret<>''"
            owners = conn.execute(owner_query).fetchone()[0]
            if not owners:
                errors.append("Create at least one active owner with authenticator enrollment." if config.get("REQUIRE_TOTP")
                              else "Create at least one active owner account.")
            settings = dict(conn.execute("SELECT key,value FROM settings"))
            from .business_content import whatsapp_contact
            if not whatsapp_contact(settings)[0]:
                warnings.append("Configure your central WhatsApp number or business link before public launch.")
            for key, label in (("booking_terms", "booking and cancellation terms"),
                               ("privacy_notice", "privacy notice")):
                if not settings.get(key, "").strip():
                    warnings.append(f"Configure your {label} before public launch.")
            if not conn.execute("SELECT count(*) FROM services WHERE published=1").fetchone()[0]:
                warnings.append("No services are published; add real services, photos and resource availability.")
        except sqlite3.DatabaseError:
            errors.append("Database schema is missing or damaged; initialize or restore it.")
        finally:
            conn.close()
    media = Path(config["MEDIA_DIR"])
    if not media.is_dir() or not os.access(media, os.W_OK):
        errors.append("Media directory is missing or not writable.")
    warnings.append("Use HTTPS before accepting real guest information. Android can stop background processes; maintain tested off-device backups.")
    return errors, warnings


def parser():
    result = argparse.ArgumentParser(description="Mestia Travel administration and Termux server")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("init-db", help="Create missing database tables without replacing existing data")
    for name, help_text in (("create-user", "Create an admin; enroll an authenticator only if MESTIA_REQUIRE_TOTP=1"),
                            ("reset-user", "Reset an admin password; re-enroll only if MESTIA_REQUIRE_TOTP=1")):
        user = commands.add_parser(name, help=help_text)
        user.add_argument("--email", required=True)
        user.add_argument("--role", choices=("owner", "dispatcher"), default=None)
    disabling = commands.add_parser("disable-user", help="Disable staff access, preserving the last active owner")
    disabling.add_argument("--email", required=True)
    serving = commands.add_parser("serve", help="Start the production Waitress server")
    serving.add_argument("--host", default=None)
    serving.add_argument("--port", type=int, default=None)
    port_setting = commands.add_parser("set-port", help="Check and save a different local port in .env")
    port_setting.add_argument("port", type=int, help="Port number between 1 and 65535")
    copying = commands.add_parser("backup", help="Back up database and media; stop server first")
    copying.add_argument("--output", required=True, help="New ZIP destination outside the media directory")
    restoring = commands.add_parser("restore", help="Restore a verified ZIP backup; stop server first")
    restoring.add_argument("--input", required=True, help="Mestia ZIP backup")
    restoring.add_argument("--yes", action="store_true", help="Confirm replacement of database and media")
    commands.add_parser("check", help="Run local deployment preflight checks")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    # Help and set-port do not initialize the application or touch its database.
    from . import ROOT, create_app
    try:
        if args.command == "set-port":
            set_port(args.port, ROOT / ".env")
            return 0
        app = create_app()
        database, media = app.config["DATABASE"], app.config["MEDIA_DIR"]
        if args.command == "init-db":
            conn = connect(database)
            try:
                init_db(conn)
            finally:
                conn.close()
            print("Database initialized. Owner-supplied service content is available; no default admin, inventory or bookings were created.")
        elif args.command in ("create-user", "reset-user", "disable-user"):
            conn = connect(database)
            try:
                if args.command == "disable-user":
                    _disable_user(conn, args.email)
                else:
                    _manage_user(conn, args, require_totp=app.config["REQUIRE_TOTP"])
            finally:
                conn.close()
        elif args.command == "serve":
            from waitress import serve
            host = args.host or os.environ.get("MESTIA_HOST", "127.0.0.1")
            port = args.port if args.port is not None else int(os.environ.get("PORT", "8095"))
            if not 1 <= port <= 65535:
                raise ValueError("Port must be between 1 and 65535.")
            proxy_options = {}
            if app.config.get("TRUST_PROXY"):
                if host != "127.0.0.1":
                    raise ValueError("Trusted proxy mode requires MESTIA_HOST=127.0.0.1 and one local HTTPS reverse proxy.")
                proxy_options = {
                    "trusted_proxy": "127.0.0.1", "trusted_proxy_count": 1,
                    "trusted_proxy_headers": {"x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"},
                }
            with runtime_lock(database):
                print(f"Serving Mestia Travel on http://{host}:{port}", flush=True)
                serve(app, host=host, port=port, threads=4,
                      max_request_body_size=app.config.get("MAX_CONTENT_LENGTH") or 8 * 1024 * 1024,
                      clear_untrusted_proxy_headers=True, expose_tracebacks=False, **proxy_options)
        elif args.command == "backup":
            saved = backup(database, media, args.output)
            print(f"Backup saved: {saved}")
            print("Contains guest information, password hashes and authenticator keys. Encrypt off-device copies.")
            print("Save .env/environment secrets separately and securely.")
        elif args.command == "restore":
            if not args.yes:
                raise ValueError("Restore replaces your database and media. Stop the server, then repeat with --yes.")
            restore(database, media, args.input)
            print("Restore complete. Previous data is retained in adjacent .pre-restore paths.")
            print("Restore the matching .env securely, run check, then start the server.")
        elif args.command == "check":
            errors, warnings = deployment_check(app)
            for item in errors:
                print("ERROR:", item)
            for item in warnings:
                print("REVIEW:", item)
            print(f"Preflight: {len(errors)} errors, {len(warnings)} review items.")
            return 1 if errors else 0
        return 0
    except (ValueError, RuntimeError, OSError, sqlite3.DatabaseError, zipfile.BadZipFile) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Cancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
