"""DukaBuddy reports: build report data once, render as PDF (fpdf2) or Excel (openpyxl)."""
import io
import re
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, send_file
from fpdf import FPDF
from fpdf.fonts import FontFace
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from automation import email_layout, email_table, get_settings, ksh, performance, send_email
from db import get_db

bp = Blueprint("reports", __name__)
all_customers = None  # injected by app.py (customer tier/status logic lives there)

REPORT_TYPES = {
    "sales": ("Sales Report", "Receipts, revenue, profit, daily totals and payment methods"),
    "inventory": ("Inventory Report", "Current stock, stock value, low-stock items and restocks received"),
    "performance": ("Product Performance Report", "Products ranked best to worst, slow movers and dead stock"),
    "customers": ("Customer & Loyalty Report", "Customer spending, visits, tiers and loyalty points"),
    "restock": ("Restock & Purchase Orders Report", "Purchase orders and deliveries received"),
    "monthly": ("Monthly Performance Report", "Complete shop performance summary - all sections"),
}
FMT = "%Y-%m-%d %H:%M:%S"


# ---------------------------------------------------------------- data
def col(name, kind="text", width=1.0):
    return {"name": name, "kind": kind, "width": width}


def section(title, columns, rows, note=None, sheet=None):
    # sheet: short Excel tab name (Excel allows max 31 chars)
    return {"title": title, "columns": columns, "rows": rows, "note": note, "sheet": (sheet or title)[:31]}


def sales_sections(db, start, end):
    a, b = start.strftime(FMT), end.strftime(FMT)
    k = db.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(items_count), 0) AS items,"
        " COALESCE(SUM(discount), 0) AS discounts, COALESCE(AVG(total), 0) AS avg FROM transactions"
        " WHERE created_at >= ? AND created_at < ?", (a, b)).fetchone()
    profit = db.execute(
        "SELECT COALESCE(SUM(total - COALESCE(unit_cost, 0) * quantity), 0) FROM sales"
        " WHERE created_at >= ? AND created_at < ?", (a, b)).fetchone()[0]
    kpis = [
        ("Receipts", f"{k['n']:,}"), ("Revenue", ksh(k["revenue"])), ("Gross profit", ksh(profit)),
        ("Margin", f"{profit / k['revenue'] * 100:.1f}%" if k["revenue"] else "-"),
        ("Average sale", ksh(k["avg"])), ("Items sold", f"{k['items']:,}"), ("Points discounts", ksh(k["discounts"])),
    ]
    daily = db.execute(
        "SELECT d.day, d.n, d.items, d.revenue, COALESCE(p.profit, 0) AS profit FROM ("
        "  SELECT left(created_at, 10) AS day, COUNT(*) AS n, SUM(items_count) AS items, SUM(total) AS revenue"
        "  FROM transactions WHERE created_at >= ? AND created_at < ? GROUP BY left(created_at, 10)) d"
        " LEFT JOIN ("
        "  SELECT left(created_at, 10) AS day, SUM(total - COALESCE(unit_cost, 0) * quantity) AS profit"
        "  FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY left(created_at, 10)) p ON p.day = d.day"
        " ORDER BY d.day", (a, b, a, b)).fetchall()
    pays = db.execute(
        "SELECT payment_method, COUNT(*) AS n, SUM(total) AS revenue FROM transactions"
        " WHERE created_at >= ? AND created_at < ? GROUP BY payment_method ORDER BY revenue DESC", (a, b)).fetchall()
    receipts = db.execute(
        "SELECT t.*, c.name AS customer, (SELECT string_agg(s.quantity || 'x ' || p.name, '; ' ORDER BY s.id) FROM sales s"
        " JOIN products p ON p.id = s.product_id WHERE s.transaction_id = t.id) AS items"
        " FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id"
        " WHERE t.created_at >= ? AND t.created_at < ? ORDER BY t.created_at LIMIT 1000", (a, b)).fetchall()
    return kpis, [
        section("Daily sales", [col("Date"), col("Receipts", "int"), col("Items", "int"), col("Revenue", "money"),
                                col("Gross profit", "money")],
                [(r["day"], r["n"], r["items"], r["revenue"], r["profit"]) for r in daily]),
        section("Sales by payment method", [col("Payment method"), col("Receipts", "int"), col("Revenue", "money")],
                [(r["payment_method"], r["n"], r["revenue"]) for r in pays], sheet="Payment methods"),
        section("All receipts", [col("Receipt", width=0.8), col("Date & time", width=1.1), col("Customer"),
                                 col("Items", width=2.6), col("Payment", width=0.7), col("Discount", "money", 0.8),
                                 col("Total", "money", 0.8)],
                [(f"DB-{r['id']:05d}", r["created_at"][:16], r["customer"] or "Walk-in", r["items"] or "",
                  r["payment_method"], r["discount"], r["total"]) for r in receipts]),
    ]


