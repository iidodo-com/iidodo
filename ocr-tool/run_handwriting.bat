@echo off
cd /d "%~dp0"
rem 手書き文書用。in フォルダを手書き用モデルで読み取り、out_handwriting フォルダに出力します。
rem   事前に setup_handwriting.bat が必要です。信頼度は目安で、結果は必ず目視で確認してください。
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
if not exist "in\" mkdir "in"
".venv\Scripts\python.exe" main.py --input ./in --output ./out_handwriting --engine handwriting %*
echo.
echo 終了しました。結果は out_handwriting フォルダにあります（all.txt と review.csv）。
pause
