"""PostgreSQL access for NyamsComm (used by app.py, automation.py and reports.py).

A thin wrapper over the pure-Python pg8000 driver so the rest of the code can:
  * use `?` placeholders,
  * read rows by column name or position (row["name"], row[0]) and call dict(row),
  * get the new id of an INSERT via cursor.lastrowid,
  * catch db.IntegrityError for unique/foreign-key violations.
"""
import os
import re
import urllib.parse
from datetime import datetime

import pg8000.dbapi as pg
from dotenv import load_dotenv
from flask import g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)  # .env edits apply on reload

pg.paramstyle = "qmark"  # pg8000 reads this module-wide setting: use `?` placeholders

# DUKABUDDY_TEST_DATABASE_URL (set only by test runs) wins over the .env value
DATABASE_URL = (os.getenv("DUKABUDDY_TEST_DATABASE_URL") or
                os.getenv("DATABASE_URL", "postgresql://dukabuddy:dukabuddy_dev@127.0.0.1:5432/dukabuddy"))

# Tables with a SERIAL `id` column: INSERTs into these get `RETURNING id` added automatically
ID_TABLES = {"products", "sales", "restocks", "customers", "loyalty_points", "transactions",
             "purchase_orders", "email_outbox", "automation_runs", "users",
            "debts", "debt_entries"}
INSERT_RE = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.IGNORECASE)


class IntegrityError(Exception):
    """Unique / foreign-key / check constraint violated (SQLSTATE class 23)."""


class DatabaseError(Exception):
    pass


class Row(dict):
    """Dict row that also supports positional access like sqlite3.Row."""

    def __init__(self, columns, values):
        super().__init__(zip(columns, values))
        self._values = values

    def __getitem__(self, key):
        return self._values[key] if isinstance(key, int) else super().__getitem__(key)


class Cursor:
    def __init__(self, rows, rowcount, lastrowid=None):
        self._rows, self.rowcount, self.lastrowid = rows, rowcount, lastrowid

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        m = INSERT_RE.match(sql)
        want_id = bool(m) and m.group(1).lower() in ID_TABLES and "RETURNING" not in sql.upper()
        if want_id:
            sql = sql.rstrip().rstrip(";") + " RETURNING id"
        cur = self._raw.cursor()
        try:
            cur.execute(sql, tuple(params))
        except pg.DatabaseError as e:
            # a failed statement aborts the PostgreSQL transaction - roll back so the connection stays usable
            self._raw.rollback()
            info = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            message = info.get("M", str(e))
            if str(info.get("C", "")).startswith("23"):
                raise IntegrityError(message) from e
            raise DatabaseError(f"{message} [SQL: {sql.strip()[:200]}]") from e
        rows = []
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = [Row(cols, list(r)) for r in cur.fetchall()]
        lastrowid = rows[0][0] if want_id and rows else None
        return Cursor(rows, cur.rowcount, lastrowid)

    def executemany(self, sql, seq):
        for params in seq:
            self.execute(sql, params)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def connect():
    """A standalone connection (also used by background jobs outside a request)."""
    u = urllib.parse.urlparse(DATABASE_URL)
    raw = pg.connect(
        user=urllib.parse.unquote(u.username or ""), password=urllib.parse.unquote(u.password or ""),
        host=u.hostname or "127.0.0.1", port=u.port or 5432, database=(u.path or "/dukabuddy").lstrip("/"),
        timeout=15,
    )
    db = Connection(raw)
    # Match the server's clock to this computer's local time (all timestamps are local shop time)
    offset = datetime.now().astimezone().utcoffset()
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    db.execute(f"SET TIME ZONE INTERVAL '{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}' HOUR TO MINUTE")
    db.commit()
    return db


def get_db():
    """Per-request connection."""
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# Helper SQL function used everywhere instead of SQLite's datetime('now', 'localtime', ...):
#   local_now()            -> '2026-10-31 16:05:09'
#   local_now('-7 days')   -> same format, 7 days ago
LOCAL_NOW_FUNCTION = """
CREATE OR REPLACE FUNCTION local_now(shift text DEFAULT '0 seconds') RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT to_char(localtimestamp + shift::interval, 'YYYY-MM-DD HH24:MI:SS')
$$
"""