def inventory_sections(db, start, end):
    a, b = start.strftime(FMT), end.strftime(FMT)
    prods = db.execute("SELECT * FROM products ORDER BY category, name").fetchall()
    cost = sum(p["quantity"] * p["buying_price"] for p in prods)
    retail = sum(p["quantity"] * p["selling_price"] for p in prods)
    low = [p for p in prods if p["quantity"] <= p["reorder_level"]]
    restocks = db.execute(
        "SELECT r.*, p.name FROM restocks r JOIN products p ON p.id = r.product_id"
        " WHERE r.created_at >= ? AND r.created_at < ? ORDER BY r.created_at", (a, b)).fetchall()
    kpis = [("Products", str(len(prods))), ("Stock value (cost)", ksh(cost)), ("Stock value (retail)", ksh(retail)),
            ("Potential profit", ksh(retail - cost)), ("Low-stock items", str(len(low))),
            ("Restock spend in period", ksh(sum(r["total_cost"] for r in restocks)))]
    status = lambda p: "Out of stock" if p["quantity"] == 0 else "Low stock" if p["quantity"] <= p["reorder_level"] else "OK"
    return kpis, [
        section("Current stock (as at report date)",
                [col("Product", width=2), col("Category"), col("In stock", "int", 0.7), col("Reorder at", "int", 0.7),
                 col("Buying price", "money"), col("Selling price", "money"), col("Value at cost", "money"),
                 col("Status", width=0.8)],
                [(p["name"], p["category"], p["quantity"], p["reorder_level"], p["buying_price"], p["selling_price"],
                  p["quantity"] * p["buying_price"], status(p)) for p in prods], sheet="Current stock"),
        section("Low-stock items", [col("Product", width=2), col("In stock", "int"), col("Reorder at", "int"),
                                    col("Buying price", "money")],
                [(p["name"], p["quantity"], p["reorder_level"], p["buying_price"]) for p in low],
                note=None if low else "No products are at or below their reorder level."),
        section("Restocks received in period", [col("Date"), col("Product", width=2), col("Quantity", "int"),
                                                col("Unit cost", "money"), col("Total cost", "money")],
                [(r["created_at"][:16], r["name"], r["quantity"], r["unit_cost"], r["total_cost"]) for r in restocks],
                sheet="Restocks received"),
    ]


def performance_sections(db, start, end):
    perf = performance(db, start=start, end=end)
    items = perf["products"]
    kpis = [(c, str(n)) for c, n in perf["summary"].items() if n] + [
        ("Dead stock value", ksh(perf["dead_stock_value"])), ("Slow stock value", ksh(perf["slow_stock_value"]))]
    rank_rows = [(d["rank"], d["name"], d["classification"], d["units"], d["revenue"], d["profit"], d["margin_pct"],
                  d["quantity"], d["days_of_cover"] if d["days_of_cover"] is not None else "-",
                  d["days_since_sale"] if d["days_since_sale"] is not None else "never") for d in items]
    attention = [d for d in items if d["classification"] in ("Dead stock", "Slow mover")]
    return kpis, [
        section("Product ranking - best to worst (by gross profit)",
                [col("Rank", "int", 0.5), col("Product", width=2.2), col("Class", width=1.1), col("Units sold", "int", 0.7),
                 col("Revenue", "money", 0.9), col("Gross profit", "money", 0.9), col("Margin %", "pct", 0.7),
                 col("In stock", "int", 0.6), col("Days of stock", width=0.8), col("Days since sale", width=0.9)],
                rank_rows, sheet="Product ranking"),
        section("Needs attention - slow movers & dead stock",
                [col("Product", width=2), col("Class"), col("In stock", "int"), col("Value at cost", "money"),
                 col("Insight", width=3)],
                [(d["name"], d["classification"], d["quantity"], d["stock_value"], d["insight"]) for d in attention],
                note=None if attention else "Every product is selling at a healthy rate.", sheet="Slow and dead stock"),
    ]


