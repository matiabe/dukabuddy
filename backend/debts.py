"""Debtors & creditors book for NyamsComm.

* Debtors: customers who owe the shop money (goods taken on credit).
* Creditors: suppliers the shop owes money to (stock received but not yet paid for).
* Owner and staff can all add people, record more owed, record payments and correct a balance.
* Every change is kept as an entry (who, when, how much, balance after) so nothing is lost silently.
"""
from flask import Blueprint, jsonify, request

import auth
from db import get_db

bp = Blueprint("debts", __name__)

KINDS = ("debtor", "creditor")
ENTRY_TYPES = ("add", "payment", "adjust")  # adjust = set a corrected balance
MAX_AMOUNT = 100_000_000

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS debts (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('debtor', 'creditor')),
        name TEXT NOT NULL,
        phone TEXT,
        note TEXT,
        due_date TEXT,
        balance DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (balance >= 0),
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT local_now(),
        updated_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS debt_entries (
        id SERIAL PRIMARY KEY,
        debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('add', 'payment', 'adjust')),
        amount DOUBLE PRECISION NOT NULL,  -- change to the balance: + owed more, - paid / reduced
        balance_after DOUBLE PRECISION NOT NULL,
        note TEXT,
        user_name TEXT,
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_debt_entries_debt ON debt_entries (debt_id)",
]


def init_debts(db):
    for stmt in SCHEMA:
        db.execute(stmt)
    db.commit()


def _money(value, allow_zero=False):
    """Parse a KSh amount. Returns (amount, error)."""
    try:
        amount = round(float(str(value).replace(",", "").strip()), 2)
    except (TypeError, ValueError):
        return None, "Enter a valid amount in KSh."
    if amount != amount or amount < 0 or (amount == 0 and not allow_zero):
        return None, "Enter an amount above 0." if not allow_zero else "The amount cannot be negative."
    if amount > MAX_AMOUNT:
        return None, "That amount is too large."
    return amount, None


def _text(data, key, limit):
    return str(data.get(key) or "").strip()[:limit] or None


def _user_name():
    return auth.current_user()["name"]


def debt_dict(row):
    d = dict(row)
    d["balance"] = round(d["balance"], 2)
    return d


DEBT_QUERY = (
    "SELECT d.*, (SELECT MAX(e.created_at) FROM debt_entries e WHERE e.debt_id = d.id) AS last_activity,"
    " (SELECT COALESCE(SUM(-e.amount), 0) FROM debt_entries e WHERE e.debt_id = d.id AND e.type = 'payment')"
    " AS total_paid FROM debts d"
)


def fetch_debt(db, did):
    row = db.execute(DEBT_QUERY + " WHERE d.id = ?", (did,)).fetchone()
    return debt_dict(row) if row else None


@bp.get("/api/debts")
def list_debts():
    db = get_db()
    rows = db.execute(DEBT_QUERY + " ORDER BY (d.balance > 0) DESC, d.balance DESC, d.name").fetchall()
    debts = [debt_dict(r) for r in rows]
    totals = {k: {"owed": round(sum(d["balance"] for d in debts if d["kind"] == k), 2),
                  "open": sum(1 for d in debts if d["kind"] == k and d["balance"] > 0)} for k in KINDS}
    return jsonify(debts=debts, totals=totals)


