@echo off
cd /d "%~dp0"
rem 分割してダウンロードしたファイル（*.part1, *.part2 ...）を、wheels_hw フォルダの中で1つのファイルに結合します。
if not exist "wheels_hw\" (
  echo wheels_hw フォルダがありません。ダウンロードしたファイルを ocr-tool\wheels_hw に置いてから実行してください。
  pause
  exit /b 1
)
cd wheels_hw
if exist "torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part1" (
  copy /b "torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part1"+"torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part2"+"torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part3"+"torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part4"+"torch-2.11.0+cpu-cp314-cp314-win_amd64.whl.part5" "torch-2.11.0+cpu-cp314-cp314-win_amd64.whl" >nul
  if errorlevel 1 ( echo torch の結合に失敗しました。part1～part5 が全部そろっているか確認してください。& pause & exit /b 1 )
  echo torch を結合しました。
)
if exist "unidic_lite-1.0.8-py3-none-any.whl.part1" (
  copy /b "unidic_lite-1.0.8-py3-none-any.whl.part1"+"unidic_lite-1.0.8-py3-none-any.whl.part2" "unidic_lite-1.0.8-py3-none-any.whl" >nul
  if errorlevel 1 ( echo unidic_lite の結合に失敗しました。part1・part2 がそろっているか確認してください。& pause & exit /b 1 )
  echo unidic_lite を結合しました。
)
echo.
echo 結合が終わりました。次に setup_handwriting.bat を実行してください。
pause
