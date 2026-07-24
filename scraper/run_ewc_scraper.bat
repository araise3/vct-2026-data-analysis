@echo off
REM Double-click this to run the EWC scraper. Same behavior as run_scraper.bat.
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python vlr_ewc_scraper.py --resume

echo.
echo Done. Press any key to close this window.
pause >nul
