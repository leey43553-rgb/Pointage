# Pointage Entreprise — Application locale de gestion des présences

Application complète de pointage (employés et responsables) fonctionnant **100 % en local sur un PC Windows**, sans aucun service cloud ni abonnement. Toutes les données sont enregistrées dans un fichier local nommé **`pointage.db`** créé automatiquement à côté de l'application, et les photos de présence sont enregistrées localement dans le dossier **`photos/`**.

---

## 1. Installation et lancement rapide sur Windows

### Étape 1 : Installer Node.js
1. Rendez-vous sur le site officiel : **https://nodejs.org**
2. Téléchargez et installez la version **LTS** (v22 ou plus récent) pour Windows en cliquant sur « Suivant » jusqu'à la fin.
3. Redémarrez le PC si demandé.

### Étape 2 : Démarrer en un double-clic (`start.bat`)
1. Ouvrez le dossier de l'application.
2. Double-cliquez simplement sur le fichier **`start.bat`**.
3. Lors du tout premier lancement, `start.bat` installe automatiquement les dépendances (`npm install` avec la configuration `.npmrc` déjà incluse), compile l'interface, crée la base `pointage.db` et le dossier `photos/` à côté de l'application, et démarre le serveur en **mode production** sur `0.0.0.0:3000`.

> **Important** : laissez la fenêtre noire ouverte tant que les employés utilisent le pointage. Pour arrêter le serveur, fermez simplement cette fenêtre (ou appuyez sur `Ctrl + C`).

### Méthode manuelle (en ligne de commande)
Si vous préférez utiliser l'Invite de commandes (`cmd`) ou PowerShell dans le dossier du projet :

```bash
npm install
npm start
```

*(En cas d'erreur de dépendances sur une ancienne version de npm, exécutez `npm install --legacy-peer-deps`.)*

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
   - Régler l'heure officielle d'arrivée, la tolérance de retard, les **jours travaillés de la semaine** (par défaut : dimanche à jeudi) et les **jours fériés / congés** à exclure des absences.
   - Choisir l'option **Photo obligatoire** (`Désactivée`, `À l'arrivée seulement`, ou `Arrivée et départ`) et la durée de conservation automatique des photos (par défaut **90 jours**).
   - *(Optionnel)* Renseigner le préfixe **Réseau autorisé** (ex. `192.168.1.`) pour empêcher le pointage depuis l'extérieur du Wi-Fi de l'entreprise.

---

## 4. Preuve par photo (compatible HTTP local)

- Lorsqu'une photo est demandée, l'employé appuie sur **« Je suis arrivé »** (ou **« Je pars »**), puis sur **« Prendre une photo »** : la caméra frontale du téléphone s'ouvre directement, sans nécessiter HTTPS.
- L'image est automatiquement compressée dans le navigateur (largeur max 800 px, JPEG sous 150 Ko) puis affichée avec deux grands boutons : **« Envoyer »** (vert) et **« Reprendre »** (gris). Le pointage n'est enregistré qu'après validation.
- Les photos sont enregistrées dans le dossier **`photos/AAAA-MM-JJ/emp-ID/`** sur le PC et ne sont accessibles que par les administrateurs connectés (aucune URL publique).
- Un nettoyage automatique supprime les photos plus anciennes que le nombre de jours configuré dans **Paramètres**.

---

## 5. Rapport Excel (`.xlsx`) et rôles

- **Employé** : saisit uniquement son **code personnel à 6 chiffres** sur le grand clavier tactile, puis pointe son arrivée et son départ. Déconnexion automatique après 30 secondes d'inactivité.
- **Admin** : consulte les présences du jour (avec miniatures des photos cliquables), l'historique, et génère le rapport **Excel (`.xlsx`)** dans **Bilan mensuel** :
  - **1er onglet « Résumé »** (lorsque « Tous les employés » est sélectionné) : synthèse mensuelle complète par employé.
  - **1 onglet par employé** : détail jour par jour du mois (Présent / En retard / Absent / Week-end / Jour férié / Congé / Départ non pointé), présence des photos (`Oui` / `Non`) et totaux mensuels, mis en page en A4 paysage prêt à imprimer (`Rapport-pointage-AAAA-MM.xlsx`).
- **Super Admin (Patron)** : accès complet (gestion des employés et des admins, impression des codes, paramètres, et sauvegarde de `pointage.db`).

---

## 6. Base de données et sauvegarde (`pointage.db`)

Le fichier **`pointage.db`** et le dossier **`photos/`** sont stockés directement dans le dossier de l'application, à côté de `start.bat` et `server.ts`.  
Dans l'onglet **Paramètres**, le bouton **« Sauvegarder (pointage.db) »** permet de télécharger à tout moment une copie complète de la base de données.

---

## 7. Dépendances principales ajoutées

- `exceljs` : génération des rapports Excel `.xlsx` multi-onglets et mise en forme.
- `multer` et `@types/multer` : réception sécurisée des photos envoyées lors du pointage.
- `better-sqlite3`, `bcryptjs`, `vite-plugin-pwa` : base SQLite locale, hachage sécurisé des mots de passe et support PWA.
