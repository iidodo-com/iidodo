@echo off
chcp 65001 >nul
where python >nul 2>nul && (python "%~dp0main.py" %*) || (py "%~dp0main.py" %*)
pause
