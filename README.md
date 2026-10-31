# DukaBuddy — AI Shop Assistant for Kenyan Dukas

React + Vite + Tailwind frontend, Flask + SQLite backend, optional Claude AI.

## Quick start (Windows)
Double-click `start.bat`, then open http://localhost:5173

## Manual start
```bash
# Backend (terminal 1)
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python app.py          # http://127.0.0.1:5000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

## Enable Claude AI (optional)
Put your key in `backend/.env` (never in the frontend):
```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5-5
```
Restart the backend. Without a key, the assistant falls back to rule-based restock advice from the same data.

## Features
- Dashboard: total products, today's sales, inventory value (at cost), low-stock count — all computed live from SQLite
- Add/view/search products, restock received goods
- New Sale (till): multi-item cart, loyalty points, payment method (Cash / M-Pesa / Card / Credit, recorded as a label), cash change, printable receipt. Stock deducted automatically; a sale either fully succeeds or nothing changes
- Sales History: every receipt, filter by date range / payment / search (receipt no., customer, product), revenue, gross profit, average sale, daily revenue chart, top products
- Customers & loyalty: points per KSh 100 spent, Bronze/Silver/Gold tiers, redeem points as discount, bonus awards, shopping behaviour per customer
- Low-stock alerts: quantity ≤ reorder level
- AI assistant: sends live inventory + 7-day sales to Claude for restock recommendations

## Automation, alerts & reports
- **Product Performance**: every product ranked best to worst by gross profit, classified as Top performer / Steady / New / Slow mover / Dead stock, with money tied up in idle stock.
- **Auto Restock**: a background job (every `AUTOMATION_INTERVAL_MINUTES`, default 60, plus "Run checks now") creates purchase orders for low stock. Established products are ordered automatically; new products (under 14 days) go to the owner for review; dead stock is never re-ordered. Mark orders *Received* to add the stock.
- **New product check**: projects demand from early sales and recommends Restock / Not yet / Wait / Do not restock.
- **Email alerts**: restock orders, weekly dead-stock digest, monthly report. Set the owner email in *Alerts & Settings* and SMTP in `backend/.env` (see `.env.example`; for Gmail use an App Password). Without SMTP every alert is kept in the in-app outbox.
- **Reports**: Sales, Inventory, Product Performance, Customers & Loyalty, Restock, and Monthly Performance - as PDF or Excel for any period, e.g. `DukaBuddy_Sales_Report_2026-10-01_to_2026-10-31.pdf`. Last month's full report is emailed automatically on the 1st.

The scheduler runs only when the backend is started with `python app.py`.

## Reset demo data
Stop the backend, delete `backend/dukabuddy.db`, start again. Sample products are re-seeded.
