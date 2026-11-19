import express from 'express';
import fs from 'fs';
import path from 'path';
import { serverConfig, setDatabaseModeState } from './server/config.ts';
import { configureDatabase } from './server/db.ts';
import { createLocalD1Adapter } from './server/localD1Adapter.ts';
import { createApiRouter } from './server/routes.ts';

async function startServer() {
  const localD1 = await createLocalD1Adapter();
  configureDatabase(localD1);
  setDatabaseModeState('local_sqlite');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Dynamic TON Connect manifest matching the active request origin with required CORS headers
  const resolveOrigin = (req: express.Request) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
      .split(',')[0]
      .trim();
    return (host ? `${proto}://${host}` : serverConfig.appUrl).replace(/\/+$/, '');
  };

  app.options('/tonconnect-manifest.json', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
  });

  app.get('/tonconnect-manifest.json', (req, res) => {
    const origin = resolveOrigin(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      url: origin,
      name: 'LOVA Mining',
      iconUrl: `${origin}/icon.png`,
    });
  });

  app.options('/icon.png', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
  });

  app.get('/icon.png', (_req, res) => {
    const candidates = [
      path.resolve(process.cwd(), 'public', 'icon.png'),
      path.resolve(process.cwd(), 'dist', 'icon.png'),
      path.resolve(process.cwd(), 'src', 'assets', 'images', 'lova_emblem_1794836082450.jpg'),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type(filePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
        res.sendFile(filePath);
        return;
      }
    }
    res.status(404).end();
  });

  // Mount server-side API (includes /api/health and /api/telegram/webhook)
  app.use('/api', createApiRouter());

  // Serve Vite middleware in development, or static dist bundle in production
  const isProdMode =
    serverConfig.nodeEnv === 'production' || process.env.npm_lifecycle_event === 'start';
  let useViteDev = !isProdMode;
  if (useViteDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch {
      useViteDev = false;
    }
  }

  if (!useViteDev) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const listenPort = Number(process.env.PORT || serverConfig.port || 3000);
  app.listen(listenPort, '0.0.0.0', () => {
    console.log(
      `LOVA Mining server listening on http://0.0.0.0:${listenPort} (env=${serverConfig.nodeEnv})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start LOVA Mining server:', err);
  process.exit(1);
});
