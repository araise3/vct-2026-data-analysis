@echo off
REM One-time setup: creates the virtual environment and installs everything
REM needed. Run this once before using the other .bat files.
cd /d "%~dp0"

echo Creating virtual environment...
python -m venv venv

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Setup complete. You can now use run_scraper.bat, run_ewc_scraper.bat,
echo and export_csv.bat.
pause
