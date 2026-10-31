@echo off
cd /d %~dp0
if not exist backend\venv (python -m venv backend\venv && backend\venv\Scripts\pip install -r backend\requirements.txt)
if not exist backend\.env copy backend\.env.example backend\.env
if not exist frontend\node_modules (cd frontend && call npm install && cd ..)
start "DukaBuddy API" cmd /k "cd backend && venv\Scripts\python app.py"
start "DukaBuddy UI" cmd /k "cd frontend && npm run dev"
timeout /t 4 >nul
start http://localhost:5173
