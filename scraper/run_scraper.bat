@echo off
REM Double-click this to run the VCT scraper. Automatically navigates to
REM this folder and activates the virtual environment first, regardless of
REM where the folder is located or where this file was double-clicked from.
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python vlr_vct_scraper.py --resume

echo.
echo Done. Press any key to close this window.
pause >nul
