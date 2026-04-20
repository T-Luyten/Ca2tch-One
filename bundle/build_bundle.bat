@echo off
setlocal enabledelayedexpansion

set "BUNDLE_DIR=%~dp0"
set "PYTHON_VERSION=3.12.10"
set "PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip"
set "PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%"
set "PYTHON_DIR=%BUNDLE_DIR%python"
set "PIP_URL=https://bootstrap.pypa.io/get-pip.py"

echo === Ca2+tch-One Bundle Builder ===
echo.

if not exist "%PYTHON_DIR%" (
    echo Downloading Python %PYTHON_VERSION% embedded...
    powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%BUNDLE_DIR%%PYTHON_ZIP%'" 2>nul
    if errorlevel 1 (
        echo.
        echo   ERROR: Could not download Python.
        echo   Check your internet connection and try again.
        echo.
        pause & exit /b 1
    )

    echo Extracting...
    powershell -Command "Expand-Archive -Path '%BUNDLE_DIR%%PYTHON_ZIP%' -DestinationPath '%PYTHON_DIR%' -Force"
    if errorlevel 1 (
        echo   ERROR: Extraction failed.
        pause & exit /b 1
    )

    del "%BUNDLE_DIR%%PYTHON_ZIP%"
)

echo Enabling site-packages...
for %%f in ("%PYTHON_DIR%\*._pth") do (
    powershell -Command "(Get-Content '%%f') -replace '#import site', 'import site' | Set-Content '%%f'"
)

if not exist "%PYTHON_DIR%\Scripts\pip.exe" (
    echo Installing pip...
    powershell -Command "Invoke-WebRequest -Uri '%PIP_URL%' -OutFile '%BUNDLE_DIR%get-pip.py'"
    "%PYTHON_DIR%\python.exe" "%BUNDLE_DIR%get-pip.py" --no-warn-script-location -q
    del "%BUNDLE_DIR%get-pip.py"
)

echo Installing dependencies (this may take a few minutes)...
"%PYTHON_DIR%\python.exe" -m pip install -q --no-warn-script-location -r "%BUNDLE_DIR%..\backend\requirements.txt"
if errorlevel 1 (
    echo.
    echo   ERROR: Dependency installation failed.
    pause & exit /b 1
)

if not exist "%BUNDLE_DIR%backend" (
    echo Copying backend...
    xcopy /E /I /Q "%BUNDLE_DIR%..\backend" "%BUNDLE_DIR%backend" >nul
)

if not exist "%BUNDLE_DIR%frontend" (
    echo Copying frontend...
    xcopy /E /I /Q "%BUNDLE_DIR%..\frontend" "%BUNDLE_DIR%frontend" >nul
)

echo.
echo === Bundle ready! Run start.bat to launch the app. ===
echo.
pause
