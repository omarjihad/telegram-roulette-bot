import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import { generalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import publicRoutes from './routes/public.routes';
import adminRoutes from './routes/admin.routes';
import { getPrizeImage } from './controllers/roulette.controller';
import { getShareImage } from './controllers/adminSystem.controller';
import { getShowcase } from './controllers/showcase.controller';
import { env } from './config/env';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({
    logger,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === '/api/healthz' },
  }));
  app.use(generalLimiter);

  app.get('/health', (_req, res) => res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() }));
  app.get('/api/healthz', (_req, res) => res.json({
    status: 'ok',
    databaseConnected: mongoose.connection.readyState === 1,
    gameplayEnabled: env.GAMEPLAY_ENABLED && env.OWNER_ID > 0,
    pollingEnabled: env.BOT_POLLING_ENABLED && env.GAMEPLAY_ENABLED && env.OWNER_ID > 0,
  }));
  app.use('/api', (_req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok: false, code: 'DATABASE_UNAVAILABLE', message: 'تعذر الاتصال بقاعدة البيانات. حاول مرة ثانية بعد قليل.' });
    }
    return next();
  });
  app.get('/api/showcase', getShowcase);

  // Deliberately outside miniAppAuth: <img> tags can't attach the X-Telegram-Init-Data
  // header, so this route (and the settings share-image one below) must stay public.
  app.get('/api/prizes/:key/image', getPrizeImage);
  app.get('/api/settings/share-image', getShareImage);

  app.use('/api', (_req, res, next) => {
    if (!env.GAMEPLAY_ENABLED || env.OWNER_ID <= 0) {
      return res.status(503).json({ ok: false, code: 'PREVIEW_ONLY', message: 'هذه النسخة للمعاينة حالياً. اللعب وإدارة الجوائز يتفعلان بعد إكمال الربط بأمان.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return next();
  });
  app.use('/api', publicRoutes);
  app.use('/api/admin', adminRoutes);

  // Serve the built Mini App (client/dist) as static files in production.
  //
  // Telegram's in-app WebView (and third-party Telegram clients especially) can cache
  // the Mini App page far more aggressively than normal browsers, sometimes ignoring
  // weak cache hints like `max-age=0`. Vite content-hashes every JS/CSS filename, so
  // those are 100% safe to cache forever — but index.html (which references those
  // hashed filenames) must NEVER be cached, or the client keeps loading an old build
  // that still points at old, possibly-deleted asset files.
  // The registered web artifact serves the Vite build, not this API process.
  // Render runs both pieces in one container, so CLIENT_DIST_DIR enables the same
  // API process to serve the built Mini App there without requiring a second service.
  const clientDistDir = env.CLIENT_DIST_DIR || path.resolve(process.cwd(), 'artifacts/bounty-roulette/dist/public');
  const clientIndexPath = path.join(clientDistDir, 'index.html');
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-store, max-age=0');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(clientIndexPath, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