def customer_sections(db, start, end):
    a, b = start.strftime(FMT), end.strftime(FMT)
    period = {r["customer_id"]: r for r in db.execute(
        "SELECT customer_id, COUNT(*) AS visits, SUM(total) AS spent FROM transactions"
        " WHERE customer_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY customer_id", (a, b))}
    pts = db.execute(
        "SELECT COALESCE(SUM(CASE WHEN points > 0 THEN points END), 0) AS issued,"
        " COALESCE(-SUM(CASE WHEN points < 0 THEN points END), 0) AS redeemed FROM loyalty_points"
        " WHERE created_at >= ? AND created_at < ?", (a, b)).fetchone()
    customers = all_customers(db)
    active = [c for c in customers if c["id"] in period]
    kpis = [("Loyalty members", str(len(customers))), ("Active in period", str(len(active))),
            ("Spent by members", ksh(sum(r["spent"] for r in period.values()))),
            ("Points issued", f"{pts['issued']:,}"), ("Points redeemed", f"{pts['redeemed']:,}"),
            ("At-risk customers", str(sum(1 for c in customers if c["status"] == "At risk")))]
    rows = sorted(customers, key=lambda c: period.get(c["id"], {"spent": 0})["spent"], reverse=True)
    return kpis, [
        section("Customers", [col("Customer", width=1.6), col("Phone"), col("Tier", width=0.7), col("Status", width=0.8),
                              col("Visits in period", "int", 0.9), col("Spent in period", "money"),
                              col("Lifetime spend", "money"), col("Points", "int", 0.7)],
                [(c["name"], c["phone"], c["tier"], c["status"], period[c["id"]]["visits"] if c["id"] in period else 0,
                  period[c["id"]]["spent"] if c["id"] in period else 0, c["total_spent"], c["points"]) for c in rows]),
    ]


def restock_sections(db, start, end):
    a, b = start.strftime(FMT), end.strftime(FMT)
    pos = db.execute(
        "SELECT o.*, p.name FROM purchase_orders o JOIN products p ON p.id = o.product_id"
        " WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.created_at", (a, b)).fetchall()
    open_pos = db.execute(
        "SELECT o.*, p.name FROM purchase_orders o JOIN products p ON p.id = o.product_id"
        " WHERE o.status IN ('pending_review', 'ordered') ORDER BY o.created_at").fetchall()
    label = {"pending_review": "Needs review", "ordered": "Ordered", "received": "Received", "cancelled": "Cancelled"}
    kpis = [("Orders in period", str(len(pos))),
            ("Received", str(sum(1 for p in pos if p["status"] == "received"))),
            ("Open orders now", str(len(open_pos))),
            ("Open orders value", ksh(sum(p["quantity"] * p["unit_cost"] for p in open_pos)))]
    cols = [col("Order", width=0.7), col("Created", width=1.1), col("Product", width=2), col("Quantity", "int", 0.7),
            col("Est. cost", "money", 0.9), col("Status", width=0.9), col("Source", width=0.6), col("Reason", width=2.4)]
    row = lambda p: (f"PO-{p['id']:04d}", p["created_at"][:16], p["name"], p["quantity"], p["quantity"] * p["unit_cost"],
                     label[p["status"]], p["source"], p["reason"] or "")
    _, inv = inventory_sections(db, start, end)
    return kpis, [section("Purchase orders created in period", cols, [row(p) for p in pos], sheet="Purchase orders"),
                  section("Open purchase orders (now)", cols, [row(p) for p in open_pos], sheet="Open orders"), inv[2]]


BUILDERS = {"sales": sales_sections, "inventory": inventory_sections, "performance": performance_sections,
            "customers": customer_sections, "restock": restock_sections}


