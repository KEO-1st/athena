@echo off
title ATHENA NODE
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required. Installing it with winget...
  echo.
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  echo.
)

node athena-node.mjs
if errorlevel 1 pause
