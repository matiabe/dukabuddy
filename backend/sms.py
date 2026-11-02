"""SMS alerts to the boss and staff via Africa's Talking (https://africastalking.com).

* Every active user with a phone number gets: an SMS for each sale, an SMS when a product drops to its
  reorder level, and an evening summary of the day.
* Staff messages never contain profit (same rule as the web app); owners get profit in the daily summary.
* Sending runs in a background thread so the till is never slowed down by the SMS service.
* Without AT_USERNAME / AT_API_KEY in backend/.env, messages are only saved to the SMS log (status "logged").
"""
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from flask import Blueprint, jsonify, request

from db import connect, get_db

log = logging.getLogger("dukabuddy.sms")
bp = Blueprint("sms", __name__)

SCHEMA = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT",
    """CREATE TABLE IF NOT EXISTS sms_outbox (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        ref_key TEXT,
        user_id INTEGER REFERENCES users(id),
        to_name TEXT,
        to_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('sent', 'logged', 'failed')),
        cost TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sms_ref ON sms_outbox (ref_key)",
]
# Africa's Talking per-recipient status codes that mean the message was accepted
AT_OK = {100, 101, 102}


def init_sms(db):
    for stmt in SCHEMA:
        db.execute(stmt)
    db.commit()


# ---------------------------------------------------------------- phone numbers
def normalize_phone(raw):
    """Kenyan numbers in any common form -> +2547XXXXXXXX / +2541XXXXXXXX. Returns None if not valid."""
    digits = re.sub(r"[^\d+]", "", str(raw or ""))
    if digits.startswith("+"):
        digits = digits[1:]
    if re.fullmatch(r"0[17]\d{8}", digits):
        digits = "254" + digits[1:]
    elif re.fullmatch(r"[17]\d{8}", digits):
        digits = "254" + digits
    return "+" + digits if re.fullmatch(r"254[17]\d{8}", digits) else None


# ---------------------------------------------------------------- Africa's Talking
def at_config():
    username = os.getenv("AT_USERNAME", "").strip()
    api_key = os.getenv("AT_API_KEY", "").strip()
    return {
        "configured": bool(username and api_key),
        "username": username,
        "api_key": api_key,
        "sender_id": os.getenv("AT_SENDER_ID", "").strip(),
        "sandbox": username == "sandbox",
    }


def _at_send(cfg, phones, message):
    """One API call for many numbers. Returns {phone: (ok, cost, error)}."""
    host = "api.sandbox.africastalking.com" if cfg["sandbox"] else "api.africastalking.com"
    params = {"username": cfg["username"], "to": ",".join(phones), "message": message}
    if cfg["sender_id"]:
        params["from"] = cfg["sender_id"]
    req = urllib.request.Request(
        f"https://{host}/version1/messaging", data=urllib.parse.urlencode(params).encode(), method="POST",
        headers={"apiKey": cfg["api_key"], "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            data = json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        err = f"Africa's Talking error {e.code}: {e.read().decode(errors='replace')[:200]}"
        return {p: (False, None, err) for p in phones}
    except Exception as e:  # no internet, DNS, timeout...
        return {p: (False, None, f"Could not reach Africa's Talking: {e}"[:300]) for p in phones}
    out = {}
    for r in (data.get("SMSMessageData") or {}).get("Recipients") or []:
        ok = r.get("statusCode") in AT_OK
        out[r.get("number")] = (ok, r.get("cost"), None if ok else r.get("status") or "Rejected")
    summary = (data.get("SMSMessageData") or {}).get("Message") or "No response for this number"
    return {p: out.get(p, (False, None, summary)) for p in phones}


def recipients(db):
    """Active users with a valid phone number."""
    rows = db.execute("SELECT id, name, role, phone FROM users WHERE active AND phone IS NOT NULL AND phone <> ''"
                      " ORDER BY id").fetchall()
    return [dict(r) for r in rows if normalize_phone(r["phone"])]


def already_sent(db, ref_key):
    return db.execute("SELECT 1 FROM sms_outbox WHERE ref_key = ? AND status IN ('sent', 'logged')",
                      (ref_key,)).fetchone() is not None


def send(db, kind, messages, ref_key=None):
    """messages: list of (user dict, text). Groups identical texts into one API call; logs every recipient."""
    cfg = at_config()
    by_text = {}
    for user, text in messages:
        by_text.setdefault(text, []).append(user)
    results = []
    for text, users in by_text.items():
        phones = [normalize_phone(u["phone"]) for u in users]
        res = _at_send(cfg, phones, text) if cfg["configured"] else {
            p: (None, None, "SMS not set up (AT_USERNAME / AT_API_KEY) - saved to log only.") for p in phones}
        for u, phone in zip(users, phones):
            ok, cost, error = res[phone]
            status = "logged" if ok is None else "sent" if ok else "failed"
            if status == "failed":
                log.warning("SMS to %s failed: %s", phone, error)
            db.execute(
                "INSERT INTO sms_outbox (kind, ref_key, user_id, to_name, to_phone, message, status, cost, error)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (kind, ref_key, u.get("id"), u.get("name"), phone, text, status, cost, error))
            results.append({"name": u.get("name"), "phone": phone, "status": status, "error": error})
    db.commit()
    return results


def in_background(fn, *args):
    """Run fn(db, *args) on its own connection in a thread, so the HTTP request returns immediately."""
    def run():
        db = connect()
        try:
            fn(db, *args)
        except Exception:
            log.exception("SMS job %s failed", fn.__name__)
        finally:
            db.close()
    threading.Thread(target=run, name=f"sms-{fn.__name__}", daemon=True).start()


# ---------------------------------------------------------------- messages
def ksh(n):
    return f"KSh {n:,.0f}"


def _settings(db):
    from automation import get_settings  # local import: automation doesn't import sms
    return get_settings(db)


def notify_sale(db, tid):
    """SMS for one sale, plus a low-stock SMS for any product this sale pushed down to its reorder level."""
    s = _settings(db)
    people = recipients(db)
    if not people:
        return
    tx = db.execute("SELECT t.*, u.name AS served_by FROM transactions t LEFT JOIN users u ON u.id = t.user_id"
                    " WHERE t.id = ?", (tid,)).fetchone()
    if tx is None:
        return
    items = db.execute(
        "SELECT p.id, p.name, p.quantity AS stock, p.reorder_level, SUM(s.quantity) AS qty FROM sales s"
        " JOIN products p ON p.id = s.product_id WHERE s.transaction_id = ? GROUP BY p.id ORDER BY MIN(s.id)",
        (tid,)).fetchall()
    shop = s["shop_name"].split()[0] if s["shop_name"] else "Shop"

    if s["sms_sales"] and not already_sent(db, f"sale:{tid}"):
        lines = ", ".join(f"{r['qty']}x {r['name']}" for r in items)
        if len(lines) > 70:
            lines = lines[:67] + "..."
        cut = f", reduced from {ksh(tx['total'] + tx['price_cut'])}" if tx["price_cut"] else ""
        text = (f"{shop}: Sale DB-{tid:05d} {ksh(tx['total'])} ({tx['payment_method']}{cut}) - {lines}."
                f" By {tx['served_by'] or 'unknown'}, {tx['created_at'][11:16]}")
        send(db, "sale", [(u, text) for u in people], ref_key=f"sale:{tid}")

    if s["sms_low_stock"]:
        today = datetime.now().strftime("%Y-%m-%d")
        for r in items:
            # only when THIS sale crossed a line (reorder level, or zero), so one product doesn't trigger
            # an SMS on every later sale
            before = r["stock"] + r["qty"]
            if r["stock"] <= 0 < before:
                key, state = f"out:{r['id']}:{today}", "OUT OF STOCK"
            elif r["stock"] <= r["reorder_level"] < before:
                key, state = f"low:{r['id']}:{today}", f"LOW STOCK: only {r['stock']} left"
            else:
                continue
            if not already_sent(db, key):
                text = f"{shop}: {state} - {r['name']} (reorder level {r['reorder_level']}). Please restock."
                send(db, "low_stock", [(u, text) for u in people], ref_key=key)


def daily_summary(db, day=None, force=False):
    """Evening summary for `day` (YYYY-MM-DD, default today). Owners also get profit."""
    day = day or datetime.now().strftime("%Y-%m-%d")
    key = f"summary:{day}"
    if not force and already_sent(db, key):
        return []
    people = recipients(db)
    if not people:
        return []
    s = _settings(db)
    t = db.execute("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue FROM transactions"
                   " WHERE left(created_at, 10) = ?", (day,)).fetchone()
    profit = db.execute("SELECT COALESCE(SUM(s.total - COALESCE(s.unit_cost, 0) * s.quantity), 0) FROM sales s"
                        " JOIN transactions t ON t.id = s.transaction_id WHERE left(t.created_at, 10) = ?",
                        (day,)).fetchone()[0]
    top = db.execute("SELECT p.name, SUM(s.quantity) AS units FROM sales s JOIN transactions t"
                     " ON t.id = s.transaction_id JOIN products p ON p.id = s.product_id"
                     " WHERE left(t.created_at, 10) = ? GROUP BY p.id ORDER BY units DESC LIMIT 1", (day,)).fetchone()
    low = db.execute("SELECT COUNT(*) FROM products WHERE quantity <= reorder_level").fetchone()[0]
    shop = s["shop_name"].split()[0] if s["shop_name"] else "Shop"
    base = f"{shop} {day[8:10]}/{day[5:7]}: {t['n']} sale(s), total {ksh(t['revenue'])}"
    tail = (f". Top: {top['name'][:30]} ({top['units']})" if top else "") + f". Low stock items: {low}."
    msgs = [(u, base + (f", profit {ksh(profit)}" if u["role"] == "owner" else "") + tail) for u in people]
    return send(db, "summary", msgs, ref_key=key)


# ---------------------------------------------------------------- evening summary timer
_started = False


def start_summary_timer():
    """Checks every 5 minutes; sends today's summary once the configured hour has passed."""
    global _started
    if _started:
        return
    _started = True

    def loop():
        time.sleep(30)
        while True:
            try:
                db = connect()
                try:
                    s = _settings(db)
                    if s["sms_daily_summary"] and datetime.now().hour >= s["sms_summary_hour"]:
                        daily_summary(db)
                finally:
                    db.close()
            except Exception:
                log.exception("SMS summary check failed")
            time.sleep(300)

    threading.Thread(target=loop, name="sms-summary", daemon=True).start()


