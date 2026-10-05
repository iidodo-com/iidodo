@echo off
setlocal EnableExtensions
rem 検索画面を開きます。
pushd "%~dp0" || (echo このフォルダを開けません。共有フォルダに接続できているか確認してください。& pause & exit /b 1)
set "PY=%USERPROFILE%\docsearch_data\venv\Scripts\python.exe"
if not exist "%PY%" (echo 先に「セットアップ.bat」を実行してください。& pause & exit /b 1)
if not exist config.toml (echo 先に「セットアップ.bat」を実行してください。& pause & exit /b 1)
"%PY%" gui.py
if errorlevel 1 pause
popd
