"""NyamsComm backend (electronics dealer edition) - Flask + PostgreSQL."""
import json
import os
import urllib.error
import urllib.request

from flask import Flask, Response, jsonify, request
from werkzeug.middleware.proxy_fix import ProxyFix

import auth
import automation
import product_import
import reports
import sms
from db import LOCAL_NOW_FUNCTION, IntegrityError, close_db, connect, get_db

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")

app = Flask(__name__)
# Behind the nginx container: trust its X-Forwarded-For so login throttling sees the real device IP
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
# DEMO_DATA=0 (set in docker-compose.yml) starts a real shop with no sample products/customers/sales
DEMO_DATA = os.getenv("DEMO_DATA", "1") != "0"

SAMPLE_PRODUCTS = [
    # name, category, buying_price, selling_price, quantity, reorder_level
    ("Samsung Galaxy A15 128GB", "Phones", 17500, 21000, 12, 4),
    ("Tecno Spark 20 128GB", "Phones", 13000, 15500, 3, 4),
    ("Infinix Hot 40i 128GB", "Phones", 12000, 14500, 10, 4),
    ("iPhone 13 128GB", "Phones", 72000, 82000, 2, 2),
    ("HP 250 G9 Laptop (Core i5, 8GB, 256GB SSD)", "Laptops", 52000, 60000, 5, 2),
    ("Oraimo FreePods 4 Earbuds", "Audio", 2600, 3500, 18, 6),
    ("JBL Flip 6 Bluetooth Speaker", "Audio", 11500, 14000, 6, 3),
    ('Hisense 43" Smart TV', "TVs", 28000, 33500, 7, 2),
    ("Samsung 25W Fast Charger", "Accessories", 1500, 2200, 4, 8),
    ("Anker USB-C Cable 1.8m", "Accessories", 550, 900, 40, 15),
    ("Oraimo 20000mAh Power Bank", "Accessories", 2300, 3200, 15, 6),
    ("Tempered Glass Screen Protector", "Accessories", 120, 400, 60, 20),
    ("Safaricom Airtime KSh 100", "Airtime", 95, 100, 50, 20),
    ("SanDisk 64GB microSD Card", "Storage", 750, 1200, 3, 6),
    ("Phone Back Cover (assorted)", "Accessories", 200, 500, 45, 15),
    ("Sony PlayStation 5 Slim", "Gaming", 68000, 78000, 2, 1),
]


app.teardown_appcontext(close_db)
app.register_blueprint(auth.bp)
app.register_blueprint(automation.bp)
app.register_blueprint(sms.bp)
app.register_blueprint(reports.bp)


