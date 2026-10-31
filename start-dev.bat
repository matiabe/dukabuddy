@echo off
rem DEVELOPERS ONLY: database in Docker, backend + frontend from source with live reload (http://localhost:5173).
rem To run the shop, use start.bat instead.
cd /d %~dp0
echo Starting PostgreSQL (Docker)...
docker compose up -d db
if errorlevel 1 (
  echo.
  echo Could not start PostgreSQL. Make sure Docker Desktop is installed and running, then try again.
  pause
  exit /b 1
)
rem the Docker backend would run a second copy of the scheduler against the same database
docker compose stop backend web >nul 2>&1
:waitdb
docker exec dukabuddy-db pg_isready -U dukabuddy -d dukabuddy >nul 2>&1
if errorlevel 1 (timeout /t 2 >nul & goto waitdb)
if not exist backend\venv (python -m venv backend\venv && backend\venv\Scripts\pip install -r backend\requirements.txt)
if not exist backend\.env copy backend\.env.example backend\.env
if not exist frontend\node_modules (cd frontend && call npm install && cd ..)
start "NyamsComm API" cmd /k "cd backend && venv\Scripts\python app.py"
start "NyamsComm UI" cmd /k "cd frontend && npm run dev"
timeout /t 5 >nul
start http://localhost:5173
