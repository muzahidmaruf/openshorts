@echo off
echo Installing OpenShorts Auto-Start...

:: Create a shortcut in the Startup folder
set SCRIPT_PATH=%~dp0start.bat
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

:: Create VBScript to run hidden (optional, for cleaner startup)
echo Set WshShell = CreateObject("WScript.Shell") > "%TEMP%\openshorts_run.vbs"
echo WshShell.Run chr(34) ^& "%SCRIPT_PATH%" ^& Chr(34), 1 >> "%TEMP%\openshorts_run.vbs"
echo Set WshShell = Nothing >> "%TEMP%\openshorts_run.vbs"

:: Copy to Startup folder
copy /Y "%TEMP%\openshorts_run.vbs" "%STARTUP_FOLDER%\OpenShorts.vbs"

echo.
echo ============================================
echo    Auto-Start Installed!
echo ============================================
echo.
echo OpenShorts will now start automatically when you log in.
echo.
echo To remove auto-start, delete:
echo   %STARTUP_FOLDER%\OpenShorts.vbs
echo.
pause
