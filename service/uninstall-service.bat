@echo off
chcp 65001 >nul
setlocal EnableExtensions

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERREUR] Ce script doit etre execute en tant qu'administrateur.
  echo Faites un clic droit ^> "Executer en tant qu'administrateur".
  pause
  exit /b 1
)

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%server.js" (
  for %%I in ("%SCRIPT_DIR%.") do set "APP_DIR=%%~fI"
) else (
  for %%I in ("%SCRIPT_DIR%..") do set "APP_DIR=%%~fI"
)

set "SVC_EXE=%APP_DIR%\PointageService.exe"

echo Arret du service "Pointage"...
if exist "%SVC_EXE%" "%SVC_EXE%" stop >nul 2>&1
net stop Pointage >nul 2>&1

echo Desinstallation du service "Pointage"...
if exist "%SVC_EXE%" "%SVC_EXE%" uninstall >nul 2>&1
sc.exe delete "Pointage" >nul 2>&1

echo Suppression de la regle Pare-feu (Port 3000)...
netsh advfirewall firewall delete rule name="Pointage (Port 3000)" >nul 2>&1

echo.
echo [OK] Service "Pointage" desinstalle.
echo Note : vos donnees ^(pointage.db, photos, config.json^) dans C:\ProgramData\Pointage ont ete conservees.
pause
