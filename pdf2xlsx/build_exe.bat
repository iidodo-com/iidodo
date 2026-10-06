@echo off
rem Windows で実行ファイル(dist\pdf2xlsx\pdf2xlsx.exe)を作る。Python 3 が必要。
python -m pip install pdfplumber openpyxl pyinstaller || exit /b 1
python -m PyInstaller --noconfirm --clean --onedir --name pdf2xlsx --collect-all pdfminer pdf2xlsx.py || exit /b 1
copy /Y config.json dist\pdf2xlsx\config.json
echo.
echo 完成: dist\pdf2xlsx\pdf2xlsx.exe  （config.json は同じフォルダに置いたまま使う）
