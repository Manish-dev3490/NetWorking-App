import express from 'express';
import { join } from 'node:path';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { requireJson } from './middleware/require-json.js';
import { apiRoutes } from './routes.js';
import { createAuthRouter } from './modules/auth/routes.js';
import { createAuthSecurity } from './middleware/auth-security.js';
import { createPostRouter } from './modules/posts/routes.js';
import { createNetworkRouter } from './modules/network/routes.js';
import { createNotificationRouter } from './modules/notifications/routes.js';

export function createApp({ database, authService, postService, networkService, notificationService, config, frontendDirectory }) {
  const app = express();
  app.disable('x-powered-by');
  if (config?.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  app.use(requestId);
  app.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  app.get('/health/live', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', async (req, res) => {
    let available = false;
    try {
      available = await database.isAvailable();
    } catch {
      // A dependency failure must never result in successful readiness.
    }
    res.status(available ? 200 : 503).json({ status: available ? 'ready' : 'unavailable' });
  });

  const parseJson = express.json({ limit: 32 * 1024 });
  app.use('/api/v1', (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    if (postService && req.method === 'POST' && path === '/media/uploads') return next();
    return requireJson(req, res, (error) => error ? next(error) : parseJson(req, res, next));
  });
  if (authService) {
    app.use('/api/v1', createAuthSecurity({ config }), createAuthRouter({ authService }));
    if (postService) app.use('/api/v1', createPostRouter({ authService, postService }));
    if (networkService) app.use('/api/v1', createNetworkRouter({ authService, networkService }));
    if (notificationService) app.use('/api/v1', createNotificationRouter({ authService, notificationService }));
  }
  app.use('/api/v1', apiRoutes);
  if (frontendDirectory) {
    // Only known browser routes fall back to the SPA. Missing API and asset URLs still return 404.
    app.get(/^\/(?:login|signup|profile|members|requests|saved|notifications|(?:p|u)\/[0-9a-f]{24})?$/i,
      (_req, res) => res.sendFile(join(frontendDirectory, 'index.html')));
    app.use('/assets', express.static(join(frontendDirectory, 'assets'), { immutable: true, maxAge: '1y', index: false,
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }));
  }
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
