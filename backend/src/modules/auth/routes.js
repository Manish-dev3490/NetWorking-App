import { Router } from 'express';
import { HttpError } from '../../shared/http-error.js';

export const SESSION_COOKIE = '__Host-session';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

function sessionToken(req) {
  const values = (req.headers.cookie ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return undefined;
  try { return decodeURIComponent(values[0].slice(SESSION_COOKIE.length + 1)); }
  catch { return undefined; }
}

function noBody(req) {
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object'
    || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This request does not accept any fields.');
  }
}

export function createAuthRouter({ authService }) {
  const router = Router();
  const respond = (req, res, user, status = 200) => res.status(status).json({ data: user, meta: { requestId: req.requestId } });
  const signedIn = (req, res, result, status) => {
    res.cookie(SESSION_COOKIE, result.token, { ...cookieOptions, expires: result.expiresAt });
    return respond(req, res, result.user, status);
  };
  router.post('/auth/register', async (req, res) => {
    const result = await authService.register(req.body);
    res.location('/api/v1/me');
    return signedIn(req, res, result, 201);
  });
  router.post('/auth/login', async (req, res) => signedIn(req, res, await authService.login(req.body), 200));
  router.post('/auth/logout', async (req, res) => {
    noBody(req);
    await authService.logout(sessionToken(req), req.get('X-Account-Id'));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });
  router.get('/me', async (req, res) => {
    const { user } = await authService.resolveSession(sessionToken(req));
    respond(req, res, user);
  });
  router.patch('/me/profile', async (req, res) => {
    respond(req, res, await authService.updateProfile(sessionToken(req), req.body, req.get('X-Account-Id')));
  });
  return router;
}
