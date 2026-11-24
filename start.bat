@echo off
chcp 65001 >nul
title Pointage Entreprise - Serveur Local
cd /d "%~dp0"

echo ==================================================
echo   Demarrage de Pointage Entreprise...
echo ==================================================
echo.

set "NODE_BIN=node"
if exist "%~dp0nodejs\node.exe" (
  set "NODE_BIN=%~dp0nodejs\node.exe"
  set "PATH=%~dp0nodejs;%PATH%"
) else (
  where node >nul 2>&1
  if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe sur ce PC.
    echo Telechargez et installez Node.js LTS depuis : https://nodejs.org
    echo.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installation des dependances ^(premiere execution^)...
  call npm install
  if %errorlevel% neq 0 (
    echo.
    echo [ERREUR] Echec de l'installation des dependances.
    pause
    exit /b 1
  )
)

if not exist "server.js" (
  echo Compilation de l'application...
  call npm run build
  if %errorlevel% neq 0 (
    echo.
    echo [ERREUR] Echec de la compilation.
    pause
    exit /b 1
  )
) else if not exist "dist\index.html" (
  echo Compilation de l'interface...
  call npm run build
  if %errorlevel% neq 0 (
    echo.
    echo [ERREUR] Echec de la compilation.
    pause
    exit /b 1
  )
)

echo Lancement du serveur en mode production ^(0.0.0.0:3000^)...
echo Ne fermez pas cette fenetre tant que les employes pointent.
echo.
"%NODE_BIN%" server.js

if %errorlevel% neq 0 (
  echo.
  echo [ERREUR] Le serveur s'est arrete avec une erreur.
  pause
)
