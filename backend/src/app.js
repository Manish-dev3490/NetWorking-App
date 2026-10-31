import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { requireJson } from './middleware/require-json.js';
import { apiRoutes } from './routes.js';

export function createApp({ database }) {
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

  // Same-origin browser access is supplied by Vite locally and hosting later.
  // Resolve the documented CSRF policy before adding any mutation endpoints.
  app.use('/api/v1', requireJson, express.json({ limit: 32 * 1024 }), apiRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
