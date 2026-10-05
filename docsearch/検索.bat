@echo off
setlocal EnableExtensions
rem 検索画面を開きます。
pushd "%~dp0"
if errorlevel 1 goto NOFOLDER
set "PY=%USERPROFILE%\docsearch_data\venv\Scripts\python.exe"
if not exist "%PY%" goto NOPY
if not exist config.toml goto NOCONFIG
"%PY%" gui.py
if errorlevel 1 pause
popd
exit /b 0

:NOFOLDER
echo このフォルダを開けません。共有フォルダに接続できているか確認してください。
pause
exit /b 1
:NOPY
echo Python 環境がありません: %PY%
echo 先に「セットアップ.bat」を実行してください。途中でエラーが出ていた場合は、その内容を確認してください。
pause
exit /b 1
:NOCONFIG
echo 設定ファイル config.toml がありません: %CD%\config.toml
echo 先に「セットアップ.bat」を最後まで実行してください。
pause
exit /b 1
