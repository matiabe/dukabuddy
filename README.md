# NyamsComm — AI Shop Assistant for Electronics Dealers

React + Vite + Tailwind frontend, Flask + PostgreSQL backend, optional Claude AI. Runs entirely in Docker
on one shop computer; the owner and staff use it from any phone, tablet or laptop on the shop Wi-Fi.

## Running the shop (Docker)
**Needs:** a Windows computer that stays on during shop hours, with [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.

1. Start Docker Desktop. In its Settings > General, tick **Start Docker Desktop when you sign in** so NyamsComm comes back after a restart.
2. Double-click **`start.bat`**. The first run builds the app (a few minutes) and creates `.env` with a random database password.
   At the end it prints the address for staff devices, e.g. `http://192.168.150.15`.
3. Open the app. The first screen creates the **owner account**. Then go to **Staff accounts** and add a login for each staff member.
4. Import your products: **Products > Import from Excel** (see below).
5. On each staff phone/tablet/laptop (same Wi-Fi), open the printed address and log in. Bookmark it or "Add to Home screen".

Run `start.bat` again any time: after updating the code it rebuilds and restarts, keeping all data.

**Containers** (`docker-compose.yml`): `db` (PostgreSQL 17, data in volume `dukabuddy_dukabuddy_pgdata`), `backend` (Flask on gunicorn,
runs the automation scheduler) and `web` (nginx: serves the app and forwards `/api` to the backend). Only `web` is reachable
from the network, on port 80. The database port is bound to this computer only.

### Keep the shop address from changing
The address staff use is this computer's IP on the Wi-Fi. Routers can hand out a different IP after a restart, so in the
router's admin page reserve a fixed IP (*DHCP reservation* / *static lease*) for this computer.

### If staff devices can't connect
- The computer and the devices must be on the **same Wi-Fi** (not a guest network).
- Windows Settings > Network > Wi-Fi > set the network to **Private**.
- Allow the port through Windows Firewall (run in an **administrator** Command Prompt):
  `netsh advfirewall firewall add rule name="NyamsComm" dir=in action=allow protocol=TCP localport=80 profile=private`
- Port 80 already used by another program? Set `APP_PORT=8080` in `.env`, run `start.bat`, and use `http://<IP>:8080`.

### Settings (`.env` files, never committed)
| File | Setting | |
|---|---|---|
| `.env` (project root) | `POSTGRES_PASSWORD` | Database password, created by `start.bat`. Don't change it after the first start (the database keeps the old one) unless you reset the database. |
| | `APP_PORT` | Port staff devices use (default 80). |
| | `DEMO_DATA` | `0` = real shop, starts empty (default). `1` = sample electronics shop to try things out. Only applies to a new, empty database. |
| `backend/.env` | `ANTHROPIC_API_KEY`, `SMTP_*`, `OWNER_EMAIL`, `AUTOMATION_INTERVAL_MINUTES`, `AT_*` | AI assistant, email alerts, automation interval, SMS via Africa's Talking (see `backend/.env.example`). Its `DATABASE_URL` is ignored in Docker. |

After changing a setting, run `start.bat` again.

### Backups (do this!)
- **`backup.bat`** saves the whole database to `backups\dukabuddy_<date>.sql`. Run it daily, and copy the `backups` folder
  to a flash disk or Google Drive. If the computer dies, the backups are your shop's records.
- Restore a backup (replaces current data):
  `docker exec -i dukabuddy-db psql -U dukabuddy -d dukabuddy < backups\dukabuddy_2026-10-31_1800.sql`

### Useful commands
```bash
docker compose ps                 # is everything running?
docker compose logs -f backend    # backend log (errors, automation runs)
docker compose down               # stop NyamsComm (data is kept)
```
**`reset-database.bat`** deletes ALL data (asks you to type DELETE first) for a completely fresh start.

## Logins and roles
Everyone logs in with their own username and password. Sessions last 12 hours. After 5 wrong passwords for a username, that username must wait 5 minutes (other staff are not affected).

| | Owner | Staff |
|---|---|---|
| Shop Overview, New Sale (till), receipts, Sales History, Customers (add, view) | ✓ | ✓ |
| Products: view, search, **Restock** (receive deliveries) | ✓ | ✓ |
| Buying prices, profit, margins, stock value | ✓ | hidden |
| Add products, Excel import, bonus points, remove a sale | ✓ | |
| Dashboard, Restocking, Auto Restock, Performance, Reports, AI Assistant, Alerts & Settings | ✓ | |
| Staff accounts: add staff, reset passwords, switch accounts off | ✓ | |

Every receipt records **who served** the customer. Switching an account off or resetting its password logs that person out on every device straight away.
Forgot the owner password? Another owner can reset it. If there is no other owner, run `reset-database.bat` (this deletes everything, so restore from a backup afterwards).

## Developing (code changes with live reload)
Needs Python 3.11+ and Node.js 20+. Double-click **`start-dev.bat`**: it runs only the database in Docker (and stops the Docker
backend/web so the scheduler doesn't run twice), then starts the backend and frontend from source at http://localhost:5173.
```bash
docker compose up -d db
cd backend && python -m venv venv && venv\Scripts\pip install -r requirements.txt && venv\Scripts\python app.py
cd frontend && npm install && npm run dev
```
Locally the backend reads `DATABASE_URL` from `backend/.env` (`postgresql://dukabuddy:<POSTGRES_PASSWORD>@127.0.0.1:5432/dukabuddy`) and loads the sample data unless `DEMO_DATA=0`.
When finished, run `start.bat` to put the shop back on the Docker version.

## Database (PostgreSQL)
- Data lives in the Docker volume `dukabuddy_dukabuddy_pgdata`, so it survives restarts and rebuilds.
- Driver: `pg8000` (pure Python).
- **Coming from the old SQLite version?** Put your `dukabuddy.db` in `backend/` and run
  `venv\Scripts\python migrate_sqlite_to_postgres.py --replace` to copy all data across.

## Enable Claude AI (optional)
Put your key in `backend/.env` (never in the frontend):
```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5-5
```
Run `start.bat` again (it restarts the backend). Without a key, the assistant falls back to rule-based restock advice from the same data.

## Features
- Dashboard: total products, today's sales, inventory value (at cost), low-stock count — all computed live from PostgreSQL
- Add/view/search products, restock received goods
- **Import products from Excel** (Products → *Import from Excel*): upload a `.xlsx` (or `.csv`) stock list, check the preview, then confirm. See below.
- **Shop Overview** (owner and staff): what was sold in a period (today, yesterday, last 7 days, this month or any dates), split by payment method and staff member, plus current stock on hand
- New Sale (till): multi-item cart, loyalty points, payment method (Cash / M-Pesa / Card / Credit, recorded as a label), cash change. Stock deducted automatically; a sale either fully succeeds or nothing changes
  - **Checkout** shows the receipt as a preview first. Nothing is saved until the cashier taps **Record sale** (or **Record & print**). Printing is optional, and the recorded receipt can still be printed afterwards
  - **Agreed price**: type the amount the customer actually paid. Less than the total records the sale at that amount, with the difference shown as an *agreed price reduction* on the receipt and in reports; more than the total gives change (cash only)
  - Works on phones and tablets: the cart sits below the products, with a shortcut button to it
- Sales History: every receipt, filter by date range / payment / search (receipt no., customer, product), revenue, gross profit, average sale, daily revenue chart, top products
  - **Remove a sale** (owner only) that didn't really happen: a reason is required, the stock goes back, loyalty points are reversed, and a copy is kept in the *Removed sales* list
- Customers & loyalty: points per KSh 100 spent, Bronze/Silver/Gold tiers, redeem points as discount, bonus awards, shopping behaviour per customer
- Low-stock alerts: quantity ≤ reorder level
- AI assistant: sends live inventory + 7-day sales to Claude for restock recommendations

## Importing your product list (Excel)
1. Products → **Import from Excel** → *Template* downloads an example file (or use your own sheet).
2. The first row needs headings. Columns are matched by name, so common variants work:
   | Needed | Example headings that work |
   |---|---|
   | Product name (required) | Product name, Item, Description, Model |
   | Buying price (required) | Buying price, Cost, Cost price (KSh), Wholesale |
   | Selling price (required) | Selling price, Price, Retail price |
   | Quantity (required) | Quantity, Qty, Stock, Qty in stock |
   | Category (optional, default *General*) | Category, Type, Department |
   | Reorder level (optional, default 3) | Reorder level, Min stock, Minimum |
   | Brand (optional) | Brand, Make: added in front of the name if the name doesn't already include it |
3. Choose the file: the preview lists new products, products that will be updated, and rows with problems (they are skipped).
4. Click **Import**. A product whose name already exists (ignoring capitals) gets its category, prices, reorder level **and stock quantity** replaced by the file's values. The file is treated as your current stock count.

Prices may contain `KSh`, commas or `/-`. Title rows above the headings, blank rows and a final `TOTAL` row are ignored. Old `.xls` files must be re-saved as `.xlsx`.

## Automation, alerts & reports
- **Product Performance**: every product ranked best to worst by gross profit, classified as Top performer / Steady / New / Slow mover / Dead stock, with money tied up in idle stock.
- **Auto Restock**: a background job (every `AUTOMATION_INTERVAL_MINUTES`, default 60, plus "Run checks now") creates purchase orders for low stock. Established products are ordered automatically; new products (under 14 days) go to the owner for review; dead stock is never re-ordered. Mark orders *Received* to add the stock.
- **New product check**: projects demand from early sales and recommends Restock / Not yet / Wait / Do not restock.
- **Email alerts**: restock orders, weekly dead-stock digest, monthly report. Set the owner email in *Alerts & Settings* and SMTP in `backend/.env` (see `.env.example`; for Gmail use an App Password). Without SMTP every alert is kept in the in-app outbox.
- **SMS alerts** (Africa's Talking): every active user with a phone number (set in *Staff accounts*) can get an SMS for each sale, a low-stock SMS, and an evening summary of the day (owners also see profit; staff never do). Switch each one on or off and set the summary hour in *Alerts & Settings*. Put `AT_USERNAME` and `AT_API_KEY` in `backend/.env` (use `AT_USERNAME=sandbox` to test free in their simulator; `AT_SENDER_ID` is optional). Without them, messages are only kept in the in-app SMS log. Sending runs in the background so the till never waits.
- **Reports**: Sales, Inventory, Product Performance, Customers & Loyalty, Restock, and Monthly Performance - as PDF or Excel for any period, e.g. `NyamsComm_Sales_Report_2026-10-01_to_2026-10-31.pdf`. Last month's full report is emailed automatically on the 1st.

The scheduler runs inside the Docker backend (or in `python app.py` when developing).
