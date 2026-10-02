@echo off
cd /d "%~dp0"
rem 使い方:
rem   run.bat                ... in フォルダを読み取り、out フォルダに出力（横書き）
rem   run.bat フォルダ       ... フォルダを run.bat にドラッグ＆ドロップしても可（出力は そのフォルダ\out_ocr）
rem   run.bat --lang jpn_vert ... main.py のオプションをそのまま渡せる（縦書き等）
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
if not "%~1"=="" if exist "%~1\" (
  ".venv\Scripts\python.exe" main.py --input "%~1" --output "%~1\out_ocr"
  goto done
)
if not exist "in\" mkdir "in"
".venv\Scripts\python.exe" main.py --input ./in --output ./out %*
:done
echo.
echo 終了しました。結果は out フォルダ（またはドロップしたフォルダの out_ocr）にあります。
echo   review.csv ... 人が確認すべき箇所 / error.log ... 失敗の記録
pause
