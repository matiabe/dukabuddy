"""One-time copy of an existing DukaBuddy SQLite database (dukabuddy.db) into PostgreSQL.

Usage (from the backend folder, with PostgreSQL running and DATABASE_URL set in .env):
    venv\\Scripts\\python migrate_sqlite_to_postgres.py --replace

--replace is required because the PostgreSQL tables are emptied first and then filled with the
SQLite data (keeping the same ids, so receipts, orders and history stay linked).
"""
import os
import sqlite3
import sys

# Importing app creates the PostgreSQL schema (and demo data if empty - which we replace below)
import app  # noqa: F401
from db import connect

# parents before children (foreign keys)
TABLES = ["products", "customers", "transactions", "sales", "restocks", "loyalty_points",
          "purchase_orders", "email_outbox", "automation_runs", "settings"]


def main():
    src_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dukabuddy.db")
    if "--replace" not in sys.argv:
        sys.exit("This replaces all PostgreSQL data with the SQLite data. Re-run with --replace to continue.")
    if not os.path.exists(src_path):
        sys.exit(f"No SQLite database found at {src_path}")

    src = sqlite3.connect(src_path)
    src.row_factory = sqlite3.Row
    have = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    dst = connect()
    try:
        dst.execute("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY CASCADE")
        for table in TABLES:
            if table not in have:
                print(f"  {table:16} (not in SQLite, skipped)")
                continue
            pg_cols = [r["column_name"] for r in dst.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position",
                (table,))]
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
            cols = [c for c in rows[0].keys() if c in pg_cols] if rows else []
            sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
            for r in rows:
                dst.execute(sql, [r[c] for c in cols])
            if "id" in pg_cols and rows:  # continue numbering after the copied ids
                dst.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), (SELECT MAX(id) FROM {table}))")
            print(f"  {table:16} {len(rows):5} rows")
        dst.commit()
        print("Done. PostgreSQL now holds your SQLite data. The old dukabuddy.db file was not changed.")
    except Exception:
        dst.rollback()
        raise
    finally:
        dst.close()
        src.close()


if __name__ == "__main__":
    main()
