@echo off
rem Start Valleverde PM on Windows. Double-click this file.
cd /d "%~dp0"
where node >nul 2>nul || (echo Valleverde PM needs Node.js 18 or newer: https://nodejs.org & pause & exit /b 1)
node server.js --open
pause
