@echo off
title ATHENA NODE
cd /d "%~dp0"
node athena-node.mjs
if errorlevel 1 pause
