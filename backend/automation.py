"""DukaBuddy automation: product performance tracking, auto-restock purchase orders,
email alerts (SMTP or in-app outbox) and the background scheduler."""
import html
import logging
import os
import smtplib
import threading
import time
from datetime import datetime, timedelta
from email.message import EmailMessage

from flask import Blueprint, jsonify, request

from db import connect, get_db

log = logging.getLogger("dukabuddy.automation")
bp = Blueprint("automation", __name__)

# ---------------------------------------------------------------- settings
DEFAULT_SETTINGS = {
    "shop_name": "Mama Wanjiku's Duka",
    "owner_email": os.getenv("OWNER_EMAIL", ""),
    "auto_restock": "1",          # create purchase orders automatically for established products
    "new_product_days": "14",     # products younger than this need owner verification before restocking
    "dead_stock_days": "30",      # in stock but unsold for this long = dead stock
    "slow_cover_days": "60",      # more than this many days of stock at current sales rate = slow mover
    "analysis_days": "30",        # performance window
    "alert_low_stock": "1",
    "alert_dead_stock": "1",
    "monthly_report": "1",
}
SETTING_TYPES = {k: ("bool" if v in ("0", "1") else "int" if v.isdigit() else "str") for k, v in DEFAULT_SETTINGS.items()}
SETTING_TYPES["owner_email"] = "str"


