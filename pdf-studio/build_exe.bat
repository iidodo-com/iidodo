@echo off
rem Windows で実行ファイル(dist\PDFStudio\PDFStudio.exe)を作る。Python 3 が必要。
python -m pip install -r requirements.txt pyinstaller || exit /b 1
python -m PyInstaller --noconfirm --clean --onedir --name PDFStudio --add-data "index.html;." --collect-all pdfminer --collect-all pypdfium2_raw --collect-all pypdfium2 app.py || exit /b 1
echo.
echo 完成: dist\PDFStudio\PDFStudio.exe
