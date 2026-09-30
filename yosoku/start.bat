@echo off
cd /d "%~dp0"
echo Starting... (do not close this window)
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist server.js goto nofile
start "" http://localhost:8787
node server.js
echo.
echo Server stopped. See the message above.
pause
exit /b
:nonode
echo Node.js not found. Reinstall from https://nodejs.org or restart Windows, then retry.
pause
exit /b
:nofile
echo server.js not found. Put all files in the same folder.
pause
exit /b
