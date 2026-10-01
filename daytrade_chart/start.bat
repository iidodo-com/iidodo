@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo 初回セットアップ中です（数分かかります）...
  python -m venv .venv || (echo Python 3.11以上をインストールしてください & pause & exit /b 1)
  call .venv\Scripts\activate.bat
  python -m pip install -r requirements.txt || (pause & exit /b 1)
) else (
  call .venv\Scripts\activate.bat
)
if not exist .env copy .env.example .env >nul
echo.
echo ブラウザで http://127.0.0.1:8000 を開いてください（終了は Ctrl+C）
start "" http://127.0.0.1:8000
python main.py %*
pause
