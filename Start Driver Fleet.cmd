@echo off
title Driver Fleet Lease CRM
cd /d "%~dp0"
if not defined PORT set PORT=4330
start "" http://localhost:%PORT%
npm.cmd start
pause
