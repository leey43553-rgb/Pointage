; Script Inno Setup 6 pour Pointage Entreprise
; Prerequis : executez d'abord "prepare-installer.bat" (ou scripts\prepare-windows-bundle.ps1)
; puis compilez ce fichier avec Inno Setup 6 (ISCC.exe installer.iss)

#define MyAppName "Pointage"
#define MyAppDisplayName "Pointage Entreprise"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Pointage Entreprise"
#define MyAppURL "http://localhost:3000"

[Setup]
AppId={{8F4C2B7E-6A3D-4E91-9D52-41C8E7A20F11}
AppName={#MyAppDisplayName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Pointage
DefaultGroupName={#MyAppDisplayName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
OutputDir=installer-output
OutputBaseFilename=Setup
SetupIconFile=public\pointage.ico
UninstallDisplayIcon={app}\pointage.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Dirs]
; Dossier persistant de donnees (C:\ProgramData\Pointage) conserve lors des mises a jour
Name: "{commonappdata}\Pointage"; Permissions: users-modify
Name: "{commonappdata}\Pointage\photos"; Permissions: users-modify
Name: "{commonappdata}\Pointage\logs"; Permissions: users-modify

[Files]
; Contenu assemble dans build-stage (dist, server.js, nodejs portable, node_modules prod, PointageService.exe/.xml)
Source: "build-stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{commondesktop}\Pointage Admin"; Filename: "explorer.exe"; Parameters: "{#MyAppURL}"; IconFilename: "{app}\pointage.ico"; Comment: "Ouvrir l'interface d'administration Pointage"
Name: "{group}\Pointage Admin"; Filename: "explorer.exe"; Parameters: "{#MyAppURL}"; IconFilename: "{app}\pointage.ico"
Name: "{group}\Désinstaller {#MyAppDisplayName}"; Filename: "{uninstallexe}"

[Run]
; 1. Regle Pare-feu Windows (port TCP 3000)
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pointage (Port 3000)"""; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""Pointage (Port 3000)"" dir=in action=allow protocol=TCP localport=3000"; Flags: runhidden waituntilterminated

; 2. Installation, recuperation automatique et demarrage du service Windows "Pointage"
Filename: "{app}\PointageService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated
Filename: "{app}\PointageService.exe"; Parameters: "install"; StatusMsg: "Installation du service Windows Pointage..."; Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "failure ""Pointage"" reset= 3600 actions= restart/5000/restart/10000/restart/30000"; Flags: runhidden waituntilterminated
Filename: "{app}\PointageService.exe"; Parameters: "start"; StatusMsg: "Démarrage du service Pointage..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\PointageService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPointageService"
Filename: "{app}\PointageService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallPointageService"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Pointage (Port 3000)"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRule"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  // Lors d'une mise a jour, arreter proprement le service existant pour liberer node.exe et better_sqlite3.node
  Exec('net.exe', 'stop Pointage', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if FileExists(ExpandConstant('{app}\PointageService.exe')) then
  begin
    Exec(ExpandConstant('{app}\PointageService.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Sleep(1500);
end;