def init_automation(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS purchase_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            unit_cost REAL NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending_review', 'ordered', 'received', 'cancelled')),
            source TEXT NOT NULL DEFAULT 'auto',
            reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            ref_key TEXT,
            to_addr TEXT,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            attachments TEXT,
            status TEXT NOT NULL CHECK (status IN ('sent', 'logged', 'failed')),
            error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS automation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        """
    )
    for k, v in DEFAULT_SETTINGS.items():
        db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
    db.commit()


def get_settings(db):
    raw = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings")}
    out = {}
    for k, default in DEFAULT_SETTINGS.items():
        v = raw.get(k, default)
        t = SETTING_TYPES[k]
        out[k] = (v == "1") if t == "bool" else int(v) if t == "int" else v
    return out


# ---------------------------------------------------------------- helpers
def now():
    return datetime.now()


def parse_ts(ts):
    return datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S") if ts else None


def ksh(n):
    return f"KSh {n:,.0f}"


# ---------------------------------------------------------------- performance analytics
CLASS_ORDER = ["Top performer", "Steady", "New", "Slow mover", "Dead stock", "No stock, no sales"]


def performance(db, days=None, settings=None, start=None, end=None):
    """Rank every product best -> worst by gross profit in the window and classify it."""
    s = settings or get_settings(db)
    end = end or now()
    if start is None:
        days = days or s["analysis_days"]
        start = end - timedelta(days=days)
    days = max((end - start).days, 1)
    fmt = "%Y-%m-%d %H:%M:%S"
    rows = db.execute(
        """
        SELECT p.*, COALESCE(w.units, 0) AS units, COALESCE(w.revenue, 0) AS revenue,
               COALESCE(w.profit, 0) AS profit, COALESCE(w.receipts, 0) AS receipts, l.last_sold_at
        FROM products p
        LEFT JOIN (
            SELECT product_id, SUM(quantity) AS units, SUM(total) AS revenue,
                   SUM(total - COALESCE(unit_cost, 0) * quantity) AS profit, COUNT(DISTINCT transaction_id) AS receipts
            FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY product_id
        ) w ON w.product_id = p.id
        LEFT JOIN (SELECT product_id, MAX(created_at) AS last_sold_at FROM sales GROUP BY product_id) l
            ON l.product_id = p.id
        """,
        (start.strftime(fmt), end.strftime(fmt)),
    ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        created = parse_ts(d["created_at"]) or end
        last = parse_ts(d["last_sold_at"])
        d["days_in_store"] = max((end - created).days, 0)
        d["days_since_sale"] = (end - last).days if last else None
        d["daily_rate"] = round(d["units"] / days, 2)
        d["days_of_cover"] = round(d["quantity"] / d["daily_rate"], 1) if d["daily_rate"] > 0 else None
        d["stock_value"] = d["quantity"] * d["buying_price"]
        d["margin_pct"] = round(d["profit"] / d["revenue"] * 100, 1) if d["revenue"] else 0
        items.append(d)

    items.sort(key=lambda d: (d["profit"], d["revenue"], d["units"]), reverse=True)
    sellers = [d for d in items if d["units"] > 0]
    top_n = max(1, round(len(sellers) * 0.2)) if sellers else 0
    top_ids = {d["id"] for d in sellers[:top_n]}

    for rank, d in enumerate(items, 1):
        d["rank"] = rank
        idle = d["days_since_sale"] if d["days_since_sale"] is not None else d["days_in_store"]
        if d["days_in_store"] < s["new_product_days"]:
            cls, why = "New", f"Added {d['days_in_store']} days ago - verify demand before restocking"
        elif d["quantity"] > 0 and idle >= s["dead_stock_days"]:
            cls, why = "Dead stock", f"No sale in {idle} days; {ksh(d['stock_value'])} tied up"
        elif d["id"] in top_ids:
            cls, why = "Top performer", f"Top 20% by profit ({ksh(d['profit'])})"
        elif d["units"] == 0 and d["quantity"] == 0:
            cls, why = "No stock, no sales", "Out of stock and not selling"
        elif d["units"] == 0 or (d["days_of_cover"] or 0) > s["slow_cover_days"]:
            cover = f"{d['days_of_cover']:.0f} days of stock" if d["days_of_cover"] else "no recent sales"
            cls, why = "Slow mover", f"{cover} at current rate"
        else:
            cls, why = "Steady", f"Selling {d['daily_rate']}/day"
        d["classification"], d["insight"] = cls, why

    summary = {c: sum(1 for d in items if d["classification"] == c) for c in CLASS_ORDER}
    return {
        "products": items,
        "summary": summary,
        "dead_stock_value": sum(d["stock_value"] for d in items if d["classification"] == "Dead stock"),
        "slow_stock_value": sum(d["stock_value"] for d in items if d["classification"] == "Slow mover"),
        "window": {"start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d"), "days": days},
    }


def new_product_check(db, settings=None):
    """For products newer than new_product_days: project demand from early sales and recommend."""
    s = settings or get_settings(db)
    out = []
    for d in performance(db, settings=s)["products"]:
        if d["classification"] != "New":
            continue
        age = max(d["days_in_store"], 1)
        sold = db.execute(
            "SELECT COALESCE(SUM(quantity), 0) FROM sales WHERE product_id = ? AND created_at >= ?",
            (d["id"], d["created_at"]),
        ).fetchone()[0]
        rate = sold / age
        cover = d["quantity"] / rate if rate > 0 else None
        if sold == 0 and age < 3:
            rec, detail = "Wait", "Too early - no sales data yet. Check again in a few days."
        elif sold == 0:
            rec, detail = "Do not restock", f"No sales in {age} days. Consider a promotion before buying more."
        elif d["quantity"] <= d["reorder_level"] or (cover is not None and cover <= 7):
            rec, detail = "Restock", f"Selling {rate:.1f}/day - only {cover or 0:.0f} days of stock left."
        else:
            rec, detail = "Not yet", f"Selling {rate:.1f}/day - about {cover:.0f} days of stock left."
        qty = max(round(rate * 14) - d["quantity"], d["reorder_level"] * 2 - d["quantity"], 1) if rec == "Restock" else 0
        out.append({
            "id": d["id"], "name": d["name"], "category": d["category"], "quantity": d["quantity"],
            "reorder_level": d["reorder_level"], "days_in_store": d["days_in_store"], "units_sold": sold,
            "daily_rate": round(rate, 2), "days_of_cover": round(cover, 1) if cover else None,
            "recommendation": rec, "detail": detail, "suggested_qty": qty,
            "suggested_cost": qty * d["buying_price"], "open_order": open_order(db, d["id"]),
        })
    return out


# ---------------------------------------------------------------- purchase orders
def open_order(db, product_id):
    r = db.execute(
        "SELECT id, status, quantity FROM purchase_orders WHERE product_id = ? AND status IN ('pending_review', 'ordered')"
        " ORDER BY id DESC LIMIT 1", (product_id,)).fetchone()
    return dict(r) if r else None


def order_quantity(db, p):
    sold_14 = db.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM sales WHERE product_id = ?"
        " AND created_at >= datetime('now', 'localtime', '-14 days')", (p["id"],)).fetchone()[0]
    # cover ~2 weeks of demand, at least twice the reorder level
    return max(max(p["reorder_level"] * 2, sold_14) - p["quantity"], 1)


def create_po(db, product, qty, status, source, reason):
    cur = db.execute(
        "INSERT INTO purchase_orders (product_id, quantity, unit_cost, status, source, reason) VALUES (?, ?, ?, ?, ?, ?)",
        (product["id"], qty, product["buying_price"], status, source, reason))
    return cur.lastrowid


PO_QUERY = """
    SELECT o.*, p.name AS product_name, p.quantity AS current_stock, p.reorder_level,
           o.quantity * o.unit_cost AS total_cost
    FROM purchase_orders o JOIN products p ON p.id = o.product_id
"""


def receive_po(db, po):
    db.execute("UPDATE products SET quantity = quantity + ? WHERE id = ?", (po["quantity"], po["product_id"]))
    db.execute("INSERT INTO restocks (product_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?)",
               (po["product_id"], po["quantity"], po["unit_cost"], po["quantity"] * po["unit_cost"]))
    db.execute("UPDATE purchase_orders SET status = 'received', updated_at = datetime('now', 'localtime') WHERE id = ?",
               (po["id"],))


# ---------------------------------------------------------------- email
def smtp_config():
    host = os.getenv("SMTP_HOST", "").strip()
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").replace(" ", "")  # Gmail shows app passwords with spaces
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587") or 587),
        "user": user,
        "password": password,
        "from": os.getenv("SMTP_FROM", "").strip() or user,
        # a login user without a password can't send yet - keep alerts in the outbox until it's added
        "configured": bool(host) and (not user or bool(password)),
    }


def email_layout(shop, title, inner):
    return f"""<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1e293b">
      <div style="background:#059669;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <b style="font-size:18px">DukaBuddy</b><br><span style="font-size:13px">{html.escape(shop)}</span></div>
      <div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 8px 8px">
        <h2 style="margin-top:0;font-size:18px">{html.escape(title)}</h2>{inner}
        <p style="color:#94a3b8;font-size:12px;margin-top:24px">Sent automatically by DukaBuddy on
        {now().strftime('%d %b %Y, %H:%M')}.</p></div></div>"""


def email_table(headers, rows):
    th = "".join(f'<th style="text-align:left;padding:6px 8px;background:#f1f5f9;font-size:12px">{html.escape(h)}</th>'
                 for h in headers)
    trs = "".join("<tr>" + "".join(f'<td style="padding:6px 8px;border-top:1px solid #e2e8f0;font-size:13px">'
                                   f"{html.escape(str(c))}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table style="border-collapse:collapse;width:100%">{th and "<tr>" + th + "</tr>"}{trs}</table>'


def send_email(db, kind, subject, body_html, ref_key=None, attachments=None, dedupe_hours=None):
    """Send via SMTP if configured, else store in the outbox. Returns outbox row id, or None if deduped."""
    if ref_key and dedupe_hours is not None:
        dup = db.execute(
            "SELECT 1 FROM email_outbox WHERE ref_key = ? AND status IN ('sent', 'logged')"
            " AND created_at >= datetime('now', 'localtime', ?)", (ref_key, f"-{dedupe_hours} hours")).fetchone()
        if dup:
            return None
    s = get_settings(db)
    to = s["owner_email"].strip()
    cfg = smtp_config()
    status, error = "logged", None
    if cfg["configured"] and to:
        msg = EmailMessage()
        msg["Subject"] = f"[DukaBuddy] {subject}"
        msg["From"] = cfg["from"] or "dukabuddy@localhost"
        msg["To"] = to
        msg.set_content("This email contains HTML. Please view it in an HTML-capable email client.")
        msg.add_alternative(body_html, subtype="html")
        for name, data, mime in attachments or []:
            maintype, subtype = mime.split("/", 1)
            msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
        try:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as smtp:
                smtp.ehlo()
                if cfg["port"] != 25:
                    smtp.starttls()
                    smtp.ehlo()
                if cfg["user"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
            status = "sent"
        except Exception as e:  # keep the alert in the outbox even if sending fails
            status, error = "failed", str(e)[:300]
            log.warning("Email send failed: %s", e)
    elif not to:
        error = "No owner email set (Alerts & Settings)."
    else:
        error = "SMTP not configured - saved to outbox only."
    cur = db.execute(
        "INSERT INTO email_outbox (kind, ref_key, to_addr, subject, body_html, attachments, status, error)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (kind, ref_key, to, subject, body_html, ", ".join(a[0] for a in attachments or []) or None, status, error))
    db.commit()
    return cur.lastrowid


# ---------------------------------------------------------------- the automation run
def run_automation(db, trigger="scheduler"):
    s = get_settings(db)
    shop = s["shop_name"]
    summary = {"orders_created": 0, "needs_review": 0, "alerts": 0, "monthly_report": None}

    # 1. Low stock -> purchase orders (auto for established products, review for new ones)
    perf = {d["id"]: d for d in performance(db, settings=s)["products"]}
    low = db.execute("SELECT * FROM products WHERE quantity <= reorder_level ORDER BY name").fetchall()
    created = []
    for p in low:
        if open_order(db, p["id"]):
            continue
        is_new = perf[p["id"]]["classification"] == "New"
        if perf[p["id"]]["classification"] == "Dead stock":
            continue  # don't buy more of something that isn't selling
        qty = order_quantity(db, p)
        if is_new:
            status, reason = "pending_review", "New product - owner to verify demand before ordering"
        elif s["auto_restock"]:
            status, reason = "ordered", f"Auto: stock {p['quantity']} at/below reorder level {p['reorder_level']}"
        else:
            status, reason = "pending_review", f"Stock {p['quantity']} at/below reorder level {p['reorder_level']}"
        po_id = create_po(db, p, qty, status, "auto", reason)
        created.append((po_id, p, qty, status))
    db.commit()
    summary["orders_created"] = sum(1 for c in created if c[3] == "ordered")
    summary["needs_review"] = sum(1 for c in created if c[3] == "pending_review")

    if created and s["alert_low_stock"]:
        rows = [(f"PO-{po:04d}", p["name"], p["quantity"], qty, ksh(qty * p["buying_price"]),
                 "Ordered (auto)" if st == "ordered" else "Needs your review") for po, p, qty, st in created]
        total = sum(qty * p["buying_price"] for _, p, qty, _ in created)
        body = email_layout(shop, "Restock orders created", (
            f"<p>{len(created)} product(s) reached their reorder level. DukaBuddy prepared these purchase orders "
            f"(estimated total <b>{ksh(total)}</b>):</p>"
            + email_table(["Order", "Product", "In stock", "Order qty", "Est. cost", "Status"], rows)
            + "<p>Open <b>Auto Restock</b> in DukaBuddy to approve new-product orders and mark deliveries as received.</p>"))
        if send_email(db, "low_stock", f"{len(created)} restock order(s) created", body,
                      ref_key="po:" + ",".join(str(c[0]) for c in created)):
            summary["alerts"] += 1

    # 2. Dead stock digest (at most once a week)
    if s["alert_dead_stock"]:
        dead = [d for d in perf.values() if d["classification"] == "Dead stock"]
        if dead:
            week = now().strftime("%G-W%V")
            rows = [(d["name"], d["quantity"], d["days_since_sale"] if d["days_since_sale"] is not None else
                     f"never ({d['days_in_store']}d in store)", ksh(d["stock_value"])) for d in dead]
            body = email_layout(shop, "Products not selling (dead stock)", (
                f"<p>These products have been on the shelf for {s['dead_stock_days']}+ days without a sale, "
                f"tying up <b>{ksh(sum(d['stock_value'] for d in dead))}</b>. Consider a discount, bundle or "
                f"stopping re-orders.</p>"
                + email_table(["Product", "In stock", "Days since last sale", "Value at cost"], rows)))
            if send_email(db, "dead_stock", f"{len(dead)} product(s) not selling", body,
                          ref_key=f"dead:{week}", dedupe_hours=24 * 7):
                summary["alerts"] += 1

    # 3. Monthly performance report for last month (once)
    if s["monthly_report"]:
        from reports import send_monthly_report  # local import avoids a cycle
        first = now().replace(day=1)
        last_month = (first - timedelta(days=1)).strftime("%Y-%m")
        already = db.execute("SELECT 1 FROM email_outbox WHERE ref_key = ? AND status IN ('sent', 'logged')",
                             (f"monthly:{last_month}",)).fetchone()
        if not already:
            send_monthly_report(db, last_month)
            summary["monthly_report"] = last_month
            summary["alerts"] += 1

    import json
    db.execute("INSERT INTO automation_runs (trigger, summary) VALUES (?, ?)", (trigger, json.dumps(summary)))
    db.commit()
    return summary


# ---------------------------------------------------------------- scheduler
_scheduler_started = False


def start_scheduler(interval_minutes=None):
    """Background thread that runs the automation periodically (first run ~15s after start)."""
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    interval = interval_minutes or int(os.getenv("AUTOMATION_INTERVAL_MINUTES", "60"))

    def loop():
        time.sleep(15)
        while True:
            try:
                db = connect()
                try:
                    log.info("Automation run: %s", run_automation(db))
                finally:
                    db.close()
            except Exception:
                log.exception("Automation run failed")
            time.sleep(interval * 60)

    threading.Thread(target=loop, name="dukabuddy-scheduler", daemon=True).start()
    log.info("Scheduler started (every %s min)", interval)


# ---------------------------------------------------------------- routes
@bp.get("/api/performance")
def api_performance():
    db = get_db()
    days = request.args.get("days", type=int)
    return jsonify(performance(db, days=days))


@bp.get("/api/settings")
def api_get_settings():
    db = get_db()
    cfg = smtp_config()
    return jsonify(settings=get_settings(db), smtp={k: cfg[k] for k in ("configured", "host", "port", "from")},
                   interval_minutes=int(os.getenv("AUTOMATION_INTERVAL_MINUTES", "60")))


@bp.put("/api/settings")
def api_put_settings():
    db = get_db()
    data = request.get_json(silent=True) or {}
    for k, v in data.items():
        if k not in DEFAULT_SETTINGS:
            continue
        t = SETTING_TYPES[k]
        if t == "bool":
            v = "1" if v in (True, "1", 1, "true") else "0"
        elif t == "int":
            try:
                v = str(max(1, min(int(v), 3650)))
            except (TypeError, ValueError):
                return jsonify(error=f"{k.replace('_', ' ')} must be a number."), 400
        else:
            v = str(v).strip()[:200]
            if k == "owner_email" and v and ("@" not in v or "." not in v.split("@")[-1]):
                return jsonify(error="Enter a valid owner email address."), 400
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (k, v))
    db.commit()
    return jsonify(settings=get_settings(db))


@bp.get("/api/purchase-orders")
def api_list_pos():
    db = get_db()
    status = request.args.get("status")
    sql = PO_QUERY + (" WHERE o.status = ?" if status else "") + " ORDER BY o.id DESC LIMIT 200"
    rows = [dict(r) for r in db.execute(sql, (status,) if status else ()).fetchall()]
    for r in rows:
        r["po_no"] = f"PO-{r['id']:04d}"
    counts = {r["status"]: r["n"] for r in db.execute("SELECT status, COUNT(*) AS n FROM purchase_orders GROUP BY status")}
    return jsonify(orders=rows, counts=counts)


@bp.post("/api/purchase-orders")
def api_create_po():
    db = get_db()
    data = request.get_json(silent=True) or {}
    try:
        pid, qty = int(data["product_id"]), int(data["quantity"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Choose a product and a valid quantity."), 400
    if qty <= 0:
        return jsonify(error="Quantity must be greater than zero."), 400
    p = db.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if p is None:
        return jsonify(error="Product not found."), 404
    if open_order(db, pid):
        return jsonify(error=f"{p['name']} already has an open order."), 409
    po = create_po(db, p, qty, "ordered", "manual", data.get("reason") or "Created by owner")
    db.commit()
    return jsonify(id=po), 201


def _po_action(po_id, allowed, fn):
    db = get_db()
    po = db.execute("SELECT * FROM purchase_orders WHERE id = ?", (po_id,)).fetchone()
    if po is None:
        return jsonify(error="Order not found."), 404
    if po["status"] not in allowed:
        return jsonify(error=f"Order is already {po['status'].replace('_', ' ')}."), 400
    err = fn(db, po)
    if err:
        return jsonify(error=err), 400
    db.commit()
    return jsonify(ok=True)


@bp.post("/api/purchase-orders/<int:po_id>/approve")
def api_approve_po(po_id):
    data = request.get_json(silent=True) or {}

    def fn(db, po):
        qty = data.get("quantity")
        if qty not in (None, ""):
            try:
                qty = int(qty)
            except (TypeError, ValueError):
                return "Enter a valid quantity."
            if qty <= 0:
                return "Quantity must be greater than zero."
            db.execute("UPDATE purchase_orders SET quantity = ? WHERE id = ?", (qty, po["id"]))
        db.execute("UPDATE purchase_orders SET status = 'ordered', updated_at = datetime('now', 'localtime')"
                   " WHERE id = ?", (po["id"],))
    return _po_action(po_id, ("pending_review",), fn)


@bp.post("/api/purchase-orders/<int:po_id>/receive")
def api_receive_po(po_id):
    return _po_action(po_id, ("ordered",), lambda db, po: receive_po(db, po))


@bp.post("/api/purchase-orders/<int:po_id>/cancel")
def api_cancel_po(po_id):
    def fn(db, po):
        db.execute("UPDATE purchase_orders SET status = 'cancelled', updated_at = datetime('now', 'localtime')"
                   " WHERE id = ?", (po["id"],))
    return _po_action(po_id, ("pending_review", "ordered"), fn)


@bp.get("/api/automation/new-products")
def api_new_products():
    return jsonify(new_product_check(get_db()))


@bp.post("/api/automation/run")
def api_run():
    return jsonify(run_automation(get_db(), trigger="manual"))


@bp.get("/api/automation/status")
def api_status():
    db = get_db()
    last = db.execute("SELECT * FROM automation_runs ORDER BY id DESC LIMIT 1").fetchone()
    return jsonify(last_run=dict(last) if last else None)


@bp.get("/api/alerts")
def api_alerts():
    rows = get_db().execute(
        "SELECT id, kind, to_addr, subject, attachments, status, error, created_at FROM email_outbox"
        " ORDER BY id DESC LIMIT 100").fetchall()
    return jsonify([dict(r) for r in rows])


@bp.get("/api/alerts/<int:aid>")
def api_alert(aid):
    r = get_db().execute("SELECT * FROM email_outbox WHERE id = ?", (aid,)).fetchone()
    return (jsonify(dict(r)), 200) if r else (jsonify(error="Not found."), 404)


@bp.post("/api/alerts/test")
def api_test_email():
    db = get_db()
    s = get_settings(db)
    body = email_layout(s["shop_name"], "Test email", "<p>If you can read this, DukaBuddy email alerts are working.</p>")
    aid = send_email(db, "test", "Test email", body)
    r = db.execute("SELECT status, error, to_addr FROM email_outbox WHERE id = ?", (aid,)).fetchone()
    return jsonify(dict(r))
