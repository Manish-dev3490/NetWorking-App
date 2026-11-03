import { Router } from 'express';
import { HttpError } from '../../shared/http-error.js';
import { sessionToken } from '../../shared/session-token.js';

function emptyBody(req) {
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object'
    || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This request does not accept any fields.');
  }
}

export function createNotificationRouter({ authService, notificationService }) {
  const router = Router();
  const respond = (req, res, data, meta = {}) => res.json({ data, meta: { requestId: req.requestId, ...meta } });

  router.use('/notifications', async (req, res, next) => {
    const { user } = await authService.resolveSession(sessionToken(req));
    if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access notifications.');
    if (req.get('X-Account-Id')?.toLowerCase() !== user.id) {
      throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account has changed. Please review it before continuing.');
    }
    req.viewer = user;
    next();
  });

  router.get('/notifications', async (req, res) => {
    if (Object.keys(req.query).some((name) => !['limit', 'cursor'].includes(name))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Unsupported notification filter.');
    }
    const limit = req.query.limit ?? '10';
    if (typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 20) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Page size must be between 1 and 20.');
    }
    const { cursor } = req.query;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1500)) {
      throw new HttpError(400, 'INVALID_CURSOR', 'This page cursor is invalid. Refresh notifications.');
    }
    const { items, ...meta } = await notificationService.list(req.viewer, { limit: Number(limit), cursor });
    respond(req, res, items, meta);
  });
  router.get('/notifications/unread-count', async (req, res) => {
    respond(req, res, await notificationService.unreadCount(req.viewer));
  });
  router.patch('/notifications/read-all', async (req, res) => {
    emptyBody(req);
    respond(req, res, await notificationService.markAllRead(req.viewer));
  });
  router.patch('/notifications/:notificationId/read', async (req, res) => {
    emptyBody(req);
    respond(req, res, await notificationService.markRead(req.viewer, req.params.notificationId));
  });
  return router;
}
