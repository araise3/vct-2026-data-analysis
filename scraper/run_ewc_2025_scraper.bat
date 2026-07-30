@echo off
REM Double-click this to run the EWC 2025 (historical) scraper. Same behavior
REM as run_ewc_scraper.bat, same venv.
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python vlr_ewc_2025_scraper.py --resume

echo.
echo Done. Press any key to close this window.
pause >nul
