@echo off
setlocal EnableExtensions
rem インデックスを作成・更新します（初回も、文書が増えたときも同じ）。文書は読み取るだけで、変更しません。
pushd "%~dp0" || (echo このフォルダを開けません。共有フォルダに接続できているか確認してください。& pause & exit /b 1)
set "PY=%USERPROFILE%\docsearch_data\venv\Scripts\python.exe"
if not exist "%PY%" (echo 先に「セットアップ.bat」を実行してください。& pause & exit /b 1)
if not exist config.toml (echo 先に「セットアップ.bat」を実行してください。& pause & exit /b 1)
"%PY%" index.py
echo.
echo 終了コード: %errorlevel%（0 なら正常です。エラー文が出ている場合は、その内容を確認してください）
pause
popd
