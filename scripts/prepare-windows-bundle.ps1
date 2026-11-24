param(
  [string]$NodeVersion = "22.14.0",
  [string]$WinSwVersion = "2.12.0"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CacheDir = Join-Path $RootDir "build-cache"
$StageDir = Join-Path $RootDir "build-stage"
$OutputDir = Join-Path $RootDir "installer-output"

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# 1. Download portable Node.js (Windows x64) into cache
$NodeZipName = "node-v$NodeVersion-win-x64.zip"
$NodeFolderName = "node-v$NodeVersion-win-x64"
$NodeZipPath = Join-Path $CacheDir $NodeZipName
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName"

if (-not (Test-Path $NodeZipPath)) {
  Write-Host "[1/6] Telechargement de Node.js portable v$NodeVersion (Windows x64)..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath
} else {
  Write-Host "[1/6] Node.js portable v$NodeVersion deja en cache." -ForegroundColor Green
}

# 2. Download WinSW x64 into cache
$WinSwPath = Join-Path $CacheDir "PointageService.exe"
$WinSwUrl = "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe"

if (-not (Test-Path $WinSwPath)) {
  Write-Host "[2/6] Telechargement de WinSW v$WinSwVersion..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $WinSwUrl -OutFile $WinSwPath
} else {
  Write-Host "[2/6] WinSW deja en cache." -ForegroundColor Green
}

# 3. Build frontend + server.js
Write-Host "[3/6] Compilation de l'application (npm run build)..." -ForegroundColor Cyan
Push-Location $RootDir
try {
  if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "Echec de npm install" }
  }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Echec de npm run build" }
} finally {
  Pop-Location
}

# 4. Prepare clean staging directory
Write-Host "[4/6] Preparation du dossier d'assemblage (build-stage)..." -ForegroundColor Cyan
if (Test-Path $StageDir) {
  Remove-Item -Recurse -Force $StageDir
}
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Extract portable Node.js into build-stage\nodejs
$ExtractTmp = Join-Path $CacheDir "extract-tmp"
if (Test-Path $ExtractTmp) { Remove-Item -Recurse -Force $ExtractTmp }
Expand-Archive -Path $NodeZipPath -DestinationPath $ExtractTmp -Force
Move-Item -Path (Join-Path $ExtractTmp $NodeFolderName) -Destination (Join-Path $StageDir "nodejs")
Remove-Item -Recurse -Force $ExtractTmp

# Copy built artifacts and service files
Copy-Item -Path (Join-Path $RootDir "dist") -Destination (Join-Path $StageDir "dist") -Recurse
Copy-Item -Path (Join-Path $RootDir "server.js") -Destination (Join-Path $StageDir "server.js")
Copy-Item -Path (Join-Path $RootDir "package.json") -Destination (Join-Path $StageDir "package.json")
if (Test-Path (Join-Path $RootDir "package-lock.json")) {
  Copy-Item -Path (Join-Path $RootDir "package-lock.json") -Destination (Join-Path $StageDir "package-lock.json")
}
if (Test-Path (Join-Path $RootDir ".npmrc")) {
  Copy-Item -Path (Join-Path $RootDir ".npmrc") -Destination (Join-Path $StageDir ".npmrc")
}
Copy-Item -Path (Join-Path $RootDir "public\pointage.ico") -Destination (Join-Path $StageDir "pointage.ico")
Copy-Item -Path (Join-Path $RootDir "README.md") -Destination (Join-Path $StageDir "README.md")
Copy-Item -Path $WinSwPath -Destination (Join-Path $StageDir "PointageService.exe")
Copy-Item -Path (Join-Path $RootDir "service\PointageService.xml") -Destination (Join-Path $StageDir "PointageService.xml")
Copy-Item -Path (Join-Path $RootDir "service\install-service.bat") -Destination (Join-Path $StageDir "install-service.bat")
Copy-Item -Path (Join-Path $RootDir "service\uninstall-service.bat") -Destination (Join-Path $StageDir "uninstall-service.bat")

# 5. Install production-only node_modules using the bundled portable Node.js (guarantees native better-sqlite3 ABI match)
Write-Host "[5/6] Installation des dependances de production (better-sqlite3, express, exceljs...)..." -ForegroundColor Cyan
$PortableNodeDir = Join-Path $StageDir "nodejs"
$PortableNpmCmd = Join-Path $PortableNodeDir "npm.cmd"
$OrigPath = $env:Path
$env:Path = "$PortableNodeDir;$OrigPath"
Push-Location $StageDir
try {
  & $PortableNpmCmd install --omit=dev --legacy-peer-deps
  if ($LASTEXITCODE -ne 0) { throw "Echec de npm install --omit=dev dans build-stage" }
} finally {
  Pop-Location
  $env:Path = $OrigPath
}

# 6. Build Setup.exe if Inno Setup 6 is installed
Write-Host "[6/6] Compilation de Setup.exe avec Inno Setup..." -ForegroundColor Cyan
$IsccCandidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
  "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
)
$IsccCmd = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if ($IsccCmd) {
  $IsccPath = $IsccCmd.Source
} else {
  $IsccPath = $IsccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

$IssFile = Join-Path $RootDir "installer.iss"
if ($IsccPath) {
  & $IsccPath $IssFile
  if ($LASTEXITCODE -ne 0) { throw "Echec de la compilation Inno Setup." }
  Write-Host ""
  Write-Host "[TERMINE] Installateur genere avec succes :" -ForegroundColor Green
  Write-Host "  $(Join-Path $OutputDir 'Setup.exe')" -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "[ATTENTION] Le dossier build-stage est pret, mais Inno Setup 6 (ISCC.exe) n'a pas ete trouve." -ForegroundColor Yellow
  Write-Host "Installez Inno Setup 6 (https://jrsoftware.org/isdl.php) puis lancez :" -ForegroundColor Yellow
  Write-Host '  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss' -ForegroundColor White
}
