@echo off
REM V3-AIP-71: double-clickable entry point for contributors without a
REM PowerShell habit. All logic lives in dev-up.ps1 - this just invokes it.
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dev-up.ps1"
exit /b %ERRORLEVEL%
