@echo off
cd /d "%~dp0"
rem 手書きモード用のライブラリを導入します（任意。約1.5GB・初回のみ）。
rem   wheels_hw フォルダがあれば、そこからオフラインで導入します（プロキシ認証で pip が使えない場合）。
if not exist ".venv\Scripts\python.exe" (
  echo 先に setup.bat を実行してください。
  pause
  exit /b 1
)
if exist "wheels_hw\*.whl" (
  echo wheels_hw フォルダのファイルからオフラインでインストールします...
  ".venv\Scripts\python.exe" -m pip install --no-index --find-links wheels_hw --find-links wheels -r requirements-handwriting.txt
) else (
  echo ライブラリをインストールします（torch を含むため時間がかかります）...
  ".venv\Scripts\python.exe" -m pip install -r requirements-handwriting.txt
)
if errorlevel 1 (
  echo [エラー] インストールに失敗しました。
  echo   407 Proxy Authentication Required と出る場合: set HTTPS_PROXY=http://ユーザー名:パスワード@ホスト:ポート を実行してからやり直してください。
  pause
  exit /b 1
)
echo.
echo ライブラリの導入が完了しました。
if exist "models\manga-ocr-base\config.json" (
  echo 手書き用モデル: models\manga-ocr-base を使用します。
) else (
  echo 手書き用モデルが未配置です。次のどちらかを行ってください。
  echo   A. インターネットに直接つながる環境: 初回の実行時に自動でダウンロードされます（約450MB）。
  echo   B. プロキシ等で自動ダウンロードできない環境: README の「手書きモード」の手順で、ブラウザからモデルのファイルを
  echo      models\manga-ocr-base フォルダに保存し、config.yaml の handwriting.model_dir に ./models/manga-ocr-base と書いてください。
)
pause
