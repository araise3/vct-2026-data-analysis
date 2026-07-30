@echo off
REM Double-click this to run the VCT 2025 (historical) scraper. Automatically
REM navigates to this folder and activates the virtual environment first,
REM regardless of where the folder is located or where this file was
REM double-clicked from. Uses the same venv as the current-season scraper --
REM no separate setup needed if setup.bat has already been run once.
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python vlr_vct_2025_scraper.py --resume

echo.
echo Done. Press any key to close this window.
pause >nul
