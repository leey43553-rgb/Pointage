@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ======================================================
echo   Construction de l'installateur Pointage-Setup.exe
echo ======================================================
echo.

echo [1/3] Installation des dependances (legacy-peer-deps)...
call npm install --legacy-peer-deps
if errorlevel 1 (
  echo ERREUR: npm install a echoue.
  pause
  exit /b 1
)

echo.
echo [2/3] Compilation du frontend et du serveur...
call npm run build
if errorlevel 1 (
  echo ERREUR: npm run build a echoue.
  pause
  exit /b 1
)

echo.
echo [3/3] Generation de release\Pointage-Setup.exe...
call npx electron-builder --win --x64
if errorlevel 1 (
  echo ERREUR: electron-builder a echoue.
  pause
  exit /b 1
)

echo.
echo ======================================================
echo   TERMINE ! Installateur genere :
echo   release\Pointage-Setup.exe
echo ======================================================
pause
