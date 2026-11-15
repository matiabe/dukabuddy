"""Product reviews: owners and staff rate products from 1 to 5 stars, with an optional comment.

* Each person has one review per product. Rating it again updates their review.
* The Products list shows each product's average rating and number of reviews (see PRODUCT_QUERY in app.py).
* Anyone can delete their own review; owners can delete any review.
"""
from flask import Blueprint, jsonify, request

import auth
from db import get_db

bp = Blueprint("reviews", __name__)

MAX_COMMENT = 500

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT local_now(),
        updated_at TEXT NOT NULL DEFAULT local_now(),
        UNIQUE (product_id, user_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id)",
]


def init_reviews(db):
    for stmt in SCHEMA:
        db.execute(stmt)
    db.commit()


ROW_QUERY = "SELECT r.*, u.name AS user_name FROM product_reviews r JOIN users u ON u.id = r.user_id"


def _summary(db, pid):
    r = db.execute("SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS review_count"
                   " FROM product_reviews WHERE product_id = ?", (pid,)).fetchone()
    return dict(avg_rating=float(r["avg_rating"]) if r["avg_rating"] is not None else None,
                review_count=r["review_count"])


# ---------------------------------------------------------------- routes (staff: see auth.STAFF_ALLOWED)
@bp.get("/api/products/<int:pid>/reviews")
def list_reviews(pid):
    db = get_db()
    product = db.execute("SELECT id, name FROM products WHERE id = ?", (pid,)).fetchone()
    if product is None:
        return jsonify(error="Product not found."), 404
    me = auth.current_user()
    is_owner = me["role"] == "owner"
    reviews = []
    for r in db.execute(ROW_QUERY + " WHERE r.product_id = ? ORDER BY r.updated_at DESC, r.id DESC", (pid,)):
        d = dict(r)
        d["mine"] = d["user_id"] == me["id"]
        d["can_delete"] = is_owner or d["mine"]
        reviews.append(d)
    mine = next((r for r in reviews if r["mine"]), None)
    return jsonify(product=dict(product), reviews=reviews, mine=mine, **_summary(db, pid))


@bp.post("/api/products/<int:pid>/reviews")
def save_review(pid):
    """Add or update the current user's review of a product."""
    data = request.get_json(silent=True) or {}
    try:
        rating = int(data.get("rating"))
    except (TypeError, ValueError):
        return jsonify(error="Choose a rating from 1 to 5 stars."), 400
    if not 1 <= rating <= 5:
        return jsonify(error="Choose a rating from 1 to 5 stars."), 400
    comment = str(data.get("comment") or "").strip()[:MAX_COMMENT] or None
    db = get_db()
    if db.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone() is None:
        return jsonify(error="Product not found."), 404
    db.execute(
        "INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)"
        " ON CONFLICT (product_id, user_id)"
        " DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = local_now()",
        (pid, auth.current_user()["id"], rating, comment))
    db.commit()
    return jsonify(ok=True, **_summary(db, pid))


@bp.delete("/api/reviews/<int:rid>")
def delete_review(rid):
    db = get_db()
    row = db.execute("SELECT product_id, user_id FROM product_reviews WHERE id = ?", (rid,)).fetchone()
    if row is None:
        return jsonify(error="Review not found."), 404
    me = auth.current_user()
    if me["role"] != "owner" and row["user_id"] != me["id"]:
        return jsonify(error="You can only delete your own review."), 403
    db.execute("DELETE FROM product_reviews WHERE id = ?", (rid,))
    db.commit()
    return jsonify(ok=True, **_summary(db, row["product_id"]))
