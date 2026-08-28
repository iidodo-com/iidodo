@echo off
setlocal
rem One-click launcher. Double-click this file to start the app.
rem This file is written in plain ASCII on purpose: if it contains
rem Japanese text, some download/unzip paths can re-encode the file
rem and corrupt it, causing cmd.exe to run garbled text as commands.
rem The web app itself is fully in Japanese; only this console
rem window is in English.
cd /d "%~dp0"

echo Checking this folder...
echo Folder: %cd%
echo.

if not exist "package.json" (
  echo ======================================================
  echo   package.json was not found in this folder.
  echo   Put start.bat in the same folder as package.json
  echo   and the context folder, then run it again.
  echo ======================================================
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ======================================================
  echo   npm (Node.js) was not found on this computer.
  echo   Install Node.js LTS from https://nodejs.org/
  echo   then double-click this file again.
  echo   If you cannot install software on this PC, ask your
  echo   IT department whether Node.js can be installed.
  echo ======================================================
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if not exist ".env.example" (
    echo ======================================================
    echo   .env.example was not found, so .env could not be
    echo   created. Make sure the whole project was unzipped
    echo   correctly.
    echo ======================================================
    echo.
    pause
    exit /b 1
  )
  copy ".env.example" ".env" >nul
  echo.
  echo ======================================================
  echo   .env was created.
  echo   Notepad will open. After ANTHROPIC_API_KEY= paste your
  echo   own API key (from https://console.anthropic.com),
  echo   save the file, then close Notepad to continue.
  echo ======================================================
  echo.
  start /wait notepad ".env"
)

if not exist "node_modules" (
  echo Installing dependencies for the first run, this can take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo ======================================================
    echo   npm install failed. Check the error message above
    echo   (a proxy or network restriction can cause this).
    echo ======================================================
    pause
    exit /b 1
  )
)

echo.
echo Starting the app. If the browser does not open by itself,
echo open http://localhost:5173 manually.
echo Closing this window will stop the app.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"
call npm run dev

echo.
echo The app has stopped.
pause