@bp.post("/api/debts")
def add_debt():
    data = request.get_json(silent=True) or {}
    kind = data.get("kind")
    if kind not in KINDS:
        return jsonify(error="Choose debtor (customer owes us) or creditor (we owe a supplier)."), 400
    name = _text(data, "name", 120)
    if not name:
        return jsonify(error="Enter the name of the customer or supplier."), 400
    amount, err = _money(data.get("amount"))
    if err:
        return jsonify(error=err), 400
    db = get_db()
    user = _user_name()
    try:
        cur = db.execute(
            "INSERT INTO debts (kind, name, phone, note, due_date, balance, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (kind, name, _text(data, "phone", 30), _text(data, "note", 300), _text(data, "due_date", 10), amount, user))
        db.execute("INSERT INTO debt_entries (debt_id, type, amount, balance_after, note, user_name)"
                   " VALUES (?, 'add', ?, ?, ?, ?)",
                   (cur.lastrowid, amount, amount, _text(data, "entry_note", 200) or "Opening amount", user))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(fetch_debt(db, cur.lastrowid)), 201


@bp.get("/api/debts/<int:did>")
def debt_detail(did):
    db = get_db()
    debt = fetch_debt(db, did)
    if debt is None:
        return jsonify(error="Record not found. It may have been deleted."), 404
    entries = db.execute("SELECT * FROM debt_entries WHERE debt_id = ? ORDER BY created_at DESC, id DESC",
                         (did,)).fetchall()
    return jsonify(debt=debt, entries=[dict(e) for e in entries])


@bp.put("/api/debts/<int:did>")
def edit_debt(did):
    """Change name, phone, note or due date (the amount changes only through entries)."""
    data = request.get_json(silent=True) or {}
    name = _text(data, "name", 120)
    if not name:
        return jsonify(error="Enter the name of the customer or supplier."), 400
    db = get_db()
    cur = db.execute("UPDATE debts SET name = ?, phone = ?, note = ?, due_date = ?, updated_at = local_now()"
                     " WHERE id = ?",
                     (name, _text(data, "phone", 30), _text(data, "note", 300), _text(data, "due_date", 10), did))
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Record not found. It may have been deleted."), 404
    return jsonify(fetch_debt(db, did))


@bp.post("/api/debts/<int:did>/entries")
def add_entry(did):
    """type=add: they owe more; type=payment: money paid (reduces balance); type=adjust: set the correct balance."""
    data = request.get_json(silent=True) or {}
    etype = data.get("type")
    if etype not in ENTRY_TYPES:
        return jsonify(error="Choose what happened: more owed, a payment, or a corrected amount."), 400
    amount, err = _money(data.get("amount"), allow_zero=etype == "adjust")
    if err:
        return jsonify(error=err), 400
    note = _text(data, "note", 200)
    if etype == "adjust" and not note:
        return jsonify(error="Write why the amount is being corrected."), 400
    db = get_db()
    try:
        # lock the row so two people updating at the same moment can't overwrite each other
        row = db.execute("SELECT balance FROM debts WHERE id = ? FOR UPDATE", (did,)).fetchone()
        if row is None:
            db.rollback()
            return jsonify(error="Record not found. It may have been deleted."), 404
        balance = row["balance"]
        if etype == "add":
            new_balance = balance + amount
        elif etype == "payment":
            if amount > balance + 0.001:
                db.rollback()
                return jsonify(error=f"Payment is more than the balance of KSh {balance:,.2f}."), 400
            new_balance = balance - amount
        else:
            new_balance = amount
        new_balance = round(max(new_balance, 0), 2)
        delta = round(new_balance - balance, 2)
        if etype == "adjust" and delta == 0:
            db.rollback()
            return jsonify(error="That is already the balance."), 400
        if new_balance > MAX_AMOUNT:
            db.rollback()
            return jsonify(error="That amount is too large."), 400
        db.execute("UPDATE debts SET balance = ?, updated_at = local_now() WHERE id = ?", (new_balance, did))
        db.execute("INSERT INTO debt_entries (debt_id, type, amount, balance_after, note, user_name)"
                   " VALUES (?, ?, ?, ?, ?, ?)", (did, etype, delta, new_balance, note, _user_name()))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return jsonify(fetch_debt(db, did))


@bp.delete("/api/debts/<int:did>")
def delete_debt(did):
    """Only cleared records (balance 0) can be deleted, so an unpaid debt can't vanish by accident."""
    db = get_db()
    row = db.execute("SELECT balance FROM debts WHERE id = ?", (did,)).fetchone()
    if row is None:
        return jsonify(error="Record not found. It may already have been deleted."), 404
    if row["balance"] > 0:
        return jsonify(error="Only cleared records (balance KSh 0) can be deleted. Record the payment first."), 400
    db.execute("DELETE FROM debts WHERE id = ?", (did,))
    db.commit()
    return jsonify(ok=True)
