import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { requireJson } from './middleware/require-json.js';
import { apiRoutes } from './routes.js';
import { createAuthRouter } from './modules/auth/routes.js';
import { createAuthSecurity } from './middleware/auth-security.js';

export function createApp({ database, authService, config }) {
  const app = express();
  app.disable('x-powered-by');
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

  app.use('/api/v1', requireJson, express.json({ limit: 32 * 1024 }));
  if (authService) {
    app.use('/api/v1', createAuthSecurity({ config }), createAuthRouter({ authService }));
  }
  app.use('/api/v1', apiRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