SCHEMA = [
    LOCAL_NOW_FUNCTION,
    """CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'General',
        buying_price DOUBLE PRECISION NOT NULL CHECK (buying_price >= 0),
        selling_price DOUBLE PRECISION NOT NULL CHECK (selling_price >= 0),
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        reorder_level INTEGER NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        subtotal DOUBLE PRECISION NOT NULL,
        discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total DOUBLE PRECISION NOT NULL,
        items_count INTEGER NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Cash',
        amount_paid DOUBLE PRECISION NOT NULL,
        change_given DOUBLE PRECISION NOT NULL DEFAULT 0,
        points_earned INTEGER NOT NULL DEFAULT 0,
        points_redeemed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DOUBLE PRECISION NOT NULL,
        unit_cost DOUBLE PRECISION,  -- buying price at time of sale, for profit tracking
        total DOUBLE PRECISION NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        points_earned INTEGER NOT NULL DEFAULT 0,
        points_redeemed INTEGER NOT NULL DEFAULT 0,
        transaction_id INTEGER REFERENCES transactions(id),
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS restocks (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost DOUBLE PRECISION NOT NULL,
        total_cost DOUBLE PRECISION NOT NULL,
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    """CREATE TABLE IF NOT EXISTS loyalty_points (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        points INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'bonus')),
        reason TEXT,
        sale_id INTEGER REFERENCES sales(id),
        created_at TEXT NOT NULL DEFAULT local_now()
    )""",
    # indexes for the date filters and joins used by reports
    "CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sales_product ON sales (product_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_transaction ON sales (transaction_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions (customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_points (customer_id)",
]


def init_db():
    db = connect()
    try:
        for stmt in SCHEMA:
            db.execute(stmt)
        fresh = db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0
        if fresh and DEMO_DATA:
            db.executemany(
                "INSERT INTO products (name, category, buying_price, selling_price, quantity, reorder_level)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                SAMPLE_PRODUCTS,
            )
            # A few sample sales so the demo dashboard isn't empty (stock already reflects them)
            ids = {r["name"]: r["id"] for r in db.execute("SELECT id, name FROM products")}
            for idx, qty in [(1, 2), (3, 1), (6, 3), (15, 4), (7, 1), (13, 5)]:
                pid = ids[SAMPLE_PRODUCTS[idx - 1][0]]
                price = db.execute("SELECT selling_price FROM products WHERE id = ?", (pid,)).fetchone()[0]
                db.execute(
                    "INSERT INTO sales (product_id, quantity, unit_price, total) VALUES (?, ?, ?, ?)",
                    (pid, qty, price, price * qty),
                )
            if db.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0:
                seed_customers(db)
        automation.init_automation(db)
        if fresh and DEMO_DATA:
            seed_automation_demo(db)
        auth.init_auth(app, db)
        sms.init_sms(db)  # after users exist: adds users.phone
        backfill_transactions(db)
        db.commit()
    finally:
        db.close()


def seed_automation_demo(db):
    """One-time demo data for performance tracking: sample stock is 'established' (60 days old),
    plus three genuinely new products for the new-product restock check."""
    if db.execute("SELECT 1 FROM settings WHERE key = 'demo_automation_seeded'").fetchone():
        return
    names = [p[0] for p in SAMPLE_PRODUCTS]
    db.execute(
        f"UPDATE products SET created_at = local_now('-60 days') WHERE name IN ({','.join('?' * len(names))})"
        " AND created_at > local_now('-60 days')", names)
    new_products = [  # name, category, buy, sell, qty, reorder, days ago, [(days ago, qty) sales]
        ("Redmi Note 13 256GB", "Phones", 21000, 25500, 3, 3, 6, [(5, 1), (3, 1), (2, 2), (1, 1)]),
        ("Oraimo Watch 4 Plus Smartwatch", "Wearables", 3800, 5200, 10, 3, 10, []),
        ("TP-Link 4G LTE Router", "Networking", 6500, 8500, 4, 2, 1, []),
    ]
    for name, cat, buy, sell, qty, reorder, age, sales in new_products:
        if db.execute("SELECT 1 FROM products WHERE name = ?", (name,)).fetchone():
            continue
        pid = db.execute(
            "INSERT INTO products (name, category, buying_price, selling_price, quantity, reorder_level, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, local_now(?))",
            (name, cat, buy, sell, qty, reorder, f"-{age} days")).lastrowid
        for days_ago, q in sales:
            db.execute(
                "INSERT INTO sales (product_id, quantity, unit_price, unit_cost, total, created_at)"
                " VALUES (?, ?, ?, ?, ?, local_now(?))",
                (pid, q, sell, buy, sell * q, f"-{days_ago} days -2 hours"))
    db.execute("INSERT INTO settings (key, value) VALUES ('demo_automation_seeded', '1')")


def backfill_transactions(db):
    """Older single-item sales get their own receipt so all history shows up in Sales History."""
    db.execute("UPDATE sales SET unit_cost = (SELECT buying_price FROM products WHERE id = sales.product_id)"
               " WHERE unit_cost IS NULL")
    for s in db.execute("SELECT * FROM sales WHERE transaction_id IS NULL ORDER BY created_at, id").fetchall():
        tid = db.execute(
            "INSERT INTO transactions (customer_id, subtotal, discount, total, items_count, payment_method,"
            " amount_paid, points_earned, points_redeemed, created_at) VALUES (?, ?, ?, ?, ?, 'Cash', ?, ?, ?, ?)",
            (s["customer_id"], s["total"] + s["discount"], s["discount"], s["total"], s["quantity"], s["total"],
             s["points_earned"], s["points_redeemed"], s["created_at"]),
        ).lastrowid
        db.execute("UPDATE sales SET transaction_id = ? WHERE id = ?", (tid, s["id"]))


# ---------------- Loyalty rules ----------------
POINTS_PER_KSH = 100  # earn 1 point for every KSh 100 spent (x tier multiplier)
POINT_VALUE_KSH = 1  # 1 point = KSh 1 discount when redeemed
TIERS = [  # (name, minimum total spend in KSh, points multiplier) - highest first
    ("Gold", 150000, 2.0),
    ("Silver", 40000, 1.5),
    ("Bronze", 0, 1.0),
]
AT_RISK_DAYS = 21  # regular customer who hasn't visited in this many days


def tier_for(total_spent):
    for name, minimum, mult in TIERS:
        if total_spent >= minimum:
            return {"name": name, "multiplier": mult, "min_spend": minimum}


def next_tier(total_spent):
    nxt = None
    for name, minimum, _ in TIERS:
        if total_spent < minimum:
            nxt = {"name": name, "min_spend": minimum, "remaining": minimum - total_spent}
    return nxt


def customer_spend(db, customer_id):
    return db.execute("SELECT COALESCE(SUM(total), 0) FROM sales WHERE customer_id = ?", (customer_id,)).fetchone()[0]


def points_for(amount, total_spent_before):
    return int(amount // POINTS_PER_KSH * tier_for(total_spent_before)["multiplier"])


def seed_customers(db):
    """Sample loyal customers with ~6 weeks of shopping history (historical, doesn't touch current stock)."""
    import random
    from datetime import datetime, timedelta

    rng = random.Random(7)
    people = [  # name, phone, visits, favourite product ids
        ("Wanjiru Kamau", "0712345678", 22, [10, 12, 13, 15, 6]),
        ("Brian Otieno", "0723456789", 14, [15, 13, 9, 11]),
        ("Achieng Atieno", "0734567890", 9, [1, 10, 14, 7]),
        ("Kiprotich Kemboi", "0745678901", 6, [5, 8, 12]),
        ("Fatuma Hassan", "0756789012", 4, [16, 3, 12]),
        ("Mutua Musyoka", "0767890123", 3, [13, 15]),
    ]
    prices = {r[0]: r[1] for r in db.execute("SELECT id, selling_price FROM products")}
    now = datetime.now()
    for idx, (name, phone, visits, favs) in enumerate(people):
        cid = db.execute("INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)",
                         (name, phone, (now - timedelta(days=50)).strftime("%Y-%m-%d %H:%M:%S"))).lastrowid
        # Last two customers haven't visited recently -> show up as "at risk"
        latest = 30 if idx >= 4 else 1
        days = sorted((rng.randint(latest, 45) for _ in range(visits)), reverse=True)
        spent, points = 0, 0
        for d in days:
            pid = rng.choice(favs)
            qty = 1 if prices[pid] >= 10000 else rng.randint(1, 3)  # big-ticket items sell one at a time
            total = prices[pid] * qty
            earned = points_for(total, spent)
            ts = (now - timedelta(days=d, hours=rng.randint(0, 9))).strftime("%Y-%m-%d %H:%M:%S")
            sid = db.execute(
                "INSERT INTO sales (product_id, quantity, unit_price, total, customer_id, points_earned, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)", (pid, qty, prices[pid], total, cid, earned, ts)).lastrowid
            if earned:
                db.execute("INSERT INTO loyalty_points (customer_id, points, type, reason, sale_id, created_at)"
                           " VALUES (?, ?, 'earn', 'Purchase', ?, ?)", (cid, earned, sid, ts))
            spent += total
            points += earned
        db.execute("UPDATE customers SET points = ? WHERE id = ?", (points, cid))


# Products joined with their sales/restock tallies
PRODUCT_QUERY = """
    SELECT p.*,
        COALESCE(s.sales_count, 0) AS sales_count,
        COALESCE(s.units_sold, 0) AS units_sold,
        COALESCE(s.revenue, 0) AS revenue,
        COALESCE(s.units_sold_7d, 0) AS units_sold_7d,
        s.last_sold_at,
        r.last_restocked_at
    FROM products p
    LEFT JOIN (
        SELECT product_id, COUNT(*) AS sales_count, SUM(quantity) AS units_sold, SUM(total) AS revenue,
            SUM(CASE WHEN created_at >= local_now('-7 days') THEN quantity ELSE 0 END) AS units_sold_7d,
            MAX(created_at) AS last_sold_at
        FROM sales GROUP BY product_id
    ) s ON s.product_id = p.id
    LEFT JOIN (
        SELECT product_id, MAX(created_at) AS last_restocked_at FROM restocks GROUP BY product_id
    ) r ON r.product_id = p.id
"""


def suggested_order(p):
    """Order enough to cover two weeks of recent sales, or double the reorder level."""
    target = max(p["reorder_level"] * 2, p.get("units_sold_7d", 0) * 2)
    return max(target - p["quantity"], 1)


def product_dict(row):
    d = dict(row)
    d["low_stock"] = d["quantity"] <= d["reorder_level"]
    if d["low_stock"]:
        d["suggested_order"] = suggested_order(d)
        d["suggested_cost"] = d["suggested_order"] * d["buying_price"]
    return d


def fetch_product(db, pid):
    row = db.execute(PRODUCT_QUERY + " WHERE p.id = ?", (pid,)).fetchone()
    return product_dict(row) if row else None


def low_stock_products(db):
    rows = db.execute(
        PRODUCT_QUERY
        + " WHERE p.quantity <= p.reorder_level ORDER BY (p.quantity * 1.0 / GREATEST(p.reorder_level, 1)), p.name"
    ).fetchall()
    return [product_dict(r) for r in rows]


# ---------------- Products ----------------
@app.get("/api/products")
def list_products():
    rows = get_db().execute(PRODUCT_QUERY + " ORDER BY p.name").fetchall()
    return jsonify([product_dict(r) for r in rows])


@app.post("/api/products")
def add_product():
    data = request.get_json(silent=True) or {}
    try:
        name = str(data.get("name", "")).strip()
        category = str(data.get("category") or "General").strip()
        buying = float(data["buying_price"])
        selling = float(data["selling_price"])
        qty = int(data["quantity"])
        reorder = int(data["reorder_level"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Please fill in all fields with valid numbers."), 400
    if not name:
        return jsonify(error="Product name is required."), 400
    if min(buying, selling, qty, reorder) < 0:
        return jsonify(error="Values cannot be negative."), 400

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO products (name, category, buying_price, selling_price, quantity, reorder_level)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, category, buying, selling, qty, reorder),
        )
        db.commit()
    except IntegrityError:
        return jsonify(error=f"A product named '{name}' already exists."), 409
    return jsonify(fetch_product(db, cur.lastrowid)), 201


@app.post("/api/products/import")
def import_products():
    """Upload an Excel/CSV product list. ?commit=1 saves it; otherwise it's a preview."""
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="Choose an Excel (.xlsx) or CSV file to import."), 400
    data = f.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        return jsonify(error="File is too large (max 10 MB)."), 400
    try:
        columns, items, errors = product_import.parse(f.filename, data)
    except product_import.ProductFileError as e:
        return jsonify(error=str(e)), 400
    commit = request.args.get("commit") == "1"
    if commit and not items:
        return jsonify(error="No valid products to import."), 400
    created, updated, unchanged = product_import.apply(get_db(), items, commit)
    return jsonify(committed=commit, columns=columns, created=created, updated=updated,
                   unchanged=unchanged, errors=errors)


