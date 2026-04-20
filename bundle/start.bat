@echo off
setlocal

set "BUNDLE_DIR=%~dp0"
set "PYTHON=%BUNDLE_DIR%python\python.exe"
set "APP_URL=http://localhost:8001"

if not exist "%PYTHON%" (
    echo.
    echo   Python not found. Run build_bundle.bat first.
    echo.
    pause
    exit /b 1
)

cd /d "%BUNDLE_DIR%backend"

echo.
echo   Starting Ca2+tch-One
echo   Opening %APP_URL% in your browser...
echo.

start "" "%APP_URL%"
"%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8001
