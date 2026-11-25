@echo off
title ATHENA NODE
cd /d "%~dp0"
call "%~dp0run-node.cmd"
if errorlevel 1 pause
