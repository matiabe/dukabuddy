"""Bulk product import from an Excel (.xlsx) or CSV file.

The header row is detected automatically (within the first 15 rows) and columns are matched by
name, so files like "Product Name | Brand | Category | Cost Price (KSh) | Retail Price | Qty | Min Stock"
work without editing. Required columns: product name, selling price, quantity.

The buying price column is optional (a sheet can carry selling prices only). When a row has no buying
price, an existing product keeps the buying price it already has and a new product is saved with a
buying price of 0, to be filled in later on the Products page.

Existing products (same name, case-insensitive) are updated: category, prices and reorder level are
overwritten and the quantity is set to the file's quantity (the file is treated as a stock count).
"""
import csv
import io
import re

from openpyxl import Workbook, load_workbook

DEFAULT_REORDER_LEVEL = 3
MAX_ROWS = 5000

# Checked in this order; each header is assigned to the first field whose pattern matches it.
# Order matters: "Reorder Qty" must become reorder_level (not quantity), "Cost Price" buying (not selling),
# "Product Category" category (not name).
FIELD_PATTERNS = [
    ("buying_price", r"\b(buy|buying|bought|cost|purchase|wholesale|bp|landed)\b"),
    ("reorder_level", r"\b(reorder|re order|min|minimum|alert|threshold)\b"),
    ("selling_price", r"\b(sell|selling|retail|sale|sp|rrp|mrp|price)\b"),
    ("quantity", r"\b(qty|quantity|stock|units|count|opening|available|balance|pcs)\b"),
    ("category", r"\b(category|categories|type|group|department|class|section)\b"),
    ("brand", r"\b(brand|make|manufacturer)\b"),
    ("name", r"\b(name|product|products|item|items|description|model|goods)\b"),
]
REQUIRED = {"name": "Product name", "selling_price": "Selling price", "quantity": "Quantity"}
LABELS = {**REQUIRED, "buying_price": "Buying price", "category": "Category", "reorder_level": "Reorder level",
          "brand": "Brand"}

TEMPLATE_ROWS = [
    ("Samsung Galaxy A15 128GB", "Phones", 17500, 21000, 12, 4),
    ("Oraimo FreePods 4 Earbuds", "Audio", 2600, 3500, 18, 6),
    ("Hisense 43\" Smart TV", "TVs", 28000, 33500, 7, 2),
]


class ProductFileError(ValueError):
    """The file as a whole can't be imported (wrong type, no header, missing columns)."""


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def match_columns(header):
    mapping = {}  # field -> column index
    for idx, cell in enumerate(header):
        h = _norm(cell)
        if not h:
            continue
        for field, pattern in FIELD_PATTERNS:
            if field not in mapping and re.search(pattern, h):
                mapping[field] = idx
                break
    return mapping


def read_rows(filename, data):
    name = (filename or "").lower()
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:  # corrupt / not really an Excel file
            raise ProductFileError("Could not open the Excel file. Save it as .xlsx and try again.") from e
        ws = wb.active
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        return rows
    if name.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t") if text.strip() else csv.excel
        return [list(r) for r in csv.reader(io.StringIO(text), dialect)]
    if name.endswith(".xls"):
        raise ProductFileError("Old .xls files aren't supported. In Excel use File > Save As > Excel Workbook (.xlsx).")
    raise ProductFileError("Upload an Excel (.xlsx) or CSV file.")


def find_header(rows):
    """First row (within the top 15) that has the required columns."""
    best = None
    for i, row in enumerate(rows[:15]):
        mapping = match_columns(row)
        if all(f in mapping for f in REQUIRED):
            return i, mapping
        if best is None or len(mapping) > len(best[1]):
            best = (i, mapping)
    found = best[1] if best else {}
    missing = [label for f, label in REQUIRED.items() if f not in found]
    raise ProductFileError(
        "Couldn't find these columns: " + ", ".join(missing)
        + ". The first row should have headings like: Product name, Category, Selling price, Quantity, "
          "Reorder level (Buying price is optional). Download the template to see the layout.")


def _number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = re.sub(r"(?i)ksh\.?|kes|/=|,|\s", "", str(value))
    s = s.rstrip("-")  # "21,000/-"
    return float(s) if s else None


