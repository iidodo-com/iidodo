@echo off
setlocal EnableExtensions
rem 初回だけ実行します。Python の部品を自分のPCに入れ、設定ファイル(config.toml)を作ります。
pushd "%~dp0" || (echo このフォルダを開けません。共有フォルダに接続できているか確認してください。& pause & exit /b 1)
set "DATA=%USERPROFILE%\docsearch_data"
set "PY=%DATA%\venv\Scripts\python.exe"

where python >nul 2>&1
if errorlevel 1 (
  echo Python が見つかりません。python.org から Python 3.14 を入れてください。
  echo インストール画面で「Add python.exe to PATH」にチェックを入れるのを忘れずに。
  pause & exit /b 1
)
if not exist "%DATA%" mkdir "%DATA%"
if not exist "%PY%" (
  echo [1/3] 自分のPCに Python の環境を作ります: %DATA%\venv
  python -m venv "%DATA%\venv"
  if errorlevel 1 (echo 環境の作成に失敗しました。& pause & exit /b 1)
)
if exist wheels\ (
  echo [2/3] 同梱の部品ファイル(wheels)からインストールします（インターネット接続は不要です）
  "%PY%" -m pip install --no-index --find-links wheels -r requirements.txt
) else (
  echo [2/3] 必要な部品をインストールします（インターネット接続が必要です）
  "%PY%" -m pip install -r requirements.txt
)
if errorlevel 1 (
  echo インストールに失敗しました。上のエラー文を確認してください（README の「pip install が失敗したとき」を参照）。
  pause & exit /b 1
)
echo [3/3] 設定ファイルを作ります
if exist config.toml (
  echo config.toml は既にあります。変更しません。
) else (
  echo.
  echo 検索したいフォルダのパスを入力して Enter を押してください。
  echo 例: \\サーバ名\共有名\フォルダ名   または   D:\資料
  set "ROOT="
  set /p "ROOT=パス: "
  if not defined ROOT (echo 入力がありません。もう一度実行してください。& pause & exit /b 1)
  set "ROOT=%ROOT:"=%"
  "%PY%" setup_config.py "%ROOT%"
  if errorlevel 1 (pause & exit /b 1)
)
echo.
echo セットアップが完了しました。次に「更新.bat」を実行して、インデックスを作ってください。
pause
popd
