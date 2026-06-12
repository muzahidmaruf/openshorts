@echo off
echo ============================================
echo    OpenShorts - Starting Servers...
echo ============================================
echo.

:: Start Backend in a new window
echo [1/2] Starting Backend Server (port 8000)...
start "OpenShorts Backend" cmd /k "cd /d %~dp0 && python -m uvicorn app:app --host 0.0.0.0 --port 8000"

:: Wait for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend in a new window
echo [2/2] Starting Frontend Server (port 5174)...
start "OpenShorts Frontend" cmd /k "cd /d %~dp0\dashboard && npm run dev"

echo.
echo ============================================
echo    Servers Starting...
echo ============================================
echo.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5174
echo.
echo Press Ctrl+C in each window to stop servers.
echo Close this window when done.
echo.

:: Keep this window open for 5 seconds then close
timeout /t 5 /nobreak >nul
exit
