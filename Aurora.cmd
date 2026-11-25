@echo off
setlocal EnableExtensions
title Aurora
cd /d "%~dp0"

rem ---------------------------------------------------------------
rem  Aurora launcher for Windows. Double-click to start.
rem    Aurora.cmd            start (installs and builds on first run)
rem    Aurora.cmd update     reinstall + rebuild, then start
rem    Aurora.cmd --quiet    start without opening the browser (used at login)
rem ---------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Aurora needs Node.js 22 or newer.
  echo  Opening the download page - install the "LTS" version, then double-click Aurora.cmd again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo.
  echo  Your Node.js is too old ^(version %NODE_MAJOR%^). Aurora needs 22 or newer.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

set OPEN_BROWSER=1
if /i "%~1"=="--quiet" set OPEN_BROWSER=0

if /i "%~1"=="update" (
  if exist ".next" rmdir /s /q ".next"
  if exist "node_modules" rmdir /s /q "node_modules"
)

if not exist "node_modules\next" (
  echo.
  echo  First run: installing Aurora. This takes a few minutes and only happens once.
  call npx --yes pnpm@10 install
  if errorlevel 1 goto failed
)

if not exist ".next\BUILD_ID" (
  echo.
  echo  Building Aurora...
  call npx --yes pnpm@10 run build
  if errorlevel 1 goto failed
)

if "%PORT%"=="" set PORT=3000
if "%OPEN_BROWSER%"=="1" start "" /min cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:%PORT%"
echo.
echo  Keep this window open while you listen. Close it to stop Aurora.
node scripts\start.mjs
exit /b %errorlevel%

:failed
echo.
echo  Something went wrong while setting Aurora up. Check your internet connection and try again,
echo  or run "Aurora.cmd update" to start fresh.
pause
exit /b 1
