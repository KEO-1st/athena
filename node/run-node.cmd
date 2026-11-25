@echo off
rem Shared launcher: find Node 20+, including a just-installed copy that is not
rem on this cmd.exe process's PATH yet, then start athena-node.mjs.
setlocal
cd /d "%~dp0"

set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Links\node.exe"
if not defined NODE_EXE for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"

if not defined NODE_EXE (
  echo.
  echo   Node.js 20 or newer was not found.
  echo   Run "Install Node.cmd" in this folder, or install the LTS build from
  echo   https://nodejs.org/ and run "Start Node.cmd" again.
  echo.
  exit /b 1
)

"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo   This PC has an old Node.js:
  "%NODE_EXE%" --version
  echo   ATHENA Node needs Node.js 20 or newer.
  echo   Run "Install Node.cmd" to update it, or install the LTS build from
  echo   https://nodejs.org/ and run "Start Node.cmd" again.
  echo.
  exit /b 1
)

if not exist "athena-node.mjs" (
  echo.
  echo   athena-node.mjs is missing. Extract the whole ATHENA Node folder,
  echo   not only this script.
  echo.
  exit /b 1
)

"%NODE_EXE%" athena-node.mjs
exit /b %errorlevel%
