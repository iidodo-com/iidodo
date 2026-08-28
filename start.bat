@echo off
setlocal
rem ワンクリック起動用スクリプト。このファイルをダブルクリックするだけで起動する。
cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo ======================================================
  echo   .env を新規作成しました。
  echo   ANTHROPIC_API_KEY= の後にご自身のAPIキーを貼り付けて
  echo   保存し、メモ帳を閉じてください。
  echo   （キーは https://console.anthropic.com で発行できます）
  echo ======================================================
  echo.
  start /wait notepad ".env"
)

if not exist "node_modules" (
  echo 初回起動のため依存パッケージをインストールします…（数十秒かかります）
  call npm install
  if errorlevel 1 (
    echo npm install に失敗しました。エラー内容を確認してください。
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"
call npm run dev

pause
