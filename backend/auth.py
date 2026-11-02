"""Logins and roles for NyamsComm.

* Two roles: owner (everything) and staff (till, sales history, products, customers, receiving stock).
* Sessions are signed Flask cookies. The user row is re-checked on every request, so deactivating a user or
  changing their password logs them out everywhere (session_version).
* Staff never receive cost/profit figures: they are removed from every JSON response (scrub_costs).
* The very first visit shows a setup screen that creates the owner account (only while no users exist).
"""
import re
import secrets
import time
from datetime import timedelta

from flask import Blueprint, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from db import IntegrityError, get_db

bp = Blueprint("auth", __name__)

ROLES = ("owner", "staff")
MIN_PASSWORD = 6
SESSION_HOURS = 12

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        session_version INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    # who served each sale
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)",
]

# Requests staff may make (method, path regex). Everything else under /api needs the owner role.
STAFF_ALLOWED = [
    ("GET", r"/api/products"),
    ("GET", r"/api/products/low-stock"),
    ("POST", r"/api/products/\d+/restock"),
    ("GET", r"/api/sales"),
    ("POST", r"/api/sales"),
    ("POST", r"/api/transactions"),
    ("GET", r"/api/transactions(/\d+)?"),
    ("GET", r"/api/loyalty/rules"),
    ("GET", r"/api/overview"),
    ("GET", r"/api/customers(/\d+)?"),
    ("POST", r"/api/customers"),
    ("POST", r"/api/auth/password"),
]
PUBLIC = [("GET", r"/api/health"), ("GET", r"/api/auth/me"), ("POST", r"/api/auth/(login|logout|setup)")]
COST_KEYS = {"buying_price", "unit_cost", "profit", "suggested_cost", "total_cost", "margin_pct", "cost",
             "stock_cost_value"}


def init_auth(app, db):
    for stmt in SCHEMA:
        db.execute(stmt)
    row = db.execute("SELECT value FROM settings WHERE key = 'secret_key'").fetchone()
    if row is None:
        key = secrets.token_hex(32)
        db.execute("INSERT INTO settings (key, value) VALUES ('secret_key', ?)", (key,))
    else:
        key = row[0]
    app.secret_key = key
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_NAME="dukabuddy_session",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=SESSION_HOURS),
    )
    app.before_request(require_login)
    app.after_request(scrub_costs)


def _matches(rules):
    return any(request.method == m and re.fullmatch(p, request.path) for m, p in rules)


def current_user():
    if "user" not in g:
        g.user = None
        uid = session.get("uid")
        if uid:
            row = get_db().execute("SELECT * FROM users WHERE id = ? AND active", (uid,)).fetchone()
            if row and row["session_version"] == session.get("ver"):
                g.user = dict(row)
    return g.user


def require_login():
    if not request.path.startswith("/api/") or request.method == "OPTIONS" or _matches(PUBLIC):
        return None
    user = current_user()
    if user is None:
        return jsonify(error="Please log in.", login_required=True), 401
    if user["role"] != "owner" and not _matches(STAFF_ALLOWED):
        return jsonify(error="Only the shop owner can do this."), 403
    return None


def _scrub(value):
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if k not in COST_KEYS}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def scrub_costs(response):
    user = g.get("user")
    if user and user["role"] != "owner" and response.is_json and request.path.startswith("/api/"):
        response.set_data(jsonify(_scrub(response.get_json())).get_data())
    return response


def public_user(u):
    return {k: u[k] for k in ("id", "username", "name", "role", "phone", "active", "last_login_at", "created_at")}


def _start_session(u):
    session.clear()
    session.permanent = True
    session["uid"], session["ver"] = u["id"], u["session_version"]
    get_db().execute("UPDATE users SET last_login_at = local_now() WHERE id = ?", (u["id"],))
    get_db().commit()


# ---------------- login throttling (per username + client IP, in memory) ----------------
# Docker Desktop on Windows shows every device with the same address, so counting per IP alone would let one
# person's typos lock out the whole shop. Counting per username keeps a lockout to the account being guessed.
_failures = {}
MAX_FAILURES, LOCK_SECONDS = 5, 300


def _locked(key):
    recent = [t for t in _failures.get(key, []) if time.time() - t < LOCK_SECONDS]
    if recent:
        _failures[key] = recent
    else:
        _failures.pop(key, None)
    return len(recent) >= MAX_FAILURES