def build_report(db, kind, start_date, end_date):
    """start_date/end_date are inclusive date objects."""
    start = datetime.combine(start_date, datetime.min.time())
    end = datetime.combine(end_date + timedelta(days=1), datetime.min.time())
    title = REPORT_TYPES[kind][0]
    groups, seen = [], set()
    for k in (BUILDERS if kind == "monthly" else [kind]):
        kpis, sections = BUILDERS[k](db, start, end)
        sections = [x for x in sections if x["title"] not in seen]  # monthly: no repeated sections
        seen.update(x["title"] for x in sections)
        groups.append({"name": REPORT_TYPES[k][0].replace(" Report", ""), "kpis": kpis, "sections": sections})
    if kind == "monthly":
        period_label = start_date.strftime("%B %Y")
        fname = f"DukaBuddy_Monthly_Performance_Report_{start_date.strftime('%B_%Y')}"
    else:
        period_label = f"{start_date.strftime('%d %b %Y')} to {end_date.strftime('%d %b %Y')}"
        fname = f"DukaBuddy_{title.replace(' & ', '_and_').replace(' ', '_')}_{start_date}_to_{end_date}"
    return {
        "kind": kind, "title": title, "period": period_label, "filename": re.sub(r"[^A-Za-z0-9_\-]", "", fname),
        "shop": get_settings(db)["shop_name"], "generated": datetime.now().strftime("%d %b %Y, %H:%M"),
        "groups": groups,
    }


# ---------------------------------------------------------------- formatting
def fmt_cell(v, kind):
    if v is None or v == "":
        return ""
    if kind == "money" and isinstance(v, (int, float)):
        return ksh(v)
    if kind == "pct" and isinstance(v, (int, float)):
        return f"{v:.1f}%"
    if kind == "int" and isinstance(v, (int, float)):
        return f"{v:,.0f}"
    return str(v)


def latin1(s):
    s = str(s).replace("—", "-").replace("–", "-").replace("×", "x").replace("’", "'")
    return s.encode("latin-1", "replace").decode("latin-1")


# ---------------------------------------------------------------- PDF
class ReportPDF(FPDF):
    def __init__(self, rep):
        super().__init__(orientation="L", unit="mm", format="A4")
        self.rep = rep
        self.set_auto_page_break(True, margin=15)
        self.set_title(f"{rep['title']} - {rep['period']}")
        self.set_author("DukaBuddy")

    def header(self):
        self.set_fill_color(5, 150, 105)
        self.rect(0, 0, self.w, 18, "F")
        self.set_text_color(255, 255, 255)
        self.set_xy(10, 4)
        self.set_font("Helvetica", "B", 13)
        self.cell(0, 6, latin1(f"DukaBuddy  |  {self.rep['shop']}"))
        self.set_xy(10, 10)
        self.set_font("Helvetica", "", 9)
        self.cell(0, 5, latin1(f"{self.rep['title']}  -  {self.rep['period']}"))
        self.set_text_color(30, 41, 59)
        self.set_y(24)

    def footer(self):
        self.set_y(-10)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(148, 163, 184)
        self.cell(0, 5, latin1(f"Generated {self.rep['generated']} by DukaBuddy"), align="L")
        self.cell(0, 5, f"Page {self.page_no()} of {{nb}}", align="R")


