@echo off
title ATHENA NODE SETUP
cd /d "%~dp0"

call "%~dp0setup-runtime.cmd"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo   ================================================
echo    ATHENA NODE
echo   ================================================
echo    The next window is THIS PC's node. Keep it open.
echo    It shows a six-character pairing code.
echo    On the hub: NODES - SCAN - LINK, then enter the code.
echo.
echo    If Windows asks about the firewall, allow PRIVATE
echo    networks so the hub can reach this PC.
echo.
pause
call "%~dp0Start Node.cmd"
