@echo off
rem Starts (or updates) NyamsComm in Docker: database + backend + web app.
rem Staff devices on the shop Wi-Fi open the address printed at the end.
cd /d %~dp0
rem Works around a Docker Compose build bug on Windows ("additional privileges requested")
set BUILDX_BAKE_ENTITLEMENTS_FS=0

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Start Docker Desktop, wait until it says "Engine running", then run this again.
  pause
  exit /b 1
)

if not exist .env (
  echo First run: creating .env with a random database password...
  for /f %%p in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do (
    > .env echo POSTGRES_PASSWORD=%%p
  )
  >> .env echo APP_PORT=80
  >> .env echo DEMO_DATA=0
)
set APP_PORT=80
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="APP_PORT" set APP_PORT=%%b

echo Building and starting NyamsComm (the first time takes a few minutes)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Something went wrong starting NyamsComm. See the messages above.
  pause
  exit /b 1
)

echo Waiting for NyamsComm to be ready...
set /a tries=0
:wait
curl -sf http://localhost:%APP_PORT%/api/health >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% geq 60 (
  echo NyamsComm did not start. Check the log with:  docker compose logs backend
  pause
  exit /b 1
)
timeout /t 2 >nul
goto wait

:ready
set SUFFIX=
if not "%APP_PORT%"=="80" set SUFFIX=:%APP_PORT%
echo.
echo  NyamsComm is running.
echo    On this computer:   http://localhost%SUFFIX%
echo    Staff devices on the shop Wi-Fi:
for /f %%i in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike 'vEthernet*' } | ForEach-Object { $_.IPAddress }"') do echo                         http://%%i%SUFFIX%
echo.
echo  It keeps running in the background and restarts with Docker Desktop.
start http://localhost%SUFFIX%
pause
