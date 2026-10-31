"""Shared SQLite helpers (used by app.py, automation.py and reports.py)."""
import os
import sqlite3

from dotenv import load_dotenv
from flask import g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)  # .env edits apply on reload

DB_PATH = os.getenv("DUKABUDDY_DB") or os.path.join(BASE_DIR, "dukabuddy.db")


def connect():
    """A standalone connection (for background jobs outside a request)."""
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
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