@app.get("/api/products/import/template")
def import_template():
    return Response(
        product_import.template_xlsx(),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=NyamsComm_Products_Template.xlsx"})


@app.post("/api/products/<int:pid>/restock")
def restock_product(pid):
    data = request.get_json(silent=True) or {}
    try:
        qty = int(data["quantity"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Enter a valid quantity."), 400
    if qty <= 0:
        return jsonify(error="Quantity must be greater than zero."), 400
    db = get_db()
    product = db.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if product is None:
        return jsonify(error="Product not found."), 404
    # Optional: actual cost paid per unit this time; defaults to the product's buying price
    try:
        unit_cost = float(data.get("unit_cost") or product["buying_price"])
    except (TypeError, ValueError):
        return jsonify(error="Enter a valid unit cost."), 400
    db.execute("UPDATE products SET quantity = quantity + ? WHERE id = ?", (qty, pid))
    db.execute(
        "INSERT INTO restocks (product_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?)",
        (pid, qty, unit_cost, unit_cost * qty),
    )
    db.commit()
    return jsonify(fetch_product(db, pid))


@app.get("/api/restocks")
def list_restocks():
    rows = get_db().execute(
        "SELECT r.*, p.name AS product_name FROM restocks r JOIN products p ON p.id = r.product_id"
        " ORDER BY r.id DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/products/low-stock")
def get_low_stock():
    return jsonify(low_stock_products(get_db()))


# ---------------- Sales ----------------
@app.get("/api/sales")
def list_sales():
    rows = get_db().execute(
        "SELECT s.*, p.name AS product_name, c.name AS customer_name FROM sales s"
        " JOIN products p ON p.id = s.product_id LEFT JOIN customers c ON c.id = s.customer_id"
        " ORDER BY s.id DESC LIMIT 100"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


PAYMENT_METHODS = ["Cash", "M-Pesa", "Card", "Credit"]  # recorded as a label only (no payment integration)


class SaleError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def checkout(db, items, customer_id=None, redeem=0, payment_method="Cash", amount_paid=None):
    """Create one receipt with many line items. All-or-nothing: any problem rolls everything back."""
    if not items:
        raise SaleError("Add at least one product to the sale.")
    if payment_method not in PAYMENT_METHODS:
        raise SaleError(f"Payment method must be one of: {', '.join(PAYMENT_METHODS)}.")
    if redeem < 0:
        raise SaleError("Points to redeem cannot be negative.")

    # Merge duplicate products and validate quantities
    wanted = {}
    for it in items:
        try:
            pid, qty = int(it["product_id"]), int(it["quantity"])
        except (KeyError, TypeError, ValueError):
            raise SaleError("Each item needs a product and a valid quantity.")
        if qty <= 0:
            raise SaleError("Quantities must be greater than zero.")
        wanted[pid] = wanted.get(pid, 0) + qty

    lines = []
    for pid, qty in wanted.items():
        p = db.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
        if p is None:
            raise SaleError("Product not found.", 404)
        if p["quantity"] < qty:
            raise SaleError(f"Not enough stock. Only {p['quantity']} left of {p['name']}.")
        lines.append({"product": p, "qty": qty, "gross": p["selling_price"] * qty})
    subtotal = sum(l["gross"] for l in lines)

    customer = None
    if customer_id is not None:
        customer = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if customer is None:
            raise SaleError("Customer not found.", 404)
    if redeem and customer is None:
        raise SaleError("Select a customer to redeem points.")
    if customer is not None and redeem > customer["points"]:
        raise SaleError(f"{customer['name']} only has {customer['points']} points.")
    discount = redeem * POINT_VALUE_KSH
    if discount > subtotal:
        raise SaleError(f"Discount (KSh {discount:,.0f}) is more than the sale total (KSh {subtotal:,.0f}).")
    total = subtotal - discount

    if payment_method == "Cash" and amount_paid not in (None, ""):
        paid = float(amount_paid)
        if paid < total:
            raise SaleError(f"Cash received (KSh {paid:,.0f}) is less than the total (KSh {total:,.0f}).")
    else:
        paid = total
    earned = points_for(total, customer_spend(db, customer_id)) if customer is not None else 0

    try:
        tid = db.execute(
            "INSERT INTO transactions (customer_id, subtotal, discount, total, items_count, payment_method,"
            " amount_paid, change_given, points_earned, points_redeemed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (customer_id, subtotal, discount, total, sum(wanted.values()), payment_method, paid, paid - total,
             earned, redeem),
        ).lastrowid
        remaining = discount
        for i, l in enumerate(lines):
            p, qty = l["product"], l["qty"]
            # Spread the points discount across lines so per-product revenue stays accurate
            share = remaining if i == len(lines) - 1 else round(discount * l["gross"] / subtotal, 2)
            remaining -= share
            cur = db.execute("UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?",
                             (qty, p["id"], qty))
            if cur.rowcount == 0:
                raise SaleError(f"Not enough stock of {p['name']}.")
            db.execute(
                "INSERT INTO sales (product_id, quantity, unit_price, unit_cost, total, customer_id, discount,"
                " transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (p["id"], qty, p["selling_price"], p["buying_price"], l["gross"] - share, customer_id, share, tid),
            )
        if customer is not None:
            receipt = receipt_no(tid)
            if redeem:
                db.execute("INSERT INTO loyalty_points (customer_id, points, type, reason) VALUES (?, ?, 'redeem', ?)",
                           (customer_id, -redeem, f"Discount on receipt {receipt}"))
            if earned:
                db.execute("INSERT INTO loyalty_points (customer_id, points, type, reason) VALUES (?, ?, 'earn', ?)",
                           (customer_id, earned, f"Purchase, receipt {receipt}"))
            db.execute("UPDATE customers SET points = points + ? WHERE id = ?", (earned - redeem, customer_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return tid


def receipt_no(tid):
    return f"DB-{tid:05d}"


TRANSACTION_QUERY = """
    SELECT t.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS served_by,
        (SELECT COALESCE(SUM(s.total - COALESCE(s.unit_cost, 0) * s.quantity), 0) FROM sales s
         WHERE s.transaction_id = t.id) AS profit
    FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN users u ON u.id = t.user_id
"""


def transaction_dicts(db, rows):
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    placeholders = ",".join("?" * len(ids))
    items = {}
    for s in db.execute(
        "SELECT s.*, p.name AS product_name FROM sales s JOIN products p ON p.id = s.product_id"
        f" WHERE s.transaction_id IN ({placeholders}) ORDER BY s.id", ids
    ).fetchall():
        items.setdefault(s["transaction_id"], []).append(
            {k: s[k] for k in ("product_id", "product_name", "quantity", "unit_price", "discount", "total")}
        )
    out = []
    for r in rows:
        d = dict(r)
        d["receipt_no"] = receipt_no(d["id"])
        d["items"] = items.get(d["id"], [])
        out.append(d)
    return out


def fetch_transaction(db, tid):
    rows = db.execute(TRANSACTION_QUERY + " WHERE t.id = ?", (tid,)).fetchall()
    return transaction_dicts(db, rows)[0] if rows else None


def run_checkout(data):
    db = get_db()
    try:
        customer_id = int(data["customer_id"]) if data.get("customer_id") else None
        redeem = int(data.get("redeem_points") or 0)
        tid = checkout(db, data.get("items") or [], customer_id, redeem,
                       data.get("payment_method") or "Cash", data.get("amount_paid"))
        db.execute("UPDATE transactions SET user_id = ? WHERE id = ?", (auth.current_user()["id"], tid))
        db.commit()
    except SaleError as e:
        return jsonify(error=str(e)), e.status
    except (TypeError, ValueError):
        return jsonify(error="Invalid sale details."), 400
    sms.in_background(sms.notify_sale, tid)  # SMS boss & staff without slowing the till
    tx = fetch_transaction(db, tid)
    products = [fetch_product(db, it["product_id"]) for it in tx["items"]]
    return jsonify(
        transaction=tx,
        low_stock=[p for p in products if p["low_stock"]],
        customer=fetch_customer(db, customer_id) if customer_id else None,
    ), 201


@app.post("/api/transactions")
def create_transaction():
    return run_checkout(request.get_json(silent=True) or {})


@app.post("/api/sales")
def record_sale():
    """Single-item shortcut kept for compatibility; uses the same checkout."""
    data = request.get_json(silent=True) or {}
    data["items"] = [{"product_id": data.get("product_id"), "quantity": data.get("quantity")}]
    return run_checkout(data)


@app.get("/api/transactions/<int:tid>")
def get_transaction(tid):
    tx = fetch_transaction(get_db(), tid)
    if tx is None:
        return jsonify(error="Receipt not found."), 404
    return jsonify(tx)


@app.get("/api/transactions")
def list_transactions():
    """Sales history with filters: from/to (YYYY-MM-DD), payment, q (receipt no., customer or product)."""
    db = get_db()
    where, params = [], []
    if request.args.get("from"):
        where.append("left(t.created_at, 10) >= ?")
        params.append(request.args["from"])
    if request.args.get("to"):
        where.append("left(t.created_at, 10) <= ?")
        params.append(request.args["to"])
    if request.args.get("payment"):
        where.append("t.payment_method = ?")
        params.append(request.args["payment"])
    q = (request.args.get("q") or "").strip()
    if q:
        digits = "".join(ch for ch in q if ch.isdigit())
        where.append(
            "(c.name ILIKE ? OR c.phone ILIKE ? OR t.id = ? OR EXISTS (SELECT 1 FROM sales s JOIN products p"
            " ON p.id = s.product_id WHERE s.transaction_id = t.id AND p.name ILIKE ?))"
        )
        params += [f"%{q}%", f"%{q}%", int(digits) if digits else -1, f"%{q}%"]
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    base = " FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id" + clause
    in_filtered = " s.transaction_id IN (SELECT t.id" + base + ")"

    rows = db.execute(TRANSACTION_QUERY + clause + " ORDER BY t.created_at DESC, t.id DESC LIMIT 200", params).fetchall()
    summary = dict(db.execute(
        "SELECT COUNT(*) AS count, COALESCE(SUM(t.total), 0) AS revenue, COALESCE(SUM(t.items_count), 0) AS items,"
        " COALESCE(SUM(t.discount), 0) AS discounts, COALESCE(AVG(t.total), 0) AS avg_sale,"
        " COALESCE(SUM(CASE WHEN t.customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS loyalty_sales" + base, params
    ).fetchone())
    summary["profit"] = db.execute(
        "SELECT COALESCE(SUM(s.total - COALESCE(s.unit_cost, 0) * s.quantity), 0) FROM sales s WHERE" + in_filtered,
        params,
    ).fetchone()[0]
    daily = db.execute(
        "SELECT left(t.created_at, 10) AS day, COUNT(*) AS count, SUM(t.total) AS revenue" + base
        + " GROUP BY day ORDER BY day DESC LIMIT 31", params
    ).fetchall()
    payments = db.execute(
        "SELECT t.payment_method AS method, COUNT(*) AS count, SUM(t.total) AS revenue" + base
        + " GROUP BY t.payment_method ORDER BY revenue DESC", params
    ).fetchall()
    top = db.execute(
        "SELECT p.name, SUM(s.quantity) AS units, SUM(s.total) AS revenue FROM sales s"
        " JOIN products p ON p.id = s.product_id WHERE" + in_filtered + " GROUP BY p.id ORDER BY units DESC LIMIT 5",
        params,
    ).fetchall()
    return jsonify(
        transactions=transaction_dicts(db, rows),
        summary=summary,
        daily=[dict(r) for r in reversed(daily)],
        payments=[dict(r) for r in payments],
        top_products=[dict(r) for r in top],
        payment_methods=PAYMENT_METHODS,
    )


# ---------------- Customers & loyalty ----------------
CUSTOMER_QUERY = """
    SELECT c.*,
        COUNT(DISTINCT s.transaction_id) AS visits,
        COALESCE(SUM(s.total), 0) AS total_spent,
        COALESCE(SUM(s.quantity), 0) AS items_bought,
        COALESCE(SUM(s.points_redeemed), 0) AS points_redeemed_total,
        MAX(s.created_at) AS last_visit,
        MIN(s.created_at) AS first_visit,
        COUNT(DISTINCT CASE WHEN s.created_at >= local_now('-30 days') THEN s.transaction_id END) AS visits_30d
    FROM customers c LEFT JOIN sales s ON s.customer_id = c.id
"""


def customer_dict(row):
    from datetime import datetime

    d = dict(row)
    d["tier"] = tier_for(d["total_spent"])["name"]
    d["multiplier"] = tier_for(d["total_spent"])["multiplier"]
    d["next_tier"] = next_tier(d["total_spent"])
    d["avg_basket"] = round(d["total_spent"] / d["visits"], 2) if d["visits"] else 0
    d["points_value"] = d["points"] * POINT_VALUE_KSH
    if d["last_visit"]:
        days = (datetime.now() - datetime.strptime(d["last_visit"], "%Y-%m-%d %H:%M:%S")).days
        d["days_since_visit"] = days
        if days >= AT_RISK_DAYS:
            d["status"] = "At risk"
        elif d["visits_30d"] >= 8:
            d["status"] = "Loyal"
        elif d["visits_30d"] >= 3:
            d["status"] = "Regular"
        else:
            d["status"] = "Occasional"
    else:
        d["days_since_visit"] = None
        d["status"] = "New"
    return d


def fetch_customer(db, cid):
    row = db.execute(CUSTOMER_QUERY + " WHERE c.id = ? GROUP BY c.id", (cid,)).fetchone()
    return customer_dict(row) if row else None


def all_customers(db):
    rows = db.execute(CUSTOMER_QUERY + " GROUP BY c.id ORDER BY total_spent DESC, c.name").fetchall()
    return [customer_dict(r) for r in rows]


def normalize_phone(phone):
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if digits.startswith("254") and len(digits) == 12:
        digits = "0" + digits[3:]
    if len(digits) == 9 and digits[0] in "17":
        digits = "0" + digits
    return digits if len(digits) == 10 and digits.startswith(("07", "01")) else None


@app.get("/api/loyalty/rules")
def loyalty_rules():
    return jsonify(
        points_per_ksh=POINTS_PER_KSH,
        point_value_ksh=POINT_VALUE_KSH,
        at_risk_days=AT_RISK_DAYS,
        tiers=[{"name": n, "min_spend": m, "multiplier": x} for n, m, x in reversed(TIERS)],
    )


@app.get("/api/customers")
def list_customers():
    return jsonify(all_customers(get_db()))


@app.post("/api/customers")
def add_customer():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    phone = normalize_phone(data.get("phone", ""))
    if not name:
        return jsonify(error="Customer name is required."), 400
    if not phone:
        return jsonify(error="Enter a valid Kenyan phone number, e.g. 0712 345 678."), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO customers (name, phone) VALUES (?, ?)", (name, phone))
        db.commit()
    except IntegrityError:
        return jsonify(error=f"A customer with phone {phone} already exists."), 409
    return jsonify(fetch_customer(db, cur.lastrowid)), 201


@app.get("/api/customers/<int:cid>")
def customer_detail(cid):
    db = get_db()
    customer = fetch_customer(db, cid)
    if customer is None:
        return jsonify(error="Customer not found."), 404
    favourites = db.execute(
        "SELECT p.id, p.name, p.category, COUNT(*) AS times_bought, SUM(s.quantity) AS units, SUM(s.total) AS spent"
        " FROM sales s JOIN products p ON p.id = s.product_id WHERE s.customer_id = ?"
        " GROUP BY p.id ORDER BY units DESC, spent DESC LIMIT 5", (cid,)).fetchall()
    categories = db.execute(
        "SELECT p.category, SUM(s.total) AS spent FROM sales s JOIN products p ON p.id = s.product_id"
        " WHERE s.customer_id = ? GROUP BY p.category ORDER BY spent DESC", (cid,)).fetchall()
    days = db.execute(
        "SELECT CAST(EXTRACT(DOW FROM created_at::timestamp) AS INTEGER) AS dow, COUNT(*) AS visits FROM transactions"
        " WHERE customer_id = ? GROUP BY dow ORDER BY visits DESC", (cid,)).fetchall()
    purchases = transaction_dicts(db, db.execute(
        TRANSACTION_QUERY + " WHERE t.customer_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 50", (cid,)).fetchall())
    ledger = db.execute(
        "SELECT * FROM loyalty_points WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50", (cid,)).fetchall()
    day_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    return jsonify(
        customer=customer,
        favourites=[dict(r) for r in favourites],
        categories=[dict(r) for r in categories],
        favourite_day=day_names[days[0]["dow"]] if days else None,
        purchases=purchases,
        ledger=[dict(r) for r in ledger],
    )


@app.post("/api/customers/<int:cid>/bonus")
def award_bonus(cid):
    data = request.get_json(silent=True) or {}
    try:
        points = int(data["points"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Enter a valid number of points."), 400
    if points <= 0 or points > 10000:
        return jsonify(error="Bonus must be between 1 and 10,000 points."), 400
    reason = str(data.get("reason") or "Loyalty bonus").strip()[:200]
    db = get_db()
    if db.execute("SELECT 1 FROM customers WHERE id = ?", (cid,)).fetchone() is None:
        return jsonify(error="Customer not found."), 404
    db.execute("INSERT INTO loyalty_points (customer_id, points, type, reason) VALUES (?, ?, 'bonus', ?)",
               (cid, points, reason))
    db.execute("UPDATE customers SET points = points + ? WHERE id = ?", (points, cid))
    db.commit()
    return jsonify(fetch_customer(db, cid))


# ---------------- Dashboard ----------------
@app.get("/api/dashboard")
def dashboard():
    db = get_db()
    total_products = db.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    today = db.execute(
        "SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS count, COALESCE(SUM(items_count), 0) AS items"
        " FROM transactions WHERE left(created_at, 10) = left(local_now(), 10)"
    ).fetchone()
    inv = db.execute(
        "SELECT COALESCE(SUM(quantity * buying_price), 0) AS cost_value,"
        " COALESCE(SUM(quantity * selling_price), 0) AS retail_value FROM products"
    ).fetchone()
    recent = transaction_dicts(db, db.execute(
        TRANSACTION_QUERY + " ORDER BY t.created_at DESC, t.id DESC LIMIT 5").fetchall())
    all_time = db.execute(
        "SELECT COUNT(*) AS count, COALESCE(SUM(items_count), 0) AS items, COALESCE(SUM(total), 0) AS revenue"
        " FROM transactions"
    ).fetchone()
    top = db.execute(
        "SELECT p.id, p.name, SUM(s.quantity) AS units_sold, COUNT(DISTINCT s.transaction_id) AS sales_count, SUM(s.total) AS revenue"
        " FROM sales s JOIN products p ON p.id = s.product_id GROUP BY p.id ORDER BY units_sold DESC LIMIT 5"
    ).fetchall()
    low = low_stock_products(db)
    customers = all_customers(db)
    return jsonify(
        total_customers=len(customers),
        at_risk_customers=sum(1 for c in customers if c["status"] == "At risk"),
        points_outstanding=sum(c["points"] for c in customers),
        top_customers=[
            {k: c[k] for k in ("id", "name", "tier", "visits", "total_spent", "points", "status")}
            for c in customers[:5]
        ],
        total_sales_count=all_time["count"],
        total_items_sold=all_time["items"],
        total_revenue=all_time["revenue"],
        top_sellers=[dict(r) for r in top],
        restock_budget=sum(p["suggested_cost"] for p in low),
        total_products=total_products,
        today_sales=today["revenue"],
        today_transactions=today["count"],
        today_items=today["items"],
        inventory_value=inv["cost_value"],
        inventory_retail_value=inv["retail_value"],
        low_stock_count=len(low),
        low_stock=low,
        recent_sales=recent,
    )


# ---------------- AI Assistant ----------------
def build_inventory_context(db):
    products = db.execute("SELECT * FROM products ORDER BY name").fetchall()
    sales_7d = {
        r["product_id"]: r["qty"]
        for r in db.execute(
            "SELECT product_id, SUM(quantity) AS qty FROM sales"
            " WHERE created_at >= local_now('-7 days') GROUP BY product_id"
        ).fetchall()
    }
    lines = ["name | category | qty_in_stock | reorder_level | buying_KSh | selling_KSh | units_sold_last_7_days | LOW?"]
    for p in products:
        lines.append(
            f"{p['name']} | {p['category']} | {p['quantity']} | {p['reorder_level']} | "
            f"{p['buying_price']:.0f} | {p['selling_price']:.0f} | {sales_7d.get(p['id'], 0)} | "
            f"{'YES' if p['quantity'] <= p['reorder_level'] else 'no'}"
        )
    return "\n".join(lines), products, sales_7d


def fallback_recommendation(products, sales_7d):
    """Rule-based advice used when no API key is configured or the AI call fails."""
    low = [p for p in products if p["quantity"] <= p["reorder_level"]]
    if not low:
        return "All products are above their reorder levels. No restocking needed right now."
    lines = ["**Restock recommendations** (rule-based):", ""]
    total_cost = 0
    for p in sorted(low, key=lambda p: p["quantity"] / max(p["reorder_level"], 1)):
        weekly = sales_7d.get(p["id"], 0)
        target = max(p["reorder_level"] * 2, weekly * 2)
        order_qty = max(target - p["quantity"], 1)
        cost = order_qty * p["buying_price"]
        total_cost += cost
        lines.append(
            f"- **{p['name']}**: {p['quantity']} left (reorder at {p['reorder_level']}). "
            f"Order **{order_qty}** units ≈ KSh {cost:,.0f}."
        )
    lines += ["", f"**Estimated total restock cost: KSh {total_cost:,.0f}**"]
    return "\n".join(lines)


def call_claude(api_key, system, user_msg):
    body = json.dumps(
        {
            "model": ANTHROPIC_MODEL,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": user_msg}],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


@app.post("/api/assistant")
def assistant():
    data = request.get_json(silent=True) or {}
    question = str(data.get("question") or "What should I restock this week?").strip()[:1000]
    db = get_db()
    context, products, sales_7d = build_inventory_context(db)

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return jsonify(
            answer=fallback_recommendation(products, sales_7d),
            source="rules",
            note="Set ANTHROPIC_API_KEY in backend/.env to enable Claude AI.",
        )

    system = (
        "You are the NyamsComm assistant, a friendly, practical helper for NyamsComm Electronics, an electronics dealer shop in Kenya "
        "(phones, laptops, TVs, audio, accessories). "
        "Use ONLY the inventory data provided. All money is in Kenyan Shillings (KSh). "
        "Be concise: use short bullet points, bold product names, give specific order quantities "
        "and estimated restock cost (quantity x buying price). Prioritise items at or below reorder level "
        "and fast sellers. Expensive items (phones, laptops, TVs) tie up a lot of cash, so recommend small, "
        "careful orders for them and point out cheap fast-moving accessories worth bundling. If asked about customers, suggest who to reward with bonus points and who to win back "
        "(at-risk customers). Keep answers under 250 words."
    )
    user_msg = f"Current shop inventory:\n{context}\n\nShop owner's question: {question}"
    try:
        answer = call_claude(api_key, system, user_msg)
        return jsonify(answer=answer, source="claude")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        detail = exc.read().decode(errors="ignore")[:300] if isinstance(exc, urllib.error.HTTPError) else str(exc)
        app.logger.warning("Claude API failed: %s", detail)
        return jsonify(
            answer=fallback_recommendation(products, sales_7d),
            source="rules",
            note="AI service unavailable, showing rule-based advice.",
        )


@app.get("/api/health")
def health():
    return jsonify(status="ok", ai_enabled=bool(os.getenv("ANTHROPIC_API_KEY", "").strip()))


init_db()
reports.all_customers = all_customers
if os.getenv("RUN_SCHEDULER") == "1":  # set in docker-compose.yml (gunicorn runs a single worker)
    import logging

    logging.basicConfig(level=logging.INFO)
    automation.start_scheduler()
    sms.start_summary_timer()

if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)
    # With the debug reloader, only the child process (WERKZEUG_RUN_MAIN) should run background jobs
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        automation.start_scheduler()
        sms.start_summary_timer()
    app.run(host="127.0.0.1", port=5000, debug=True)
