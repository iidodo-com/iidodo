@echo off
cd /d "%~dp0"
rem 縦書き文書用。in フォルダを読み取り、out_vertical フォルダに出力します。
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
if not exist "in\" mkdir "in"
".venv\Scripts\python.exe" main.py --input ./in --output ./out_vertical --lang jpn_vert %*
echo.
echo 終了しました。結果は out_vertical フォルダにあります。
pause
