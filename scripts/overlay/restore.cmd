@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update.ps1" -Restore
set "HAPI_OVERLAY_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %HAPI_OVERLAY_EXIT%
