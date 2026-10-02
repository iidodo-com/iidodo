@echo off
cd /d "%~dp0"
rem 帳票突合: in フォルダの帳票を項目ごとに読み取り、reference.csv（突合元）と照合します。
rem   reference.csv が無ければ、突合せず読み取りだけ行います。
rem   結果は out_form フォルダ（report.html をブラウザで開いて確認）
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
if not exist "in\" mkdir "in"
if exist "reference.csv" (
  ".venv\Scripts\python.exe" reconcile.py --template templates\hiroshima_invoice.yaml --input ./in --reference reference.csv --output ./out_form %*
) else (
  echo reference.csv が見つからないため、読み取りのみ行います。
  ".venv\Scripts\python.exe" reconcile.py --template templates\hiroshima_invoice.yaml --input ./in --output ./out_form %*
)
echo.
echo 終了しました。out_form\report.html をブラウザで開いて確認してください。
if exist "out_form\report.html" start "" "out_form\report.html"
pause
