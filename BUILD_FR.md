# Guide de compilation Windows & Version Portable (Pointage)

Application 100 % hors ligne (aucun serveur distant, aucune base native à compiler, stockage local IndexedDB).

## 1. Prérequis sur le PC de compilation
- **Node.js LTS** (18, 20 ou 22) installé sur Windows.
- Aucun compilateur C++ (Visual Studio) ni Python requis.

## 2. Installation des dépendances
Ouvrez un terminal dans le dossier du projet et exécutez :

```bash
npm install --legacy-peer-deps
npm install react-is --legacy-peer-deps
```

## 3. Tester en mode développement Electron
```bash
npm run electron:dev
```

## 4. Générer l'installeur Windows et la version portable
```bash
npm run dist
```

Les fichiers générés apparaissent dans le dossier **`release/`** :
- **Installeur Windows (NSIS)** : `release/Pointage-1.0.0-x64.exe` (assistant en français, choix du dossier d'installation, raccourci Bureau, données conservées lors d'une désinstallation/mise à jour dans `%APPDATA%\Pointage`).
- **Version Portable (sans installation)** : `release/Pointage-1.0.0-portable-x64.exe`.

*(Pour compiler sous macOS en `.dmg` arm64/x64, exécutez `npx vite build && npx electron-builder --mac` sur un Mac.)*

## 5. Utiliser la version portable sur une clé USB
1. Copiez **`Pointage-1.0.0-portable-x64.exe`** sur votre clé USB (par exemple dans `E:\Pointage\`).
2. Lancez l'exécutable directement depuis la clé USB sur n'importe quel PC Windows.
3. Lors du premier lancement, un dossier **`Data`** est créé automatiquement à côté de l'exécutable (par exemple `E:\Pointage\Data\`).
4. Toutes les données (employés, pointages, photos, paramètres) sont enregistrées dans ce dossier `Data` : vous pouvez déplacer ou sauvegarder la clé USB sans rien perdre.

## 6. Premiers identifiants administrateur
- **Utilisateur** : `admin`
- **Mot de passe initial** : `Admin1234` (à modifier dès la première connexion dans **Paramètres**).
