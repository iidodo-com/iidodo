@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==== OCRツール セットアップ ====
echo.

rem --- Python を探す（py ランチャー優先） ---
set "PYCMD="
py -3 --version >nul 2>&1 && set "PYCMD=py -3"
if not defined PYCMD (
  python --version >nul 2>&1 && set "PYCMD=python"
)
if not defined PYCMD (
  echo [エラー] Python が見つかりません。
  echo   python.org から Python 3.11 以上をインストールしてください。
  echo   インストーラで「Install Just for Me」と「Add python.exe to PATH」を選ぶと、管理者権限なしで入ります。
  pause
  exit /b 1
)
%PYCMD% -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)"
if errorlevel 1 (
  echo [エラー] Python のバージョンが古いです。3.11 以上をインストールしてください。
  %PYCMD% --version
  pause
  exit /b 1
)

rem --- 仮想環境の作成とライブラリのインストール ---
if not exist ".venv\Scripts\python.exe" (
  echo 仮想環境 .venv を作成します...
  %PYCMD% -m venv .venv
  if errorlevel 1 (
    echo [エラー] 仮想環境を作れませんでした。
    pause
    exit /b 1
  )
)
echo ライブラリをインストールします（初回はダウンロードのため数分かかります）...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [エラー] ライブラリのインストールに失敗しました。ネットワーク接続やプロキシ設定を確認してください。
  pause
  exit /b 1
)

rem --- Tesseract の確認 ---
echo.
echo Tesseract と日本語データを確認します...
".venv\Scripts\python.exe" check_env.py
echo.
echo セットアップ完了。次は run.bat を実行してください（in フォルダの画像・PDFを読み取ります）。
pause
