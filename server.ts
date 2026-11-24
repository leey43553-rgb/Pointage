import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_CONFIG,
  CONFIG_PATH,
  DATA_DIR,
  DB_PATH,
  PHOTOS_DIR,
  db,
  initDb,
  updateAppFileConfig,
  type SettingsRow,
} from './server/db.ts';
import { cleanupOldPhotos } from './server/photos.ts';
import {
  createApiRouter,
  getPrimaryLanIp,
  getServerLanIps,
  type DesktopHooks,
} from './server/routes.ts';

export { APP_CONFIG, DATA_DIR, updateAppFileConfig };

declare const __PROD_BUNDLE__: boolean | undefined;

const PORT = Number(process.env.PORT) || APP_CONFIG.port || 3000;
const HOST = process.env.HOST || APP_CONFIG.host || '0.0.0.0';
const APP_ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_FILENAME = path.basename(fileURLToPath(import.meta.url));

function runPhotoRetentionJob(): void {
  try {
    const row = db.prepare('SELECT photo_retention_days FROM settings WHERE id = 1').get() as
      | Pick<SettingsRow, 'photo_retention_days'>
      | undefined;
    cleanupOldPhotos(row?.photo_retention_days ?? 90);
  } catch {
    // ignore startup cleanup error
  }
}

export interface StartedPointageServer {
  httpServer: http.Server;
  app: express.Express;
  port: number;
  host: string;
  lanIps: string[];
  primaryLanIp: string;
  dataDir: string;
  dbPath: string;
  photosDir: string;
  configPath: string;
  closeServer: () => Promise<void>;
}

export async function startServer(options?: {
  prodMode?: boolean;
  desktopHooks?: DesktopHooks;
}): Promise<StartedPointageServer> {
  const isCompiledBundle =
    (typeof __PROD_BUNDLE__ !== 'undefined' && __PROD_BUNDLE__) || ENTRY_FILENAME === 'server.js';
  const isProdMode =
    options?.prodMode ??
    (isCompiledBundle ||
      process.env.NODE_ENV === 'production' ||
      process.argv.includes('--prod'));

  if (isProdMode && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  await initDb();
  runPhotoRetentionJob();
  const retentionTimer = setInterval(runPhotoRetentionJob, 6 * 60 * 60 * 1000);
  retentionTimer.unref();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Mount API routes
  app.use('/api', createApiRouter(options?.desktopHooks));

  const httpServer = http.createServer(app);

  const distDir = path.resolve(APP_ROOT_DIR, 'dist');
  const distIndex = path.join(distDir, 'index.html');

  if (isProdMode) {
    if (!fs.existsSync(distIndex)) {
      throw new Error(
        'Le dossier "dist" est introuvable. Exécutez "npm run build" pour compiler le frontend.'
      );
    }
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(distIndex);
    });
  } else if (!(typeof __PROD_BUNDLE__ !== 'undefined' && __PROD_BUNDLE__)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(PORT, HOST);
  });

  const lanIps = getServerLanIps();
  const primaryLanIp = getPrimaryLanIp();

  console.log(`\n==================================================`);
  console.log(`  Pointage Entreprise (${isProdMode ? 'Production' : 'Développement'})`);
  console.log(`  Écoute sur  : http://${HOST}:${PORT}`);
  console.log(`  Sur ce PC   : http://localhost:${PORT}`);
  for (const ip of lanIps) {
    console.log(`  Sur les téléphones (Wi-Fi) : http://${ip}:${PORT}`);
  }
  console.log(`  Dossier données : ${DATA_DIR}`);
  console.log(`  Base SQLite     : ${DB_PATH} (${db.getEngine()})`);
  console.log(`  Photos          : ${PHOTOS_DIR}`);
  console.log(`  Configuration   : ${CONFIG_PATH}`);
  console.log(`==================================================\n`);

  const closeServer = async () => {
    clearInterval(retentionTimer);
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    try {
      db.close();
    } catch {
      // ignore if already closed
    }
  };

  return {
    httpServer,
    app,
    port: PORT,
    host: HOST,
    lanIps,
    primaryLanIp,
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
    photosDir: PHOTOS_DIR,
    configPath: CONFIG_PATH,
    closeServer,
  };
}

const isDirectEntry =
  process.env.POINTAGE_ELECTRON !== '1' &&
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectEntry) {
  startServer().catch((err: NodeJS.ErrnoException) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(
        `Erreur : le port ${PORT} est déjà occupé par une autre application. Fermez-la puis réessayez.`
      );
    } else {
      console.error('Erreur au démarrage du serveur :', err);
    }
    process.exit(1);
  });
}