def render_pdf(rep):
    pdf = ReportPDF(rep)
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 9, latin1(rep["title"]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 116, 139)
    pdf.cell(0, 6, latin1(f"Period: {rep['period']}    |    Generated: {rep['generated']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(30, 41, 59)
    pdf.ln(3)
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    head_style = FontFace(emphasis="BOLD", color=(255, 255, 255), fill_color=(30, 41, 59))

    for gi, g in enumerate(rep["groups"]):
        if len(rep["groups"]) > 1:
            if gi:
                pdf.add_page()
            pdf.set_font("Helvetica", "B", 14)
            pdf.set_text_color(5, 150, 105)
            pdf.cell(0, 8, latin1(g["name"]), new_x="LMARGIN", new_y="NEXT")
            pdf.set_text_color(30, 41, 59)
        # KPI tiles
        per_row = 4
        w = (usable - (per_row - 1) * 3) / per_row
        for i, (label, value) in enumerate(g["kpis"]):
            if i % per_row == 0 and i:
                pdf.ln(18)
            x = pdf.l_margin + (i % per_row) * (w + 3)
            y = pdf.get_y()
            pdf.set_fill_color(241, 245, 249)
            pdf.rect(x, y, w, 15, "F")
            pdf.set_xy(x + 3, y + 2)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(100, 116, 139)
            pdf.cell(w - 6, 4, latin1(label))
            pdf.set_xy(x + 3, y + 7)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(15, 23, 42)
            pdf.cell(w - 6, 6, latin1(value))
            pdf.set_y(y)
        pdf.ln(21)
        pdf.set_text_color(30, 41, 59)
        for sec in g["sections"]:
            if pdf.get_y() > pdf.h - 45:
                pdf.add_page()
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(0, 7, latin1(f"{sec['title']}  ({len(sec['rows'])})"), new_x="LMARGIN", new_y="NEXT")
            if not sec["rows"]:
                pdf.set_font("Helvetica", "I", 9)
                pdf.set_text_color(100, 116, 139)
                pdf.cell(0, 6, latin1(sec["note"] or "No records for this period."), new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(30, 41, 59)
                pdf.ln(3)
                continue
            total_w = sum(c["width"] for c in sec["columns"])
            widths = tuple(c["width"] / total_w * usable for c in sec["columns"])
            aligns = tuple("RIGHT" if c["kind"] in ("money", "int", "pct") else "LEFT" for c in sec["columns"])
            pdf.set_font("Helvetica", "", 8)
            with pdf.table(col_widths=widths, text_align=aligns, headings_style=head_style, line_height=5,
                           cell_fill_color=(248, 250, 252), cell_fill_mode="ROWS", borders_layout="HORIZONTAL_LINES",
                           first_row_as_headings=True, padding=(0.6, 1.5)) as table:
                table.row([latin1(c["name"]) for c in sec["columns"]])
                for r in sec["rows"]:
                    table.row([latin1(fmt_cell(v, c["kind"])) for v, c in zip(r, sec["columns"])])
            pdf.ln(5)
    return bytes(pdf.output())


# ---------------------------------------------------------------- Excel
def render_xlsx(rep):
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    title_font, head_fill = Font(bold=True, size=16, color="065F46"), PatternFill("solid", fgColor="1E293B")
    ws["A1"], ws["A1"].font = f"DukaBuddy - {rep['title']}", title_font
    ws["A2"] = rep["shop"]
    ws["A3"] = f"Period: {rep['period']}"
    ws["A4"] = f"Generated: {rep['generated']}"
    for c in ("A2", "A3", "A4"):
        ws[c].font = Font(color="64748B")
    r = 6
    for g in rep["groups"]:
        ws.cell(r, 1, g["name"]).font = Font(bold=True, size=12, color="059669")
        r += 1
        for label, value in g["kpis"]:
            ws.cell(r, 1, label).font = Font(color="475569")
            ws.cell(r, 2, value).font = Font(bold=True)
            r += 1
        r += 1
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 28, 22

    used = {"Summary"}
    for g in rep["groups"]:
        for sec in g["sections"]:
            name = re.sub(r"[\[\]\*\?/\\:]", "", sec["sheet"])[:31]
            while name in used:
                name = name[:28] + f" {len(used)}"
            used.add(name)
            sh = wb.create_sheet(name)
            sh["A1"], sh["A1"].font = sec["title"], Font(bold=True, size=13, color="065F46")
            sh["A2"], sh["A2"].font = f"{rep['title']} | {rep['period']}", Font(color="64748B")
            for ci, c in enumerate(sec["columns"], 1):
                cell = sh.cell(4, ci, c["name"])
                cell.font, cell.fill = Font(bold=True, color="FFFFFF"), head_fill
                cell.alignment = Alignment(horizontal="right" if c["kind"] in ("money", "int", "pct") else "left")
            for ri, row in enumerate(sec["rows"], 5):
                for ci, (v, c) in enumerate(zip(row, sec["columns"]), 1):
                    cell = sh.cell(ri, ci, v)
                    if c["kind"] == "money" and isinstance(v, (int, float)):
                        cell.number_format = '"KSh "#,##0'
                    elif c["kind"] == "pct" and isinstance(v, (int, float)):
                        cell.value, cell.number_format = v / 100, "0.0%"
                    elif c["kind"] == "int":
                        cell.number_format = "#,##0"
            if not sec["rows"]:
                sh.cell(5, 1, sec["note"] or "No records for this period.").font = Font(italic=True, color="64748B")
            else:
                sh.auto_filter.ref = f"A4:{get_column_letter(len(sec['columns']))}{4 + len(sec['rows'])}"
            sh.freeze_panes = "A5"
            for ci, c in enumerate(sec["columns"], 1):
                longest = max([len(c["name"])] + [len(fmt_cell(r[ci - 1], c["kind"])) for r in sec["rows"][:200]])
                sh.column_dimensions[get_column_letter(ci)].width = min(max(10, longest + 2), 60)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


MIME = {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def render(rep, fmt):
    return render_pdf(rep) if fmt == "pdf" else render_xlsx(rep)


# ---------------------------------------------------------------- monthly email
def month_bounds(month):
    start = datetime.strptime(month, "%Y-%m").date()
    nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, nxt - timedelta(days=1)


def send_monthly_report(db, month):
    start, end = month_bounds(month)
    rep = build_report(db, "monthly", start, end)
    sales_kpis = dict(rep["groups"][0]["kpis"])
    perf = performance(db, start=datetime.combine(start, datetime.min.time()),
                       end=datetime.combine(end + timedelta(days=1), datetime.min.time()))
    top = [d for d in perf["products"] if d["units"]][:5]
    dead = [d for d in perf["products"] if d["classification"] == "Dead stock"]
    inner = (
        f"<p>Here is how the shop performed in <b>{rep['period']}</b>. The full report is attached as PDF and Excel.</p>"
        + email_table([], [(k, v) for k, v in sales_kpis.items()])
        + "<h3 style='font-size:15px'>Best-performing products</h3>"
        + email_table(["#", "Product", "Units", "Profit"], [(i + 1, d["name"], d["units"], ksh(d["profit"]))
                                                           for i, d in enumerate(top)])
        + (f"<h3 style='font-size:15px'>Not selling</h3><p>{len(dead)} product(s) are dead stock, tying up "
           f"<b>{ksh(perf['dead_stock_value'])}</b>: {', '.join(d['name'] for d in dead)}.</p>" if dead else ""))
    body = email_layout(rep["shop"], f"Monthly performance report - {rep['period']}", inner)
    atts = [(f"{rep['filename']}.pdf", render_pdf(rep), MIME["pdf"]),
            (f"{rep['filename']}.xlsx", render_xlsx(rep), MIME["xlsx"])]
    return send_email(db, "monthly_report", f"Monthly report - {rep['period']}", body,
                      ref_key=f"monthly:{month}", attachments=atts)


# ---------------------------------------------------------------- routes
def parse_dates():
    try:
        start = datetime.strptime(request.args["from"], "%Y-%m-%d").date()
        end = datetime.strptime(request.args["to"], "%Y-%m-%d").date()
    except (KeyError, ValueError):
        raise ValueError("Choose a valid start and end date.")
    if end < start:
        raise ValueError("End date must be on or after the start date.")
    return start, end


@bp.get("/api/reports/types")
def api_types():
    return jsonify([{"id": k, "title": t, "description": d} for k, (t, d) in REPORT_TYPES.items()])


@bp.get("/api/reports/download")
def api_download():
    kind = request.args.get("type", "sales")
    fmt = request.args.get("format", "pdf")
    if kind not in REPORT_TYPES or fmt not in MIME:
        return jsonify(error="Unknown report type or format."), 400
    try:
        if kind == "monthly":
            start, end = month_bounds(request.args.get("month") or datetime.now().strftime("%Y-%m"))
        else:
            start, end = parse_dates()
    except ValueError as e:
        return jsonify(error=str(e)), 400
    rep = build_report(get_db(), kind, start, end)
    return send_file(io.BytesIO(render(rep, fmt)), mimetype=MIME[fmt], as_attachment=True,
                     download_name=f"{rep['filename']}.{fmt}")


@bp.post("/api/reports/monthly/send")
def api_send_monthly():
    data = request.get_json(silent=True) or {}
    month = data.get("month") or (datetime.now().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    try:
        month_bounds(month)
    except ValueError:
        return jsonify(error="Month must look like 2026-10."), 400
    db = get_db()
    aid = send_monthly_report(db, month)
    r = db.execute("SELECT status, error, to_addr, subject, attachments FROM email_outbox WHERE id = ?", (aid,)).fetchone()
    return jsonify(dict(r))


@bp.get("/api/reports/monthly")
def api_monthly_history():
    rows = get_db().execute(
        "SELECT id, ref_key, subject, status, error, to_addr, attachments, created_at FROM email_outbox"
        " WHERE kind = 'monthly_report' ORDER BY id DESC LIMIT 24").fetchall()
    return jsonify([dict(r) for r in rows])
