@echo off
REM Double-click this to export both databases to CSV (in csv_export/ folders).
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

if exist vlr_vct_2026.db (
    echo Exporting VCT database...
    python export_to_csv.py vlr_vct_2026.db
)

if exist vlr_ewc_2026.db (
    echo Exporting EWC database...
    python export_to_csv.py vlr_ewc_2026.db
)

echo.
echo Done. Press any key to close this window.
pause >nul
