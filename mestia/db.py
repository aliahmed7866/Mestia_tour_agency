"""SQLite persistence. All inventory decisions use an immediate transaction."""
import sqlite3


def connect(path):
    conn = sqlite3.connect(str(path), timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','dispatcher')),
 active INTEGER NOT NULL DEFAULT 1, totp_secret TEXT, totp_last_step INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS providers (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'owner',
 approved INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id),
 slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('tour','stay','taxi')),
 title_en TEXT NOT NULL, title_ka TEXT NOT NULL DEFAULT '',
 description_en TEXT NOT NULL DEFAULT '', description_ka TEXT NOT NULL DEFAULT '',
 details_en TEXT NOT NULL DEFAULT '', details_ka TEXT NOT NULL DEFAULT '',
 itinerary_en TEXT NOT NULL DEFAULT '', itinerary_ka TEXT NOT NULL DEFAULT '',
 inclusions_en TEXT NOT NULL DEFAULT '', inclusions_ka TEXT NOT NULL DEFAULT '',
 requirements_en TEXT NOT NULL DEFAULT '', requirements_ka TEXT NOT NULL DEFAULT '',
 photo_url TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL DEFAULT '', price_minor INTEGER CHECK(price_minor >= 0),
 currency TEXT NOT NULL DEFAULT 'GEL', price_basis TEXT NOT NULL DEFAULT '',
 duration TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT '',
 capacity INTEGER CHECK(capacity > 0), published INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS resources (
 id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id),
 name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('room','departure','guide','driver','vehicle')),
 capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity > 0),
 passenger_capacity INTEGER CHECK(passenger_capacity > 0),
 buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_minutes >= 0),
 buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_before_minutes >= 0),
 buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after_minutes >= 0),
 approved INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 details TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS enquiries (
 id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, token_hash TEXT UNIQUE,
 token_expires_at TEXT, idempotency_key TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','closed')),
 kind TEXT NOT NULL CHECK(kind IN ('tour','stay','taxi','combined')),
 service_id INTEGER REFERENCES services(id), name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 party_size INTEGER NOT NULL CHECK(party_size > 0), pickup TEXT NOT NULL DEFAULT '',
 destination TEXT NOT NULL DEFAULT '', luggage TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'website',
 language TEXT NOT NULL DEFAULT 'en', contact_verified_at TEXT, contact_evidence TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
 id INTEGER PRIMARY KEY, enquiry_id INTEGER NOT NULL REFERENCES enquiries(id),
 version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'offered'
 CHECK(status IN ('offered','accepted','expired','superseded','cancelled','confirmed')),
 currency TEXT NOT NULL, total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
 deposit_required_minor INTEGER NOT NULL DEFAULT 0 CHECK(deposit_required_minor >= 0),
 expires_at TEXT NOT NULL, terms TEXT NOT NULL, policy_version TEXT NOT NULL,
 accepted_at TEXT, acceptance_evidence TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, UNIQUE(enquiry_id,version)
);
CREATE TABLE IF NOT EXISTS quote_items (
 id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id),
 service_id INTEGER REFERENCES services(id), kind TEXT NOT NULL CHECK(kind IN ('tour','stay','taxi')),
 title TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
 total_minor INTEGER NOT NULL CHECK(total_minor >= 0), inclusions TEXT NOT NULL DEFAULT '',
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
 id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id),
 resource_id INTEGER NOT NULL REFERENCES resources(id), item_id INTEGER REFERENCES quote_items(id),
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
 shared_key TEXT NOT NULL DEFAULT '', service_id INTEGER REFERENCES services(id),
 origin TEXT NOT NULL DEFAULT 'quote' CHECK(origin IN ('quote','dispatch'))
);
CREATE INDEX IF NOT EXISTS allocation_resource_dates ON allocations(resource_id,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS availability_blocks (
 id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id),
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL UNIQUE REFERENCES quotes(id),
 enquiry_id INTEGER NOT NULL REFERENCES enquiries(id), reference TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','completed','cancelled','no_show')),
 operational_status TEXT NOT NULL DEFAULT 'ready' CHECK(operational_status IN ('ready','needs_attention')),
 confirmed_at TEXT NOT NULL, cancelled_at TEXT, cancellation_reason TEXT NOT NULL DEFAULT '',
 completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_booking_per_enquiry ON bookings(enquiry_id)
 WHERE status IN ('confirmed','completed','no_show');
CREATE TABLE IF NOT EXISTS assignments (
 id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id),
 driver_resource_id INTEGER NOT NULL REFERENCES resources(id),
 vehicle_resource_id INTEGER NOT NULL REFERENCES resources(id),
 fare_minor INTEGER NOT NULL CHECK(fare_minor >= 0),
 status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','en_route','completed','cancelled','unavailable','expired')),
 offered_at TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT,
 acceptance_evidence TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_assignment ON assignments(quote_id)
 WHERE status IN ('offered','accepted','en_route');
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
 kind TEXT NOT NULL CHECK(kind IN ('deposit','balance','refund')),
 method TEXT NOT NULL, reference TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 1,
 recorded_at TEXT NOT NULL, actor_id INTEGER REFERENCES users(id), verified_at TEXT,
 verification_evidence TEXT NOT NULL DEFAULT '', voided INTEGER NOT NULL DEFAULT 0,
 voided_at TEXT, void_evidence TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS change_requests (
 id INTEGER PRIMARY KEY, enquiry_id INTEGER NOT NULL REFERENCES enquiries(id),
 booking_id INTEGER REFERENCES bookings(id), kind TEXT NOT NULL CHECK(kind IN ('change','cancellation')),
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','declined')),
 created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
 id INTEGER PRIMARY KEY, enquiry_id INTEGER NOT NULL REFERENCES enquiries(id),
 due_at TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'due'
 CHECK(status IN ('due','done')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id),
 action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER,
 details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS enquiries_created ON enquiries(created_at);
CREATE INDEX IF NOT EXISTS quotes_expiry ON quotes(status,expires_at);
"""


def init_db(conn):
    conn.executescript(SCHEMA)
    seed_defaults(conn)


def seed_defaults(conn):
    """Only placeholder business settings; no invented services or availability."""
    defaults = {
        'business_name': 'Mestia Travel', 'business_name_ka': '',
        'whatsapp_number': '', 'contact_email': '', 'address': '',
        'operating_hours': '', 'response_note': '', 'currency': 'GEL',
        'timezone': 'Asia/Tbilisi', 'booking_terms': '', 'privacy_notice': '',
        'about_en': '', 'about_ka': '', 'policy_version': 'draft-1',
    }
    conn.executemany('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)', defaults.items())
    conn.execute("INSERT OR IGNORE INTO providers(id,name,kind,approved) VALUES (1,'Owner business','owner',1)")
