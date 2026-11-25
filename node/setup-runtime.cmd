@echo off
rem Find Node 20+; install it if missing or upgrade it if it is too old.
rem Used by Install Node.cmd in the source tree and in the portable package.
setlocal
cd /d "%~dp0"

set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

set "NODE_OLD="
if not defined NODE_EXE (
  echo.
  echo   Node.js 20 or newer is required. Installing the LTS build with winget...
) else (
  "%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
  if errorlevel 1 (
    set "NODE_OLD=1"
    echo.
    echo   This PC has an old Node.js:
    "%NODE_EXE%" --version
    echo   Updating to the current LTS build with winget...
  )
)

if defined NODE_EXE if not defined NODE_OLD (
  echo   Node.js is already installed and supported.
  exit /b 0
)

where winget >nul 2>nul
if errorlevel 1 (
  echo.
  echo   winget is not available on this PC.
  echo   Install Node.js 20+ from https://nodejs.org/ and run this file again.
  exit /b 1
)

if defined NODE_OLD (
  winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
) else (
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
)
if errorlevel 1 (
  echo.
  echo   winget could not provide Node.js 20+.
  echo   Install it from https://nodejs.org/ and run this file again.
  exit /b 1
)

echo.
echo   Node.js is ready. The launcher checks the standard install path, so a
echo   stale PATH in this window is not a problem.
exit /b 0
