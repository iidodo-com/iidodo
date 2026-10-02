@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem samples フォルダの画像・PDFで、前処理あり/なしの精度を比較します。
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
set "PYTHONUTF8=1"
".venv\Scripts\python.exe" compare.py --input ./samples %*
echo.
echo 結果は out_compare\compare.csv にも保存されています。
pause