# ---------------------------------------------------------------- routes (owner only: not in STAFF_ALLOWED)
@bp.get("/api/sms/status")
def api_status():
    db = get_db()
    cfg = at_config()
    users = db.execute("SELECT name, phone FROM users WHERE active ORDER BY name").fetchall()
    return jsonify(configured=cfg["configured"], sandbox=cfg["sandbox"], sender_id=cfg["sender_id"],
                   recipients=[{"name": u["name"], "phone": normalize_phone(u["phone"])} for u in users
                               if normalize_phone(u["phone"])],
                   missing_phone=[u["name"] for u in users if not normalize_phone(u["phone"])])


@bp.get("/api/sms/log")
def api_log():
    rows = get_db().execute("SELECT * FROM sms_outbox ORDER BY id DESC LIMIT 200").fetchall()
    return jsonify([dict(r) for r in rows])


@bp.post("/api/sms/test")
def api_test():
    db = get_db()
    people = recipients(db)
    if not people:
        return jsonify(error="Nobody has a phone number yet. Add numbers on the Staff accounts page."), 400
    shop = _settings(db)["shop_name"]
    return jsonify(results=send(db, "test", [(u, f"{shop}: test SMS for {u['name']}. Alerts are working.")
                                             for u in people]))


@bp.post("/api/sms/summary")
def api_summary_now():
    """Send today's summary right now (owner button)."""
    results = daily_summary(get_db(), (request.get_json(silent=True) or {}).get("day"), force=True)
    if not results:
        return jsonify(error="Nobody has a phone number yet."), 400
    return jsonify(results=results)
