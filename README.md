# Pointage Entreprise — Application locale de gestion des présences

Application complète de pointage (employés et responsables) fonctionnant **100 % en local sur un PC Windows**, sans aucun service cloud ni abonnement. Toutes les données sont enregistrées dans un fichier local nommé **`pointage.db`** créé automatiquement à côté de l'application.

---

## 1. Installation et lancement rapide sur Windows

### Étape 1 : Installer Node.js
1. Rendez-vous sur le site officiel : **https://nodejs.org**
2. Téléchargez et installez la version **LTS** (v22 ou plus récent) pour Windows en cliquant sur « Suivant » jusqu'à la fin.
3. Redémarrez le PC si demandé.

### Étape 2 : Démarrer en un double-clic (`start.bat`)
1. Ouvrez le dossier de l'application.
2. Double-cliquez simplement sur le fichier **`start.bat`**.
3. Lors du tout premier lancement, `start.bat` installe automatiquement les dépendances (`npm install`) si nécessaire, compile l'interface, crée la base `pointage.db` à côté de l'application et démarre le serveur en **mode production** sur `0.0.0.0:3000`.

> **Important** : laissez la fenêtre noire ouverte tant que les employés utilisent le pointage. Pour arrêter le serveur, fermez simplement cette fenêtre (ou appuyez sur `Ctrl + C`).

### Méthode manuelle (en ligne de commande)
Si vous préférez utiliser l'Invite de commandes (`cmd`) ou PowerShell dans le dossier du projet :

```bash
npm install
npm start
```

`npm start` compile automatiquement l'application frontend (`dist/`) puis lance le serveur en mode production sur `http://0.0.0.0:3000`.

---

## 2. Ouvrir l'application depuis les téléphones (Wi-Fi)

Au démarrage, le serveur affiche directement dans la fenêtre les adresses exactes à saisir sur les téléphones, par exemple :
- Sur ce PC : `http://localhost:3000`
- Sur les téléphones (Wi-Fi) : `http://192.168.1.25:3000`

1. Vérifiez que le PC Windows et les téléphones sont connectés au **même réseau Wi-Fi** de l'entreprise.
2. Sur le téléphone d'un employé (Android ou iPhone), ouvrez le navigateur (Chrome ou Safari) et tapez l'adresse affichée dans la console :
   ```text
   http://IP-DU-PC:3000
   ```
   *(Si besoin, vous pouvez retrouver l'IP du PC en tapant `ipconfig` dans `cmd`, ligne **Adresse IPv4**.)*

### Installer l'application sur l'écran d'accueil du téléphone (PWA)
- **Sur Android (Chrome)** : appuyez sur **« Installer sur le téléphone »** en bas de l'écran (ou menu `⋮` → *Ajouter à l'écran d'accueil*).
- **Sur iPhone / iPad (Safari)** : appuyez sur **Partager** puis sur **« Sur l'écran d'accueil »**.

### Autoriser le port 3000 dans le Pare-feu Windows (si les téléphones ne chargent pas la page)
La première fois, Windows affiche une alerte Pare-feu pour Node.js : cochez **Réseaux privés** et cliquez sur **Autoriser l'accès**.  
Si la connexion depuis les téléphones reste bloquée, créez une règle entrante TCP sur le port **3000** dans le Pare-feu Windows Defender.

---

## 3. Première connexion (Super Administrateur)

1. Sur l'écran d'accueil, cliquez en haut à droite sur **« Espace Responsable »**.
2. Connectez-vous avec le compte créé automatiquement au premier lancement :
   - **Nom d'utilisateur** : `admin`
   - **Mot de passe** : `Admin1234`
3. Rendez-vous immédiatement dans l'onglet **Paramètres** pour :
   - Modifier ce mot de passe par défaut.
   - Renseigner le nom de votre entreprise (et votre logo optionnel).
   - Régler l'heure officielle d'arrivée et la tolérance de retard (en minutes).
   - *(Optionnel)* Renseigner le préfixe **Réseau autorisé** (ex. `192.168.1.`) pour empêcher le pointage depuis l'extérieur du Wi-Fi de l'entreprise.

---

## 4. Fonctionnement des rôles

- **Employé** : saisit uniquement son **code personnel à 6 chiffres** sur le grand clavier tactile, puis appuie sur **« Je suis arrivé »** (vert) ou **« Je pars »** (rouge). Déconnexion automatique après 30 secondes d'inactivité.
- **Admin** : consulte les présences du jour, le bilan mensuel, l'historique et exporte les tableaux en **CSV (Excel)**.
- **Super Admin (Patron)** : accès complet (ajout/modification/suppression d'employés et d'admins, régénération et impression des codes, paramètres, changement de mot de passe, et **sauvegarde** de `pointage.db`).

---

## 5. Base de données et sauvegarde (`pointage.db`)

Le fichier **`pointage.db`** est créé et stocké directement dans le dossier de l'application, à côté de `start.bat` et `server.ts`.  
Dans l'onglet **Paramètres**, le bouton **« Sauvegarder (pointage.db) »** permet de télécharger à tout moment une copie complète de la base de données.
