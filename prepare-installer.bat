@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo   Preparation et compilation de Setup.exe
echo ==================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prepare-windows-bundle.ps1"
if %errorlevel% neq 0 (
  echo.
  echo [ERREUR] La preparation a echoue.
  pause
  exit /b 1
)

pause
