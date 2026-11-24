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
  type SettingsRow,
} from './server/db.ts';
import { cleanupOldPhotos } from './server/photos.ts';
import { createApiRouter, getServerLanIps } from './server/routes.ts';

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

async function startServer() {
  const isCompiledBundle =
    (typeof __PROD_BUNDLE__ !== 'undefined' && __PROD_BUNDLE__) || ENTRY_FILENAME === 'server.js';
  const isProdMode =
    isCompiledBundle ||
    process.env.NODE_ENV === 'production' ||
    process.argv.includes('--prod');

  if (isProdMode && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  initDb();
  runPhotoRetentionJob();
  setInterval(runPhotoRetentionJob, 6 * 60 * 60 * 1000).unref();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Mount API routes
  app.use('/api', createApiRouter());

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

  httpServer.listen(PORT, HOST, () => {
    console.log(`\n==================================================`);
    console.log(`  Pointage Entreprise (${isProdMode ? 'Production' : 'Développement'})`);
    console.log(`  Écoute sur  : http://${HOST}:${PORT}`);
    console.log(`  Sur ce PC   : http://localhost:${PORT}`);
    const lanIps = getServerLanIps();
    for (const ip of lanIps) {
      console.log(`  Sur les téléphones (Wi-Fi) : http://${ip}:${PORT}`);
    }
    console.log(`  Dossier données : ${DATA_DIR}`);
    console.log(`  Base SQLite     : ${DB_PATH}`);
    console.log(`  Photos          : ${PHOTOS_DIR}`);
    console.log(`  Configuration   : ${CONFIG_PATH}`);
    console.log(`==================================================\n`);
  });
}

startServer().catch((err) => {
  console.error('Erreur au démarrage du serveur :', err);
  process.exit(1);
});
