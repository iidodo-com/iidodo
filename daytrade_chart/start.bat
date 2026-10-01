@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.11 or later is required. Install it from https://www.python.org/ ^(check "Add python.exe to PATH"^)
  pause
  exit /b 1
)
if not exist .venv (
  echo First-time setup. This takes a few minutes...
  python -m venv .venv
  if errorlevel 1 ( echo Failed to create venv & pause & exit /b 1 )
  call .venv\Scripts\activate.bat
  python -m pip install -r requirements.txt
  if errorlevel 1 ( echo Failed to install packages & pause & exit /b 1 )
) else (
  call .venv\Scripts\activate.bat
)
if not exist .env copy .env.example .env >nul
echo.
echo Open http://127.0.0.1:8000 in your browser. Press Ctrl+C to stop.
start "" http://127.0.0.1:8000
python main.py %*
pause
