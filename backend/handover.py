"""Cash sessions: money a staff member collects is sent to the boss, and the boss confirms it arrived.

* Every sale is attached to the seller's open session. A session opens by itself at the seller's first sale
  after the last handover, so no sale is ever left out.
* "Send to boss" closes the session: the totals are frozen (per payment method), and the seller records how much
  they are sending, how (cash handed over / M-Pesa / bank) and a reference such as the M-Pesa code.
* Money to send = everything collected except Credit sales (credit money hasn't been received yet).
* Owners get an SMS and see the handover on the Money Handover page, then mark it Received (with the amount that
  actually arrived) or Problem (with a note). Status: open -> sent -> received / problem.
"""
from flask import Blueprint, jsonify, request

import auth
import sms
from db import get_db

bp = Blueprint("handover", __name__)

SEND_METHODS = ("Cash", "M-Pesa", "Bank")
MAX_AMOUNT = 100_000_000

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS cash_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'received', 'problem')),
        opened_at TEXT NOT NULL DEFAULT local_now(),
        -- frozen when sent
        sales_count INTEGER,
        sales_total DOUBLE PRECISION,
        cash_total DOUBLE PRECISION,
        mpesa_total DOUBLE PRECISION,
        card_total DOUBLE PRECISION,
        credit_total DOUBLE PRECISION,
        expected DOUBLE PRECISION,  -- money collected = sales_total - credit_total
        amount_sent DOUBLE PRECISION,
        send_method TEXT,
        reference TEXT,
        note TEXT,
        sent_at TEXT,
        -- filled by the owner
        amount_received DOUBLE PRECISION,
        owner_note TEXT,
        checked_by TEXT,
        checked_at TEXT
    )""",
    # at most one open session per person
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_open ON cash_sessions (user_id) WHERE status = 'open'",
    "CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status)",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES cash_sessions(id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions (session_id)",
]


def init_handover(db):
    for stmt in SCHEMA:
        db.execute(stmt)
    db.commit()


def _money(value):
    try:
        amount = round(float(str(value).replace(",", "").strip()), 2)
    except (TypeError, ValueError):
        return None, "Enter a valid amount in KSh."
    if amount != amount or amount < 0:
        return None, "The amount cannot be negative."
    if amount > MAX_AMOUNT:
        return None, "That amount is too large."
    return amount, None


def _text(data, key, limit):
    return str(data.get(key) or "").strip()[:limit] or None


# ---------------------------------------------------------------- used by the till
def attach_sale(db, tid, user_id):
    """Put a just-recorded sale into the seller's open session (opening one if needed). Caller commits.

    FOR SHARE makes a concurrent "send" wait until this sale is committed (so it is counted), and if the send
    happened first the session is no longer 'open', so the sale goes into a fresh session instead."""
    for _ in range(3):
        db.execute("INSERT INTO cash_sessions (user_id) VALUES (?)"
                   " ON CONFLICT (user_id) WHERE status = 'open' DO NOTHING", (user_id,))
        row = db.execute("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'open' FOR SHARE",
                         (user_id,)).fetchone()
        if row:
            db.execute("UPDATE transactions SET session_id = ? WHERE id = ?", (row["id"], tid))
            return row["id"]
    return None


# ---------------------------------------------------------------- totals
def live_totals(db, sid):
    r = db.execute(
        "SELECT COUNT(*) AS sales_count, COALESCE(SUM(total), 0) AS sales_total,"
        " COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total END), 0) AS cash_total,"
        " COALESCE(SUM(CASE WHEN payment_method = 'M-Pesa' THEN total END), 0) AS mpesa_total,"
        " COALESCE(SUM(CASE WHEN payment_method = 'Card' THEN total END), 0) AS card_total,"
        " COALESCE(SUM(CASE WHEN payment_method = 'Credit' THEN total END), 0) AS credit_total,"
        " MIN(created_at) AS first_sale, MAX(created_at) AS last_sale"
        " FROM transactions WHERE session_id = ?", (sid,)).fetchone()
    d = dict(r)
    for k in ("sales_total", "cash_total", "mpesa_total", "card_total", "credit_total"):
        d[k] = round(d[k], 2)
    d["expected"] = round(d["sales_total"] - d["credit_total"], 2)
    return d


SESSION_QUERY = "SELECT s.*, u.name AS user_name FROM cash_sessions s JOIN users u ON u.id = s.user_id"


def session_dict(db, row):
    d = dict(row)
    if d["status"] == "open":
        d.update(live_totals(db, d["id"]))  # still changing: work it out from the sales
    else:
        d["shortage"] = round((d["expected"] or 0) - (d["amount_sent"] or 0), 2)
    return d


def _fetch(db, sid):
    row = db.execute(SESSION_QUERY + " WHERE s.id = ?", (sid,)).fetchone()
    return session_dict(db, row) if row else None


def _open_session(db, user_id):
    row = db.execute(SESSION_QUERY + " WHERE s.user_id = ? AND s.status = 'open'", (user_id,)).fetchone()
    return session_dict(db, row) if row else None


# ---------------------------------------------------------------- SMS to owners
def notify_sent(db, sid):
    s = _fetch(db, sid)
    if s is None:
        return
    owners = [u for u in sms.recipients(db) if u["role"] == "owner" and u["id"] != s["user_id"]]
    if not owners:
        return
    ref = f" ref {s['reference']}" if s["reference"] else ""
    short = f" SHORT by {sms.ksh(s['shortage'])}." if s["shortage"] > 0.5 else ""
    text = (f"{s['user_name']} sent you {sms.ksh(s['amount_sent'])} by {s['send_method']}{ref}."
            f" Collected {sms.ksh(s['expected'])} from {s['sales_count']} sale(s).{short}"
            " Open Money Handover to confirm.")
    sms.send(db, "handover", [(u, text) for u in owners], ref_key=f"handover:{sid}")


# ---------------------------------------------------------------- routes: everyone (see auth.STAFF_ALLOWED)
@bp.get("/api/handover/current")
def current():
    """My open session (live totals) and my recent handovers."""
    db = get_db()
    uid = auth.current_user()["id"]
    recent = db.execute(SESSION_QUERY + " WHERE s.user_id = ? AND s.status <> 'open'"
                        " ORDER BY s.sent_at DESC, s.id DESC LIMIT 20", (uid,)).fetchall()
    return jsonify(session=_open_session(db, uid), recent=[session_dict(db, r) for r in recent],
                   send_methods=SEND_METHODS)


@bp.post("/api/handover/send")
def send_to_boss():
    data = request.get_json(silent=True) or {}
    method = data.get("send_method")
    if method not in SEND_METHODS:
        return jsonify(error="Choose how you are sending the money: Cash, M-Pesa or Bank."), 400
    amount, err = _money(data.get("amount_sent"))
    if err:
        return jsonify(error=err), 400
    reference, note = _text(data, "reference", 40), _text(data, "note", 300)
    db = get_db()
    uid = auth.current_user()["id"]
    try:
        # lock: sales being recorded right now finish first and are included in the totals
        row = db.execute("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'open' FOR UPDATE",
                         (uid,)).fetchone()
        if row is None:
            db.rollback()
            return jsonify(error="You have no sales waiting to be sent."), 400
        sid = row["id"]
        t = live_totals(db, sid)
        if t["sales_count"] == 0:
            db.rollback()
            return jsonify(error="You have no sales waiting to be sent."), 400
        short = round(t["expected"] - amount, 2)
        if abs(short) > 0.5 and not note:
            db.rollback()
            word = "less" if short > 0 else "more"
            return jsonify(error=f"You are sending {word} than you collected ({sms.ksh(t['expected'])})."
                                 " Write a note explaining why."), 400
        db.execute(
            "UPDATE cash_sessions SET status = 'sent', sales_count = ?, sales_total = ?, cash_total = ?,"
            " mpesa_total = ?, card_total = ?, credit_total = ?, expected = ?, amount_sent = ?, send_method = ?,"
            " reference = ?, note = ?, sent_at = local_now() WHERE id = ?",
            (t["sales_count"], t["sales_total"], t["cash_total"], t["mpesa_total"], t["card_total"],
             t["credit_total"], t["expected"], amount, method, reference, note, sid))
        db.commit()
    except Exception:
        db.rollback()
        raise
    sms.in_background(notify_sent, sid)
    return jsonify(_fetch(db, sid))


# ---------------------------------------------------------------- routes: owner only
@bp.get("/api/handover")
def list_handovers():
    """Waiting for the boss to confirm, money still with staff (open sessions), and the history."""
    db = get_db()
    status = request.args.get("status")
    where, params = "s.status <> 'open'", []
    if status in ("sent", "received", "problem"):
        where, params = "s.status = ?", [status]
    rows = db.execute(SESSION_QUERY + f" WHERE {where} ORDER BY (s.status = 'sent') DESC, s.sent_at DESC, s.id DESC"
                      " LIMIT 200", params).fetchall()
    opened = db.execute(SESSION_QUERY + " WHERE s.status = 'open' ORDER BY u.name").fetchall()
    open_sessions = [d for d in (session_dict(db, r) for r in opened) if d["sales_count"] > 0]
    p = db.execute("SELECT COUNT(*) AS count, COALESCE(SUM(amount_sent), 0) AS amount FROM cash_sessions"
                   " WHERE status = 'sent'").fetchone()
    return jsonify(handovers=[session_dict(db, r) for r in rows], open_sessions=open_sessions,
                   pending={"count": p["count"], "amount": round(p["amount"], 2)},
                   with_staff=round(sum(s["expected"] for s in open_sessions), 2))


@bp.get("/api/handover/<int:sid>")
def handover_detail(sid):
    db = get_db()
    s = _fetch(db, sid)
    if s is None:
        return jsonify(error="Handover not found."), 404
    sales = db.execute(
        "SELECT t.id, t.total, t.payment_method, t.created_at, c.name AS customer_name FROM transactions t"
        " LEFT JOIN customers c ON c.id = t.customer_id WHERE t.session_id = ? ORDER BY t.created_at, t.id",
        (sid,)).fetchall()
    return jsonify(handover=s, sales=[{**dict(r), "receipt_no": f"DB-{r['id']:05d}"} for r in sales])


@bp.post("/api/handover/<int:sid>/confirm")
def confirm(sid):
    """status=received (amount_received, default the amount sent) or status=problem (note required)."""
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("received", "problem"):
        return jsonify(error="Mark the money as received, or report a problem."), 400
    note = _text(data, "note", 300)
    db = get_db()
    row = db.execute("SELECT status, amount_sent FROM cash_sessions WHERE id = ?", (sid,)).fetchone()
    if row is None:
        return jsonify(error="Handover not found."), 404
    if row["status"] == "open":
        return jsonify(error="This money has not been sent yet."), 400
    received = None
    if status == "received":
        raw = data.get("amount_received")
        received, err = _money(row["amount_sent"] if raw in (None, "") else raw)
        if err:
            return jsonify(error=err), 400
        if abs(received - row["amount_sent"]) > 0.5 and not note:
            return jsonify(error="The amount received is different from the amount sent. Write a note."), 400
    elif not note:
        return jsonify(error="Write what the problem is, e.g. money not yet received."), 400
    db.execute("UPDATE cash_sessions SET status = ?, amount_received = ?, owner_note = ?, checked_by = ?,"
               " checked_at = local_now() WHERE id = ?",
               (status, received, note, auth.current_user()["name"], sid))
    db.commit()
    return jsonify(_fetch(db, sid))
