@echo off
rem Saves a full copy of the shop database to backups\dukabuddy_YYYY-MM-DD_HHMM.sql
rem Copy the backups folder to a flash disk or Google Drive regularly.
cd /d %~dp0
if not exist backups mkdir backups
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%t
docker exec dukabuddy-db pg_dump -U dukabuddy --clean --if-exists dukabuddy > backups\dukabuddy_%STAMP%.sql
if errorlevel 1 (
  echo Backup FAILED. Is NyamsComm running?
  del backups\dukabuddy_%STAMP%.sql >nul 2>&1
  pause
  exit /b 1
)
echo Backup saved: backups\dukabuddy_%STAMP%.sql
pause
