@echo off
chcp 65001 >nul
title Pointage Entreprise - Serveur Local
cd /d "%~dp0"

echo ==================================================
echo   Demarrage de Pointage Entreprise...
echo ==================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERREUR] Node.js n'est pas installe sur ce PC.
  echo Telechargez et installez Node.js LTS depuis : https://nodejs.org
  echo.
  pause
  exit /b 1
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

echo Compilation et lancement du serveur en mode production...
echo Ne fermez pas cette fenetre tant que les employes pointent.
echo.
call npm start

if %errorlevel% neq 0 (
  echo.
  echo [ERREUR] Le serveur s'est arrete avec une erreur.
  pause
)
