"""Termux-friendly application commands: python -m mestia --help."""
import argparse
from getpass import getpass
import os
from pathlib import Path
import re
import sqlite3
import sys
import zipfile
from urllib.parse import quote, urlencode

from .db import connect, init_db
from .ops import backup, restore, runtime_lock
from .security import hash_password, new_totp_secret, verify_totp


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


def _manage_user(conn, args):
    email = args.email.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("Enter a valid email address.")
    existing = conn.execute("SELECT id,role,active FROM users WHERE email=?", (email,)).fetchone()
    if args.command == "create-user" and existing:
        raise ValueError("This user already exists. Use reset-user explicitly to replace credentials.")
    if args.command == "reset-user" and not existing:
        raise ValueError("No user with that email exists.")
    password = _password()
    secret, step = _enroll(email)
    role = args.role or (existing["role"] if existing else "owner")
    conn.execute("BEGIN IMMEDIATE")
    try:
        if existing:
            current = conn.execute("SELECT id,role,active FROM users WHERE id=?", (existing["id"],)).fetchone()
            if not current:
                raise ValueError("User no longer exists.")
            if role != "owner":
                _protect_last_owner(conn, current)
            conn.execute("""UPDATE users SET password_hash=?,totp_secret=?,totp_last_step=?,role=?,active=1
                         WHERE id=?""", (password, secret, step, role, existing["id"]))
        else:
            conn.execute("""INSERT INTO users(email,password_hash,totp_secret,totp_last_step,role)
                         VALUES (?,?,?,?,?)""", (email, password, secret, step, role))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    print(f"{'Reset' if existing else 'Created'} {role} account {email}.")
    print("Wait for the next authenticator code before signing in. Store your credentials securely.")


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
    dbpath = Path(config["DATABASE"])
    if not dbpath.exists():
        errors.append("Database is missing; run init-db.")
    else:
        conn = connect(dbpath)
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                errors.append("Database integrity check failed.")
            if conn.execute("PRAGMA foreign_key_check").fetchone():
                errors.append("Database contains invalid references.")
            owners = conn.execute("SELECT count(*) FROM users WHERE role='owner' AND active=1 AND totp_secret IS NOT NULL").fetchone()[0]
            if not owners:
                errors.append("Create at least one active owner with authenticator enrollment.")
            settings = dict(conn.execute("SELECT key,value FROM settings"))
            for key, label in (("whatsapp_number", "central WhatsApp number"),
                               ("booking_terms", "booking and cancellation terms"),
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
    for name, help_text in (("create-user", "Create an admin with password and authenticator enrollment"),
                            ("reset-user", "Explicitly replace an existing admin's password and authenticator")):
        user = commands.add_parser(name, help=help_text)
        user.add_argument("--email", required=True)
        user.add_argument("--role", choices=("owner", "dispatcher"), default=None)
    disabling = commands.add_parser("disable-user", help="Disable staff access, preserving the last active owner")
    disabling.add_argument("--email", required=True)
    serving = commands.add_parser("serve", help="Start the production Waitress server")
    serving.add_argument("--host", default=None)
    serving.add_argument("--port", type=int, default=None)
    copying = commands.add_parser("backup", help="Back up database and media; stop server first")
    copying.add_argument("--output", required=True, help="New ZIP destination outside the media directory")
    restoring = commands.add_parser("restore", help="Restore a verified ZIP backup; stop server first")
    restoring.add_argument("--input", required=True, help="Mestia ZIP backup")
    restoring.add_argument("--yes", action="store_true", help="Confirm replacement of database and media")
    commands.add_parser("check", help="Run local deployment preflight checks")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    # Help does not initialize the application. Real commands load its .env.
    from . import create_app
    try:
        app = create_app()
        database, media = app.config["DATABASE"], app.config["MEDIA_DIR"]
        if args.command == "init-db":
            conn = connect(database)
            try:
                init_db(conn)
            finally:
                conn.close()
            print("Database initialized. No default admin, services or bookings were created.")
        elif args.command in ("create-user", "reset-user", "disable-user"):
            conn = connect(database)
            try:
                if args.command == "disable-user":
                    _disable_user(conn, args.email)
                else:
                    _manage_user(conn, args)
            finally:
                conn.close()
        elif args.command == "serve":
            from waitress import serve
            host = args.host or os.environ.get("MESTIA_HOST", "127.0.0.1")
            port = args.port if args.port is not None else int(os.environ.get("PORT", "8000"))
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
