# Pointage Entreprise — Installation sur Serveur Windows (Service + Installateur `Setup.exe`)

Application complète de pointage (employés et responsables) fonctionnant **100 % en local sur Windows**, en tant que **service Windows natif (`Pointage`)** sans aucune fenêtre de commande ni installation manuelle de Node.js sur le serveur.

Toutes les données persistantes sont stockées séparément du logiciel dans le dossier défini par `DATA_DIR` (par défaut **`C:\ProgramData\Pointage`**) :
- `pointage.db` : base SQLite des employés, responsables et pointages
- `photos/` : photos de présence (organisées par date et employé)
- `config.json` : configuration serveur (`port`, `host`, secret de session persistant)
- `logs/` : journaux du service Windows

Ainsi, **les mises à jour ne suppriment jamais vos données**.

---

## 1. Générer `Setup.exe` sur votre PC de développement

### Prérequis sur votre PC (une seule fois)
1. **Node.js LTS (v22 ou plus)** : https://nodejs.org
2. **Inno Setup 6** : https://jrsoftware.org/isdl.php (cochez *Preprocess / Command Line Compiler* lors de l'installation)

### Commandes à exécuter pour produire `Setup.exe`

Ouvrez PowerShell ou l'Invite de commandes (`cmd`) dans le dossier du projet et exécutez :

```bat
npm install
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-windows-bundle.ps1
```

*(Ou double-cliquez simplement sur **`prepare-installer.bat`**, qui enchaîne automatiquement toutes les étapes.)*

Si Inno Setup est installé dans un dossier personnalisé, lancez ensuite :
```bat
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Ce processus :
1. Compile l'interface React (`dist/`) et le serveur de production (`server.js`).
2. Télécharge et met en cache **Node.js portable (Windows x64)** et **WinSW (Windows Service Wrapper)** dans `build-cache/`.
3. Assemble le dossier `build-stage/` avec uniquement les dépendances de production compilées pour ce Node.js portable.
4. Génère l'installateur prêt à copier sur le serveur : **`installer-output\Setup.exe`**.

---

## 2. Installer sur le serveur Windows (sans Node.js ni console)

1. Copiez **`Setup.exe`** sur le serveur Windows.
2. Double-cliquez sur **`Setup.exe`** et acceptez l'élévation Administrateur (UAC).
3. L'installateur effectue automatiquement toutes les opérations suivantes :
   - Installe l'application et le runtime Node.js portable dans **`C:\Program Files\Pointage`**.
   - Crée le dossier de données **`C:\ProgramData\Pointage`** (`photos/` et `logs/`).
   - Ouvre le **port TCP 3000** dans le Pare-feu Windows (`Pointage (Port 3000)`).
   - Installe et démarre le service Windows nommé **`Pointage`** (démarrage automatique avec Windows et redémarrage automatique en cas d'incident).
   - Crée le raccourci **`Pointage Admin`** sur le Bureau qui ouvre `http://localhost:3000`.
4. Double-cliquez sur **`Pointage Admin`** sur le Bureau : aucune fenêtre noire ne s'ouvre.

### Première connexion (Super Administrateur)
- Cliquez sur **« Espace Responsable »** en haut à droite :
  - **Nom d'utilisateur** : `admin`
  - **Mot de passe** : `Admin1234`
- Rendez-vous immédiatement dans **Paramètres** pour changer ce mot de passe, configurer votre entreprise, les jours travaillés, les jours fériés et l'option photo.

### Accès depuis les téléphones (Wi-Fi de l'entreprise)
Sur les téléphones Android ou iPhone connectés au même réseau Wi-Fi, ouvrez :
```text
http://IP-DU-SERVEUR:3000
```
L'application s'installe sur l'écran d'accueil en tant que **PWA** (*Ajouter à l'écran d'accueil*).

---

## 3. Mettre à jour l'application sans perdre les données

Lorsqu'une nouvelle version est prête (`Setup.exe` recompilé) :
1. Copiez le nouveau **`Setup.exe`** sur le serveur et lancez-le directement (**ne désinstallez pas manuellement**, ou même si vous désinstallez, `C:\ProgramData\Pointage` est conservé).
2. `Setup.exe` arrête automatiquement le service `Pointage`, remplace uniquement les fichiers de programme dans `C:\Program Files\Pointage`, puis redémarre le service.
3. Vos fichiers `pointage.db`, `photos/` et `config.json` dans `C:\ProgramData\Pointage` restent **100 % intacts**.

### Changer l'emplacement des données (`DATA_DIR`)
Si vous souhaitez stocker les données sur un autre disque (ex. `D:\DonneesPointage`) :
1. Définissez la variable d'environnement système Windows `DATA_DIR=D:\DonneesPointage`.
2. Arrêtez le service `Pointage`, copiez le contenu de `C:\ProgramData\Pointage` vers `D:\DonneesPointage`, puis redémarrez le service `Pointage` depuis `services.msc`.

---

## 4. Gestion manuelle du service Windows (optionnel)

Les scripts suivants (dans `service/` ou `C:\Program Files\Pointage\`) permettent de gérer le service manuellement en tant qu'administrateur :
- **`install-service.bat`** : installe et démarre le service `Pointage` (démarrage auto + relance sur échec + règle Pare-feu).
- **`uninstall-service.bat`** : arrête et supprime le service `Pointage` sans toucher aux données.
- **Lancement ponctuel en console** : `npm run build` puis `node server.js` (écoute sur `0.0.0.0:3000`).

---

## 5. Dépendances principales

- `exceljs` : export mensuel Excel `.xlsx` multi-onglets (Résumé du mois + une fiche par employé).
- `multer` et `@types/multer` : réception sécurisée des photos de présence.
- `jimp` : génération de miniatures 200px côté serveur pour le calendrier photos.
- `better-sqlite3`, `bcryptjs`, `vite-plugin-pwa` : SQLite local, hachage des mots de passe et PWA.
- **WinSW v2.12** et **Inno Setup 6** : exécution en service Windows et création de `Setup.exe`.