def _validate(data, require_password=True):
    name = str(data.get("name") or "").strip()
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    role = data.get("role", "staff")
    if not name:
        return None, "Enter the person's name."
    if not re.fullmatch(r"[a-z0-9._-]{3,30}", username):
        return None, "Username: 3-30 letters or numbers (no spaces)."
    if (require_password or password) and len(password) < MIN_PASSWORD:
        return None, f"Password must be at least {MIN_PASSWORD} characters."
    if role not in ROLES:
        return None, "Role must be owner or staff."
    phone = str(data.get("phone") or "").strip()
    if phone:
        from sms import normalize_phone  # local import keeps auth free of the SMS module at load time
        phone = normalize_phone(phone)
        if not phone:
            return None, "Phone: enter a Kenyan mobile number, e.g. 0712 345 678."
    return {"name": name, "username": username, "password": password, "role": role, "phone": phone or None}, None


def _shop_name(db):
    from automation import get_settings  # imported here: automation imports nothing from auth
    return get_settings(db)["shop_name"]


# ---------------- routes ----------------
@bp.get("/api/auth/me")
def me():
    db = get_db()
    setup = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    user = current_user()
    return jsonify(user=public_user(user) if user else None, setup_required=setup, shop_name=_shop_name(db))


@bp.post("/api/auth/setup")
def setup():
    """Create the first owner account. Only works while there are no users at all."""
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
        return jsonify(error="Setup is already done. Log in instead."), 409
    data, err = _validate({**(request.get_json(silent=True) or {}), "role": "owner"})
    if err:
        return jsonify(error=err), 400
    uid = db.execute("INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, 'owner')",
                     (data["username"], data["name"], generate_password_hash(data["password"]))).lastrowid
    db.commit()
    u = dict(db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())
    _start_session(u)
    return jsonify(user=public_user(u))


@bp.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip().lower()
    key = f"{request.remote_addr or '?'}|{username}"
    if _locked(key):
        return jsonify(error="Too many wrong passwords for this username. Wait 5 minutes and try again."), 429
    row = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], str(data.get("password") or "")):
        _failures.setdefault(key, []).append(time.time())
        return jsonify(error="Wrong username or password."), 401
    if not row["active"]:
        return jsonify(error="This account has been switched off. Ask the owner."), 403
    _failures.pop(key, None)
    _start_session(dict(row))
    return jsonify(user=public_user(row))


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@bp.post("/api/auth/password")
def change_password():
    user = current_user()
    data = request.get_json(silent=True) or {}
    if not check_password_hash(user["password_hash"], str(data.get("current_password") or "")):
        return jsonify(error="Current password is wrong."), 400
    new = str(data.get("new_password") or "")
    if len(new) < MIN_PASSWORD:
        return jsonify(error=f"New password must be at least {MIN_PASSWORD} characters."), 400
    db = get_db()
    db.execute("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
               (generate_password_hash(new), user["id"]))
    db.commit()
    _start_session({**user, "session_version": user["session_version"] + 1})  # stay logged in on this device
    return jsonify(ok=True)


@bp.get("/api/users")
def list_users():
    rows = get_db().execute("SELECT * FROM users ORDER BY active DESC, role, name").fetchall()
    return jsonify([public_user(r) for r in rows])


@bp.post("/api/users")
def add_user():
    data, err = _validate(request.get_json(silent=True) or {})
    if err:
        return jsonify(error=err), 400
    db = get_db()
    try:
        uid = db.execute("INSERT INTO users (username, name, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)",
                         (data["username"], data["name"], generate_password_hash(data["password"]),
                          data["role"], data["phone"])).lastrowid
        db.commit()
    except IntegrityError:
        return jsonify(error=f"Username '{data['username']}' is already taken."), 409
    return jsonify(public_user(db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())), 201


@bp.put("/api/users/<int:uid>")
def update_user(uid):
    """Change name/role, switch an account on/off, or set a new password (owner resetting a staff password)."""
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None:
        return jsonify(error="User not found."), 404
    body = request.get_json(silent=True) or {}
    data, err = _validate({"name": body.get("name", row["name"]), "username": row["username"],
                           "password": body.get("password") or "", "role": body.get("role", row["role"]),
                           "phone": body.get("phone", row["phone"])},
                          require_password=False)
    if err:
        return jsonify(error=err), 400
    active = bool(body.get("active", row["active"]))
    other_owners = db.execute("SELECT COUNT(*) FROM users WHERE role = 'owner' AND active AND id <> ?",
                              (uid,)).fetchone()[0]
    if row["role"] == "owner" and (data["role"] != "owner" or not active) and other_owners == 0:
        return jsonify(error="There must always be at least one active owner."), 400
    # changing role/password or switching off logs the person out of every device
    bump = data["password"] or data["role"] != row["role"] or not active
    db.execute(
        "UPDATE users SET name = ?, role = ?, phone = ?, active = ?, session_version = session_version + ?"
        + (", password_hash = ?" if data["password"] else "") + " WHERE id = ?",
        (data["name"], data["role"], data["phone"], active, 1 if bump else 0)
        + ((generate_password_hash(data["password"]),) if data["password"] else ()) + (uid,))
    db.commit()
    return jsonify(public_user(db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()))