def parse(filename, data):
    """Returns (columns, items, errors). items: dicts ready to save; errors: per-row problems."""
    rows = read_rows(filename, data)
    if not rows:
        raise ProductFileError("The file is empty.")
    header_idx, mapping = find_header(rows)
    header = rows[header_idx]
    columns = {LABELS[f]: str(header[i]).strip() for f, i in mapping.items()}

    def cell(row, field):
        i = mapping.get(field)
        return row[i] if i is not None and i < len(row) else None

    items, errors, seen = [], [], {}
    for line, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        if not any(str(cell(row, f) or "").strip() for f in mapping):
            continue  # blank row (a serial number alone doesn't count)
        if len(items) >= MAX_ROWS:
            raise ProductFileError(f"Too many rows - import at most {MAX_ROWS} products at a time.")
        name = re.sub(r"\s+", " ", str(cell(row, "name") or "")).strip()
        brand = str(cell(row, "brand") or "").strip()
        if brand and name and brand.lower() not in name.lower():
            name = f"{brand} {name}"
        if not name:
            errors.append({"row": line, "error": "Product name is empty."})
            continue
        if name.lower().startswith("total"):
            continue  # summary row at the bottom of a sheet
        try:
            buying = _number(cell(row, "buying_price"))
            selling = _number(cell(row, "selling_price"))
            qty = _number(cell(row, "quantity"))
            reorder = _number(cell(row, "reorder_level"))
        except ValueError:
            errors.append({"row": line, "name": name, "error": "A price or quantity is not a number."})
            continue
        problem = None
        missing = [label for label, v in (("selling price", selling), ("quantity", qty)) if v is None]
        if missing:
            problem = "Missing " + " and ".join(missing) + "."
        elif min(buying or 0, selling, qty, reorder or 0) < 0:
            problem = "Values cannot be negative."
        elif qty != int(qty) or (reorder is not None and reorder != int(reorder)):
            problem = "Quantity and reorder level must be whole numbers."
        elif buying is not None and selling < buying:
            problem = f"Selling price (KSh {selling:,.0f}) is below buying price (KSh {buying:,.0f})."
        if problem:
            errors.append({"row": line, "name": name, "error": problem})
            continue
        key = name.lower()
        if key in seen:
            errors.append({"row": line, "name": name, "error": f"Duplicate of row {seen[key]} - skipped."})
            continue
        seen[key] = line
        items.append({
            "row": line, "name": name,
            "category": str(cell(row, "category") or "").strip() or "General",
            "buying_price": buying, "selling_price": selling, "quantity": int(qty),
            "reorder_level": int(reorder) if reorder is not None else DEFAULT_REORDER_LEVEL,
        })
    return columns, items, errors


MARKUP = 0.25  # shop rule: selling price is the buying price plus 25%


def cost_from_selling(selling):
    """Buying price implied by the 25% markup rule (KSh 1,000 selling -> KSh 800 buying)."""
    return round(float(selling) / (1 + MARKUP), 2)


def apply(db, items, commit):
    """Classify items as new/updated (and save them when commit=True)."""
    existing = {r["name"].lower(): dict(r) for r in db.execute("SELECT * FROM products").fetchall()}
    created, updated, unchanged = [], [], 0
    fields = ("category", "selling_price", "quantity", "reorder_level")  # buying price is saved but not shown
    for it in items:
        old = existing.get(it["name"].lower())
        if not it["buying_price"]:  # selling-price-only sheet: keep a known cost, else apply the 25% rule
            if old and old["buying_price"]:
                it = {**it, "buying_price": old["buying_price"]}
            else:
                it = {**it, "buying_price": cost_from_selling(it["selling_price"]), "cost_estimated": True}
        if old is None:
            created.append(it)
            if commit:
                db.execute(
                    "INSERT INTO products (name, category, buying_price, selling_price, quantity, reorder_level)"
                    " VALUES (?, ?, ?, ?, ?, ?)",
                    (it["name"], it["category"], it["buying_price"], it["selling_price"], it["quantity"],
                     it["reorder_level"]))
            continue
        changes = {f: {"from": old[f], "to": it[f]} for f in fields if old[f] != it[f]}
        if not changes:
            unchanged += 1
            continue
        updated.append({**it, "id": old["id"], "changes": changes})
        if commit:
            db.execute(
                "UPDATE products SET category = ?, buying_price = ?, selling_price = ?, quantity = ?,"
                " reorder_level = ? WHERE id = ?",
                (it["category"], it["buying_price"], it["selling_price"], it["quantity"], it["reorder_level"],
                 old["id"]))
    if commit:
        db.commit()
    return created, updated, unchanged


def template_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"
    ws.append(["Product name", "Category", "Buying price (KSh)", "Selling price (KSh)", "Quantity",
               "Reorder level"])
    for r in TEMPLATE_ROWS:
        ws.append(list(r))
    for col, width in zip("ABCDEF", (34, 16, 20, 20, 12, 15)):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
