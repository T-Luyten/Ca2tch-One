@echo off
setlocal enabledelayedexpansion

set "BUNDLE_DIR=%~dp0"
set "PYTHON_VERSION=3.12.10"
set "PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip"
set "PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%"
set "PYTHON_HASH=4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
set "PYTHON_DIR=%BUNDLE_DIR%python"
set "PIP_URL=https://bootstrap.pypa.io/get-pip.py"
set "PIP_HASH=a62bd3e0f81a72d8cf70b5d5c0fb7299cdc88a4d1ad91a9b18c19fa4ac2fdb0c"

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

    echo Verifying Python integrity...
    for /f "tokens=*" %%h in ('powershell -Command "[System.Security.Cryptography.SHA256]::Create() ^| ForEach-Object { $file = Get-Item '%BUNDLE_DIR%%PYTHON_ZIP%'; $stream = [System.IO.File]::OpenRead($file.FullName); $hash = $_.ComputeHash($stream); $stream.Close(); [System.BitConverter]::ToString($hash) -replace '-', '' } "') do (
        set "ACTUAL_HASH=%%h"
    )
    if /i not "%ACTUAL_HASH%"=="%PYTHON_HASH%" (
        echo   ERROR: Python integrity check failed.
        echo   Expected: %PYTHON_HASH%
        echo   Got:      %ACTUAL_HASH%
        del "%BUNDLE_DIR%%PYTHON_ZIP%"
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
    if errorlevel 1 (
        echo   ERROR: Could not download pip.
        pause & exit /b 1
    )

    echo Verifying pip integrity...
    for /f "tokens=*" %%h in ('powershell -Command "[System.Security.Cryptography.SHA256]::Create() ^| ForEach-Object { $file = Get-Item '%BUNDLE_DIR%get-pip.py'; $stream = [System.IO.File]::OpenRead($file.FullName); $hash = $_.ComputeHash($stream); $stream.Close(); [System.BitConverter]::ToString($hash) -replace '-', '' } "') do (
        set "ACTUAL_PIP_HASH=%%h"
    )
    if /i not "%ACTUAL_PIP_HASH%"=="%PIP_HASH%" (
        echo   ERROR: Pip integrity check failed.
        echo   Expected: %PIP_HASH%
        echo   Got:      %ACTUAL_PIP_HASH%
        del "%BUNDLE_DIR%get-pip.py"
        pause & exit /b 1
    )

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

echo Syncing backend...
if exist "%BUNDLE_DIR%backend" rmdir /S /Q "%BUNDLE_DIR%backend"
xcopy /E /I /Q "%BUNDLE_DIR%..\backend" "%BUNDLE_DIR%backend" >nul

echo Syncing frontend...
if exist "%BUNDLE_DIR%frontend" rmdir /S /Q "%BUNDLE_DIR%frontend"
xcopy /E /I /Q "%BUNDLE_DIR%..\frontend" "%BUNDLE_DIR%frontend" >nul

echo.
echo === Bundle ready! Run start.bat to launch the app. ===
echo.
pause
