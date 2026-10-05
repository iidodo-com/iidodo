@echo off
setlocal EnableExtensions
rem インデックスを作成・更新します。初回も、文書が増えたときも同じです。文書は読み取るだけで、変更しません。
pushd "%~dp0"
if errorlevel 1 goto NOFOLDER
set "PY=%USERPROFILE%\docsearch_data\venv\Scripts\python.exe"
if not exist "%PY%" goto NOPY
if not exist config.toml goto NOCONFIG
"%PY%" index.py
echo.
echo 終了コード: %errorlevel%  0 なら正常です。エラー文が出ている場合は、その内容を確認してください。
pause
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
