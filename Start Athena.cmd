@echo off
title ATHENA HUB - keep this window open
cd /d "%~dp0"

rem --- if the hub is already up, just show its code and open it ---
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',4790); exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo.
  echo   ================================================
  echo    ATHENA HUB IS ALREADY RUNNING
  echo   ================================================
  echo.
  if exist "data\access-code.txt" (
    echo    ACCESS CODE:
    type "data\access-code.txt"
    echo.
    echo    Type that code on your phone or iPad.
    echo    On THIS PC the app opens by itself.
    echo    The code is also on SYSTEM ^> THIS HUB in the app.
    echo.
  )
  echo    Opening the app...
  start "" "http://127.0.0.1:4790/"
  echo.
  echo    Nothing else to do here - you can close THIS window.
  echo    The hub is the other ATHENA window that is already
  echo    running. To stop it: app ^> SYSTEM ^> SHUT DOWN HUB,
  echo    or close that window.
  echo.
  timeout /t 12
  exit /b 0
)

powershell -NoProfile -Command "if (Get-Command node -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo.
  echo   Node.js is required. Installing it with winget...
  echo.
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
)

echo.
echo   ================================================
echo    ATHENA HUB
echo   ================================================
echo    This window IS the hub. Keep it open.
echo    Your access code is printed below in a box.
echo    Everything you can control is also in the app:
echo      SYSTEM ^> THIS HUB      code, address, uptime
echo      SYSTEM ^> SHUT DOWN     stop the hub
echo      SYSTEM ^> BRAIN         INSTALL BRAIN / UPGRADE BRAIN
echo    The browser opens by itself in a moment.
echo.

rem --- open the app a few seconds after the hub starts listening ---
start /min "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:4790/'"

node server.mjs
if errorlevel 1 pause
