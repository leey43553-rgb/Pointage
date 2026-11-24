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

if "%DATA_DIR%"=="" set "DATA_DIR=C:\ProgramData\Pointage"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\photos" mkdir "%DATA_DIR%\photos"
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

if not exist "%APP_DIR%\server.js" (
  echo [ERREUR] Le fichier server.js est introuvable dans "%APP_DIR%".
  echo Executez d'abord "npm run build".
  pause
  exit /b 1
)

set "SVC_EXE=%APP_DIR%\PointageService.exe"
set "SVC_XML=%APP_DIR%\PointageService.xml"

if not exist "%SVC_EXE%" (
  echo Telechargement de WinSW ^(Windows Service Wrapper^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile '%SVC_EXE%'"
  if %errorlevel% neq 0 (
    echo [ERREUR] Impossible de telecharger WinSW-x64.exe.
    echo Placez WinSW-x64.exe renomme en PointageService.exe dans "%APP_DIR%".
    pause
    exit /b 1
  )
)

if exist "%APP_DIR%\nodejs\node.exe" (
  if /I not "%SCRIPT_DIR%"=="%APP_DIR%\" (
    copy /Y "%SCRIPT_DIR%PointageService.xml" "%SVC_XML%" >nul
  )
) else (
  set "SYS_NODE="
  for /f "delims=" %%N in ('where node 2^>nul') do (
    if not defined SYS_NODE set "SYS_NODE=%%N"
  )
  if not defined SYS_NODE (
    echo [ERREUR] Aucun executable node.exe trouve ^(ni dans nodejs\, ni dans PATH^).
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$xml = Get-Content -LiteralPath '%SCRIPT_DIR%PointageService.xml' -Raw; $xml = $xml.Replace('%%BASE%%\nodejs\node.exe', '%SYS_NODE%'); Set-Content -LiteralPath '%SVC_XML%' -Value $xml -Encoding UTF8"
)

echo Arret d'un eventuel service Pointage existant...
"%SVC_EXE%" stop >nul 2>&1
net stop Pointage >nul 2>&1
"%SVC_EXE%" uninstall >nul 2>&1

echo Installation du service Windows "Pointage"...
"%SVC_EXE%" install
if %errorlevel% neq 0 (
  echo [ERREUR] Echec de l'installation du service Pointage.
  pause
  exit /b 1
)

echo Configuration du redemarrage automatique en cas d'erreur...
sc.exe failure "Pointage" reset= 3600 actions= restart/5000/restart/10000/restart/30000 >nul

echo Ouverture du port TCP 3000 dans le Pare-feu Windows...
netsh advfirewall firewall delete rule name="Pointage (Port 3000)" >nul 2>&1
netsh advfirewall firewall add rule name="Pointage (Port 3000)" dir=in action=allow protocol=TCP localport=3000 >nul

echo Demarrage du service "Pointage"...
"%SVC_EXE%" start
if %errorlevel% neq 0 (
  echo [ERREUR] Le service a ete installe mais n'a pas pu demarrer. Consultez "%DATA_DIR%\logs".
  pause
  exit /b 1
)

echo.
echo [OK] Service "Pointage" installe et demarre avec succes !
echo Accès local : http://localhost:3000
echo Dossier donnees : %DATA_DIR%
pause
