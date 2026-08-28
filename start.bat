@echo off
chcp 932 >nul
setlocal
rem ワンクリック起動用スクリプト。このファイルをダブルクリックするだけで起動する。
rem エラーが起きても黒い画面がすぐ閉じないよう、失敗した箇所で必ず pause する。
rem このファイル自体は Shift-JIS（CP932）で保存すること。UTF-8で保存すると
rem 日本語版Windowsのコマンドプロンプトで文字化けし、コマンドとして誤認識される。
cd /d "%~dp0"

echo このフォルダで起動チェックをしています…
echo フォルダ: %cd%
echo.

if not exist "package.json" (
  echo ======================================================
  echo   このフォルダに package.json が見つかりません。
  echo   start.bat は、プロジェクト一式を展開したフォルダの
  echo   直下（package.json や context フォルダと同じ階層）に
  echo   置いて実行してください。
  echo ======================================================
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ======================================================
  echo   npm（Node.js）が見つかりませんでした。
  echo   このパソコンに Node.js がインストールされていないか、
  echo   PATH が通っていない可能性があります。
  echo.
  echo   https://nodejs.org/ja/ からインストーラー版（LTS）を
  echo   インストールしてから、もう一度このファイルを
  echo   ダブルクリックしてください。
  echo   （社用PCでインストールできない場合は、情報担当部署に
  echo   　Node.jsの導入可否を確認してください）
  echo ======================================================
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  if not exist ".env.example" (
    echo ======================================================
    echo   .env.example が見つからないため、.env を作成できません。
    echo   プロジェクト一式が正しく展開されているか確認してください。
    echo ======================================================
    echo.
    pause
    exit /b 1
  )
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
  echo 初回起動のため依存パッケージをインストールします…（数十秒～数分かかります）
  call npm install
  if errorlevel 1 (
    echo.
    echo ======================================================
    echo   npm install に失敗しました。上に表示されたエラー内容を
    echo   確認してください（ネットワーク制限やプロキシ設定が
    echo   原因のことがあります）。
    echo ======================================================
    pause
    exit /b 1
  )
)

echo.
echo 起動します。ブラウザが自動で開かない場合は、
echo   http://localhost:5173  を手動で開いてください。
echo このウィンドウを閉じるとアプリも終了します。
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"
call npm run dev

echo.
echo アプリが終了しました。
pause
