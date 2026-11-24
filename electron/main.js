import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  nativeImage,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.POINTAGE_ELECTRON = '1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

let mainWindow = null;
let tray = null;
let startedServer = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

function resolveElectronDataDir() {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(process.env.DATA_DIR.trim());
  }
  if (process.platform === 'win32') {
    const sharedProgramData = 'C:\\ProgramData\\Pointage';
    try {
      fs.mkdirSync(sharedProgramData, { recursive: true });
      fs.accessSync(sharedProgramData, fs.constants.W_OK);
      return sharedProgramData;
    } catch {
      return app.getPath('userData');
    }
  }
  return app.getPath('userData');
}

function resolveAssetPath(relPath) {
  const raw = path.join(APP_ROOT, relPath);
  const unpacked = raw.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  if (fs.existsSync(raw)) return raw;
  return null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function applyWindowsStartup(openAtLogin) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
      path: process.execPath,
      args: ['--minimized'],
    });
  } catch (err) {
    console.warn('Impossible de modifier le démarrage automatique :', err);
  }
}

function createTray(phoneUrl) {
  const iconFile =
    (process.platform === 'win32'
      ? resolveAssetPath('build/icon.ico')
      : resolveAssetPath('build/tray-icon.png')) ||
    resolveAssetPath('build/tray-icon.png') ||
    resolveAssetPath('build/icon.png') ||
    resolveAssetPath('public/pwa-192x192.png');

  let trayImage = iconFile ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty();
  if (process.platform !== 'win32' && !trayImage.isEmpty()) {
    trayImage = trayImage.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayImage);
  tray.setToolTip(`Pointage — ${phoneUrl}`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir Pointage',
      click: () => showMainWindow(),
    },
    {
      label: `Adresse pour les téléphones: ${phoneUrl}`,
      click: () => {
        clipboard.writeText(phoneUrl);
        if (process.platform === 'win32' && tray) {
          tray.displayBalloon({
            title: 'Pointage',
            content: `Adresse copiée : ${phoneUrl}`,
          });
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function createMainWindow(localUrl, startHidden) {
  const winIconPath =
    resolveAssetPath('build/icon.ico') ||
    resolveAssetPath('build/icon.png') ||
    resolveAssetPath('public/pwa-512x512.png');

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Pointage',
    show: !startHidden,
    autoHideMenuBar: true,
    icon: winIconPath || undefined,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle('Pointage');
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  void mainWindow.loadURL(localUrl);
}

app.on('second-instance', () => {
  showMainWindow();
});

app.on('window-all-closed', (event) => {
  // Keep running in system tray on Windows/macOS/Linux until "Quitter" is chosen
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (startedServer) {
    const srv = startedServer;
    startedServer = null;
    void srv.closeServer();
  }
});

app.whenReady().then(async () => {
  const dataDir = resolveElectronDataDir();
  process.env.DATA_DIR = dataDir;

  const serverBundlePath = path.join(APP_ROOT, 'server.js');
  if (!fs.existsSync(serverBundlePath)) {
    dialog.showErrorBox(
      'Fichier serveur manquant',
      'Le fichier server.js est introuvable. Exécutez "npm run build" avant de lancer Electron.'
    );
    app.exit(1);
    return;
  }

  let serverModule;
  try {
    serverModule = await import(pathToFileURL(serverBundlePath).href);
  } catch (err) {
    dialog.showErrorBox(
      'Erreur de chargement',
      `Impossible de charger le module serveur :\n${err?.message || String(err)}`
    );
    app.exit(1);
    return;
  }

  const { startServer, APP_CONFIG, updateAppFileConfig } = serverModule;

  // On first launch, enable Windows startup and configure start-minimized-at-login
  if (!APP_CONFIG.startupConfigured) {
    applyWindowsStartup(true);
    updateAppFileConfig({
      openAtLogin: true,
      startMinimized: true,
      startupConfigured: true,
    });
  } else {
    applyWindowsStartup(APP_CONFIG.openAtLogin);
  }

  const desktopHooks = {
    isElectron: true,
    getDesktopSettings: () => ({
      openAtLogin: Boolean(APP_CONFIG.openAtLogin),
      startMinimized: Boolean(APP_CONFIG.startMinimized),
    }),
    setDesktopSettings: ({ openAtLogin, startMinimized }) => {
      const updated = updateAppFileConfig({
        ...(typeof openAtLogin === 'boolean' ? { openAtLogin } : {}),
        ...(typeof startMinimized === 'boolean' ? { startMinimized } : {}),
        startupConfigured: true,
      });
      if (typeof openAtLogin === 'boolean') {
        applyWindowsStartup(updated.openAtLogin);
      }
      return {
        openAtLogin: updated.openAtLogin,
        startMinimized: updated.startMinimized,
      };
    },
    openDataFolder: async () => {
      const errMsg = await shell.openPath(dataDir);
      return errMsg === '';
    },
  };

  try {
    startedServer = await startServer({ prodMode: true, desktopHooks });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      dialog.showErrorBox(
        'Port 3000 déjà utilisé',
        "Impossible de démarrer Pointage car le port 3000 est déjà occupé par une autre application (ou une instance précédente du serveur).\n\nFermez l'autre application utilisant le port 3000, puis relancez Pointage."
      );
    } else {
      dialog.showErrorBox(
        'Erreur de démarrage du serveur',
        `Une erreur est survenue lors du démarrage du serveur local :\n\n${err?.message || String(err)}`
      );
    }
    isQuitting = true;
    app.exit(1);
    return;
  }

  const localUrl = `http://localhost:${startedServer.port}`;
  const phoneUrl = `http://${startedServer.primaryLanIp}:${startedServer.port}`;

  let openedAtLogin = false;
  try {
    openedAtLogin = Boolean(
      app.getLoginItemSettings({
        path: process.execPath,
        args: ['--minimized'],
      }).wasOpenedAtLogin
    );
  } catch {
    openedAtLogin = false;
  }

  const startMinimized =
    process.argv.includes('--minimized') ||
    (openedAtLogin && APP_CONFIG.startMinimized);

  createTray(phoneUrl);
  createMainWindow(localUrl, startMinimized);

  if (startMinimized && process.platform === 'win32' && tray) {
    tray.displayBalloon({
      title: 'Pointage démarré',
      content: `Serveur actif sur ${phoneUrl} (cliquez sur l'icône pour ouvrir).`,
    });
  }
});
