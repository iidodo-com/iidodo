@echo off
setlocal EnableExtensions
rem 初回だけ実行します。Python の部品を自分のPCに入れ、設定ファイル config.toml を作ります。
rem 注意: cmd は if の括弧ブロック内の ) で崩れやすいため、ブロックを使わず goto で書いています。
pushd "%~dp0"
if errorlevel 1 goto NOFOLDER
set "DATA=%USERPROFILE%\docsearch_data"
set "PY=%DATA%\venv\Scripts\python.exe"
set "PYEXE=python"
where python >nul 2>&1
if not errorlevel 1 goto HAVEPYTHON
set "PYEXE=py -3"
where py >nul 2>&1
if errorlevel 1 goto NOPYTHON
:HAVEPYTHON
if not exist "%DATA%" mkdir "%DATA%"
if exist "%PY%" goto HAVEVENV
echo [1/3] 自分のPCに Python の環境を作ります: %DATA%\venv
%PYEXE% -m venv "%DATA%\venv"
if errorlevel 1 goto VENVFAIL
:HAVEVENV
if exist wheels\ goto OFFLINE
echo [2/3] 必要な部品をインストールします。インターネット接続が必要です。
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto PIPFAIL
goto STEP3
:OFFLINE
echo [2/3] 同梱の部品ファイル wheels からインストールします。インターネット接続は不要です。
"%PY%" -m pip install --no-index --find-links wheels -r requirements.txt
if errorlevel 1 goto PIPFAIL
:STEP3
echo [3/3] 設定ファイルを作ります
if exist config.toml goto HAVECONFIG
echo.
echo 最初に検索したいフォルダのパスを入力して Enter を押してください。
echo 例: \\サーバ名\共有名\フォルダ名   または   D:\資料
echo 何も入力せずに Enter を押すと、あとで検索画面の「選択」ボタンでフォルダを選べます。
set "ROOT="
set /p "ROOT=パス: "
if not defined ROOT goto NOROOT
set "ROOT=%ROOT:"=%"
"%PY%" setup_config.py "%ROOT%"
if errorlevel 1 goto FAIL
goto DONE
:NOROOT
"%PY%" setup_config.py
if errorlevel 1 goto FAIL
goto DONE
:HAVECONFIG
echo config.toml は既にあります。変更しません。
:DONE
echo.
echo セットアップが完了しました。次に「検索.bat」を実行し、「選択」ボタンで検索したいフォルダを選んでください（初回は、そのフォルダのインデックスが作られます）。
pause
popd
exit /b 0

:NOFOLDER
echo このフォルダを開けません。共有フォルダに接続できているか確認してください。
pause
exit /b 1
:NOPYTHON
echo Python が見つかりません。python.org から Python 3.14 を入れてください。
echo インストール画面で「Add python.exe to PATH」にチェックを入れるのを忘れずに。
pause
exit /b 1
:VENVFAIL
echo Python 環境の作成に失敗しました。上のエラー文を確認してください。
pause
exit /b 1
:PIPFAIL
echo 部品のインストールに失敗しました。上のエラー文を確認してください。README の「pip install が失敗したとき」も参照してください。
pause
exit /b 1
:FAIL
echo config.toml を作成できませんでした。上のメッセージを確認して、もう一度実行してください。
pause
exit /b 1
