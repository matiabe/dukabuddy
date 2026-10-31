@echo off
rem DELETES ALL SHOP DATA (products, sales, customers, staff accounts) and starts with an empty database.
cd /d %~dp0
echo.
echo  WARNING: this permanently deletes ALL NyamsComm data:
echo  products, sales history, customers, loyalty points and staff accounts.
echo  Run backup.bat first if you might need any of it.
echo.
set /p CONFIRM=Type DELETE to continue: 
if not "%CONFIRM%"=="DELETE" (
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 0
)
docker compose down -v
echo Database deleted. Run start.bat to start fresh.
pause
