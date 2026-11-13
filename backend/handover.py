"""Money sent to the boss: a simple log that staff fill in themselves.

* Whenever a staff member sends money to the boss they record it here: the amount, how (cash handed over,
  M-Pesa or bank), the M-Pesa code / reference, the date and an optional note.
* Nothing is worked out from sales and there is nothing to confirm - it is just a record, with running totals
  for today, this week (from Monday) and this month.
* Staff see their own records; owners see everyone's, with a total per person. Owners get an SMS for each one.
* Mistakes: staff can delete a record they made on the same day; owners can delete any record.
"""
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

import auth
import sms
from db import get_db

bp = Blueprint("handover", __name__)

SEND_METHODS = ("Cash", "M-Pesa", "Bank")
MAX_AMOUNT = 100_000_000

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS money_sent (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        send_method TEXT NOT NULL,
        reference TEXT,
        note TEXT,
        sent_on TEXT NOT NULL,  -- YYYY-MM-DD, the day the money was sent
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_money_sent_day ON money_sent (sent_on)",
    "CREATE INDEX IF NOT EXISTS idx_money_sent_user ON money_sent (user_id, sent_on)",
]


def init_handover(db):
    for stmt in SCHEMA:
        db.execute(stmt)
    # One-time copy of handovers recorded with the earlier version (cash_sessions), if any.
    if db.execute("SELECT to_regclass('cash_sessions') IS NOT NULL").fetchone()[0] and \
            db.execute("SELECT 1 FROM money_sent LIMIT 1").fetchone() is None:
        db.execute(
            "INSERT INTO money_sent (user_id, amount, send_method, reference, note, sent_on, created_at)"
            " SELECT user_id, amount_sent, send_method, reference, note, left(sent_at, 10), sent_at"
            " FROM cash_sessions WHERE status <> 'open' AND amount_sent > 0 ORDER BY sent_at, id")
    db.commit()


def _today(db):
    return date.fromisoformat(db.execute("SELECT left(local_now(), 10)").fetchone()[0])


def _is_owner():
    return auth.current_user()["role"] == "owner"


ROW_QUERY = "SELECT m.*, u.name AS user_name FROM money_sent m JOIN users u ON u.id = m.user_id"


def _totals(db, user_id, today):
    """Total sent today / this week (Monday on) / this month / all time, for one person or everyone."""
    where, params = ("WHERE user_id = ?", [user_id]) if user_id else ("", [])
    week = (today - timedelta(days=today.weekday())).isoformat()
    month = today.replace(day=1).isoformat()
    r = db.execute(
        "SELECT"
        " COALESCE(SUM(CASE WHEN sent_on = ? THEN amount END), 0) AS today,"
        " COUNT(CASE WHEN sent_on = ? THEN 1 END) AS today_count,"
        " COALESCE(SUM(CASE WHEN sent_on >= ? THEN amount END), 0) AS week,"
        " COALESCE(SUM(CASE WHEN sent_on >= ? THEN amount END), 0) AS month,"
        f" COALESCE(SUM(amount), 0) AS all_time FROM money_sent {where}",
        [today.isoformat(), today.isoformat(), week, month] + params).fetchone()
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in dict(r).items()}


# ---------------------------------------------------------------- SMS to owners
def notify_sent(db, mid):
    row = db.execute(ROW_QUERY + " WHERE m.id = ?", (mid,)).fetchone()
    if row is None:
        return
    owners = [u for u in sms.recipients(db) if u["role"] == "owner" and u["id"] != row["user_id"]]
    if not owners:
        return
    ref = f" ref {row['reference']}" if row["reference"] else ""
    text = f"{row['user_name']} recorded sending you {sms.ksh(row['amount'])} by {row['send_method']}{ref}."
    sms.send(db, "handover", [(u, text) for u in owners], ref_key=f"money_sent:{mid}")


# ---------------------------------------------------------------- routes (staff: see auth.STAFF_ALLOWED)
@bp.get("/api/handover")
def list_sent():
    """Staff: their own records. Owners: everyone's, or one person's with ?user_id=."""
    db = get_db()
    me = auth.current_user()
    today = _today(db)
    if _is_owner():
        uid = request.args.get("user_id", type=int)
    else:
        uid = me["id"]
    where, params = ("WHERE m.user_id = ?", [uid]) if uid else ("", [])
    rows = db.execute(ROW_QUERY + f" {where} ORDER BY m.sent_on DESC, m.id DESC LIMIT 300", params).fetchall()
    entries = []
    for r in rows:
        d = dict(r)
        d["can_delete"] = _is_owner() or (d["user_id"] == me["id"] and d["created_at"][:10] == today.isoformat())
        entries.append(d)
    out = dict(entries=entries, totals=_totals(db, uid, today), send_methods=SEND_METHODS, today=today.isoformat())
    if _is_owner():
        month = today.replace(day=1).isoformat()
        people = db.execute(
            "SELECT u.id, u.name, COUNT(m.id) AS count,"
            " COALESCE(SUM(CASE WHEN m.sent_on >= ? THEN m.amount END), 0) AS month,"
            " COALESCE(SUM(m.amount), 0) AS all_time, MAX(m.sent_on) AS last_sent"
            " FROM users u JOIN money_sent m ON m.user_id = u.id GROUP BY u.id, u.name ORDER BY u.name",
            (month,)).fetchall()
        out["people"] = [dict(p) for p in people]
    return jsonify(out)


@bp.post("/api/handover")
def record_sent():
    data = request.get_json(silent=True) or {}
    method = data.get("send_method")
    if method not in SEND_METHODS:
        return jsonify(error="Choose how you sent the money: Cash, M-Pesa or Bank."), 400
    try:
        amount = round(float(str(data.get("amount")).replace(",", "").strip()), 2)
    except (TypeError, ValueError):
        return jsonify(error="Enter the amount you sent in KSh."), 400
    if amount != amount or amount <= 0:
        return jsonify(error="The amount must be more than 0."), 400
    if amount > MAX_AMOUNT:
        return jsonify(error="That amount is too large."), 400
    db = get_db()
    today = _today(db)
    raw_day = str(data.get("sent_on") or "").strip()
    try:
        day = date.fromisoformat(raw_day) if raw_day else today
    except ValueError:
        return jsonify(error="Enter a valid date."), 400
    if day > today:
        return jsonify(error="The date cannot be in the future."), 400
    reference = str(data.get("reference") or "").strip()[:40] or None
    note = str(data.get("note") or "").strip()[:300] or None
    mid = db.execute(
        "INSERT INTO money_sent (user_id, amount, send_method, reference, note, sent_on) VALUES (?, ?, ?, ?, ?, ?)",
        (auth.current_user()["id"], amount, method, reference, note, day.isoformat())).lastrowid
    db.commit()
    sms.in_background(notify_sent, mid)
    return jsonify(dict(db.execute(ROW_QUERY + " WHERE m.id = ?", (mid,)).fetchone())), 201


@bp.delete("/api/handover/<int:mid>")
def delete_sent(mid):
    db = get_db()
    row = db.execute("SELECT user_id, created_at FROM money_sent WHERE id = ?", (mid,)).fetchone()
    if row is None:
        return jsonify(error="Record not found."), 404
    if not _is_owner():
        if row["user_id"] != auth.current_user()["id"]:
            return jsonify(error="You can only delete your own records."), 403
        if row["created_at"][:10] != _today(db).isoformat():
            return jsonify(error="You can only delete a record on the day you made it. Ask the boss to fix it."), 403
    db.execute("DELETE FROM money_sent WHERE id = ?", (mid,))
    db.commit()
    return jsonify(ok=True)
