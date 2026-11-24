# Pointage — Application Bureau Windows (`Pointage-Setup.exe`)

Application locale de pointage des présences (employés et responsables) empaquetée avec **Electron** et **electron-builder**.  
Le serveur local Express + SQLite démarre directement dans l'application sur le port **`3000`** (`0.0.0.0:3000`), avec icône dans la zone de notification Windows (*system tray*), démarrage automatique avec Windows, capture photo, calendrier photos, export Excel `.xlsx` et page QR code imprimable pour les téléphones.

Toutes les données sont enregistrées en dehors du dossier du programme (dans **`C:\ProgramData\Pointage`**, ou dans le dossier `userData` de l'utilisateur si `ProgramData` n'est pas accessible en écriture) :
- `pointage.db` : base SQLite des employés, responsables et pointages
- `photos/` : photos de présence et miniatures
- `config.json` : configuration locale (port, secret de session, préférences de démarrage Windows)

Ainsi, **les mises à jour et réinstallations ne suppriment jamais vos données**.

---

## 1. Compiler `Pointage-Setup.exe` sur votre PC

### Prérequis (une seule fois)
1. **Node.js LTS (v20 ou v22)** : https://nodejs.org  
*(Aucun outil C++, Visual Studio Build Tools ni Python n'est requis : la base SQLite utilise `node:sqlite` / `sql.js` WebAssembly et le traitement photo est 100 % JavaScript.)*

### Méthode rapide (1 double-clic)
Double-cliquez simplement sur **`build-electron.bat`** à la racine du projet.  
Ce script exécute automatiquement :
1. `npm install --legacy-peer-deps`
2. `npm run build`
3. `npx electron-builder --win --x64`

### Méthode en ligne de commande
```bat
npm install --legacy-peer-deps
npm run electron:build
```

L'installateur final est généré dans :
```text
release\Pointage-Setup.exe
```

Pour lancer l'application Electron localement en test sans créer l'installateur :
```bat
npm run electron:dev
```

---

## 2. Installer sur le serveur Windows

1. Copiez **`release\Pointage-Setup.exe`** sur le PC serveur Windows.
2. Double-cliquez sur **`Pointage-Setup.exe`** et acceptez l'élévation Administrateur (UAC).
3. Choisissez le dossier d'installation (par défaut dans `C:\Program Files\Pointage`), puis terminez l'assistant :
   - Crée le raccourci **Pointage** sur le Bureau et dans le Menu Démarrer.
   - Crée `C:\ProgramData\Pointage` avec les droits d'écriture.
   - Ajoute automatiquement la règle du Pare-feu Windows **« Pointage (Port 3000) »** en entrée TCP pour que les téléphones en Wi-Fi puissent se connecter.
4. Lancez **Pointage** :
   - La fenêtre **Pointage** s'ouvre sans barre de menu sur `http://localhost:3000`.
   - Fermer la fenêtre avec la croix **`X`** réduit l'application dans la **zone de notification Windows** (près de l'horloge) sans arrêter le serveur.
   - Un clic droit sur l'icône près de l'horloge affiche : **Ouvrir Pointage**, **Adresse pour les téléphones: http://\<IP\>:3000** (clic pour copier) et **Quitter**.
   - Une seule instance peut tourner à la fois : relancer **Pointage** met au premier plan la fenêtre déjà ouverte.

### Première connexion et QR Code pour l'entrée
- Cliquez sur **« Espace Responsable »** :
  - **Nom d'utilisateur** : `admin`
  - **Mot de passe** : `Admin1234`
- Allez dans **Paramètres** pour changer le mot de passe et configurer l'entreprise.
- Ouvrez l'onglet **« Connexion des téléphones »** pour afficher l'IP locale, le lien `http://IP:3000` et **imprimer l'affiche avec QR code** à coller à l'entrée.

---

## 3. Configurer le démarrage et l'ouverture de session automatique Windows

### Démarrage automatique intégré à Pointage
Au **premier lancement**, Pointage active automatiquement son lancement au démarrage de Windows et démarre réduit dans la zone de notification (`--minimized`).  
Vous pouvez activer ou désactiver cette option à tout moment dans **Paramètres → Application Windows et démarrage automatique**.

### Ouverture de session automatique Windows (recommandé sur un serveur)
Pour que le PC serveur ouvre automatiquement Windows après une coupure de courant ou un redémarrage (et lance ainsi Pointage sans taper de mot de passe) :
1. Appuyez sur **`Win + R`**, tapez **`netplwiz`** et validez.
2. Sélectionnez le compte utilisateur Windows du serveur.
3. Décochez **« Les utilisateurs doivent entrer un nom d'utilisateur et un mot de passe pour utiliser cet ordinateur »**, puis cliquez sur **Appliquer**.
4. Saisissez deux fois le mot de passe Windows de ce compte et validez par **OK**.

*(Si l'option n'apparaît pas sur Windows 11, ouvrez **Paramètres Windows → Comptes → Options de connexion** et désactivez temporairement **« Exiger la connexion Windows Hello pour les comptes Microsoft »**).*

---

## 4. Mettre à jour l'application sans perdre les données

1. Sur le PC serveur, faites un clic droit sur l'icône **Pointage** près de l'horloge et cliquez sur **Quitter** (si l'application est en cours d'exécution).
2. Exécutez le nouveau **`Pointage-Setup.exe`** dans le même dossier d'installation.
3. Relancez **Pointage** : vos employés, pointages (`pointage.db`), photos (`photos/`) et réglages (`config.json`) dans `C:\ProgramData\Pointage` sont **100 % conservés**.

> **Astuce sauvegarde** : dans **Paramètres → Dossier des données et sauvegarde**, vous disposez d'un bouton **« Ouvrir le dossier des données »** et d'un bouton **« Télécharger une sauvegarde (pointage.db) »**.
