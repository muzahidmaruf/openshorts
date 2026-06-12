@echo off
echo Stopping OpenShorts servers...
taskkill /F /FI "WindowTitle eq OpenShorts*" 2>nul
echo Done.
