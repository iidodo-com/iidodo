@echo off
cd /d "%~dp0"
echo Starting... (do not close this window)
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist server.js goto nofile
rem --- use the Windows/IE proxy setting if PROXY is not set ---
if defined PROXY goto run
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2^>nul') do set PROXY=%%b
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v AutoConfigURL 2^>nul') do echo NOTE: PAC script in use: %%b
:run
if defined PROXY (echo Proxy: %PROXY%) else (echo Proxy: none)
start "" http://localhost:8787
node server.js
echo.
echo Server stopped. See the message above.
pause
exit /b
:nonode
echo Node.js not found. Restart Windows, then retry.
pause
exit /b
:nofile
echo server.js not found. Put all files in the same folder.
pause
exit /b
