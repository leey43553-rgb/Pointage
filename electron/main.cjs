const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Portable mode: store all userData (IndexedDB, cache, preferences) next to the portable .exe
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Data');
  try {
    fs.mkdirSync(portableDataDir, { recursive: true });
  } catch {
    // ignore mkdir errors
  }
  app.setPath('userData', portableDataDir);
}

const APP_ROOT = path.resolve(__dirname, '..');
const PRODUCT_NAME = 'Pointage';
let mainWindow = null;

// Single-instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

function isLocalhostHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    );
  } catch {
    return false;
  }
}

function isSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function getAppIconPath() {
  const icoPath = path.join(APP_ROOT, 'build', 'icon.ico');
  const pngPath = path.join(APP_ROOT, 'build', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    return icoPath;
  }
  if (fs.existsSync(pngPath)) {
    return pngPath;
  }
  if (fs.existsSync(icoPath)) {
    return icoPath;
  }
  return undefined;
}

function sanitizePdfFilename(fileName) {
  const base = path.basename(String(fileName || 'pointage.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-data-path', () => {
    const userData = app.getPath('userData');
    try {
      fs.mkdirSync(userData, { recursive: true });
    } catch {
      // ignore
    }
    return userData;
  });

  ipcMain.handle('app:open-data-folder', async () => {
    const userData = app.getPath('userData');
    try {
      fs.mkdirSync(userData, { recursive: true });
    } catch {
      // ignore
    }
    const errMsg = await shell.openPath(userData);
    return errMsg === '';
  });

  ipcMain.handle('app:print-to-pdf', async (_event, payload) => {
    const html = typeof payload?.html === 'string' ? payload.html : '';
    if (!html.trim()) {
      return { ok: false, error: 'Contenu HTML vide pour export PDF.' };
    }

    const safeFileName = sanitizePdfFilename(payload?.fileName || 'document.pdf');
    const tempHtmlPath = path.join(
      app.getPath('temp'),
      `pointage-print-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`
    );

    let printWin = null;
    try {
      fs.writeFileSync(tempHtmlPath, html, 'utf8');

      printWin = new BrowserWindow({
        show: false,
        width: 1200,
        height: 850,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      await printWin.loadFile(tempHtmlPath);
      const pdfBuffer = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: {
          top: 0.4,
          bottom: 0.4,
          left: 0.4,
          right: 0.4,
        },
      });

      const defaultDir = app.getPath('documents') || app.getPath('desktop');
      const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
        title: 'Enregistrer le PDF',
        defaultPath: path.join(defaultDir, safeFileName),
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, canceled: true };
      }

      fs.writeFileSync(saveResult.filePath, pdfBuffer);
      return { ok: true, filePath: saveResult.filePath };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : 'Erreur lors de la génération du PDF.',
      };
    } finally {
      if (printWin && !printWin.isDestroyed()) {
        printWin.destroy();
      }
      try {
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath);
        }
      } catch {
        // ignore temp cleanup failure
      }
    }
  });
}

function createMainWindow() {
  const isDev = process.env.ELECTRON_DEV === '1';
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const prodHtml = path.join(APP_ROOT, 'dist', 'index.html');

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    title: app.getName() || PRODUCT_NAME,
    icon: getAppIconPath(),
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(app.getName() || PRODUCT_NAME);
    }
  });

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url) && !isLocalhostHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || isLocalhostHttpUrl(url)) {
      return;
    }
    if (isSafeExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(prodHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Block all external internet requests (allow only file:, data:, blob:, devtools:, and localhost)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (!isLocalhostHttpUrl(details.url)) {
          callback({ cancel: true });
          return;
        }
      }
    } catch {
      // Allow non-URL or internal schemes
    }
    callback({ cancel: false });
  });

  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
