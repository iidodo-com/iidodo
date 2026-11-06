@echo off
rem 手元資料LLM処理 起動スクリプト（Windows）。Node.js が必要です。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ から Windows ARM64 版を入れるか、README の Python 手順を参照してください。
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8787/"
node serve.mjs --port 8787 %*
