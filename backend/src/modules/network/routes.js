import { Router } from 'express';
import { HttpError } from '../../shared/http-error.js';
import { sessionToken } from '../../shared/session-token.js';
import { noBody } from './validation.js';

export function createNetworkRouter({ authService, networkService }) {
  const router = Router();
  const respond = (req, res, data, meta = {}) => res.json({ data, meta: { requestId: req.requestId, ...meta } });
  const page = (req, res, result) => respond(req, res, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore });
  router.use(async (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const claimed = /^\/users\/[^/]+(?:\/(?:followers|following))?$/.test(path) || path === '/search/users'
      || /^\/me\/(?:following|follow-requests|followers)(?:\/[^/]+)?$/.test(path);
    if (!claimed) return next('router');
    const { user } = await authService.resolveSession(sessionToken(req));
    if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access members.');
    req.viewer = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const account = req.get('X-Account-Id');
      if (!account || account.toLowerCase() !== user.id) throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account changed. Review it before continuing.');
      noBody(req);
    }
    return next();
  });

  router.get('/search/users', async (req, res) => page(req, res, await networkService.searchUsers(req.viewer, req.query)));
  router.get('/users/:userId', async (req, res) => respond(req, res, await networkService.getProfile(req.viewer, req.params.userId)));
  router.get('/users/:userId/followers', async (req, res) => page(req, res, await networkService.listFollowers(req.viewer, req.params.userId, req.query)));
  router.get('/users/:userId/following', async (req, res) => page(req, res, await networkService.listFollowing(req.viewer, req.params.userId, req.query)));
  router.put('/me/following/:userId', async (req, res) => respond(req, res, await networkService.follow(req.viewer, req.params.userId)));
  router.delete('/me/following/:userId', async (req, res) => { await networkService.unfollow(req.viewer, req.params.userId); res.status(204).end(); });
  router.get('/me/follow-requests', async (req, res) => page(req, res, await networkService.listRequests(req.viewer, req.query)));
  router.put('/me/follow-requests/:userId', async (req, res) => respond(req, res, await networkService.acceptRequest(req.viewer, req.params.userId)));
  router.delete('/me/follow-requests/:userId', async (req, res) => { await networkService.rejectRequest(req.viewer, req.params.userId); res.status(204).end(); });
  router.delete('/me/followers/:userId', async (req, res) => { await networkService.removeFollower(req.viewer, req.params.userId); res.status(204).end(); });
  return router;
}
