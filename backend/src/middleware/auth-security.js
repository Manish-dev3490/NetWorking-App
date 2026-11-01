import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { HttpError } from '../shared/http-error.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfLifetimeSeconds = 2 * 60 * 60;

function cookie(req, name) {
  const entry = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ''; }
}

function equal(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthSecurity({ config, now = Date.now }) {
  const router = Router();
  const secret = Buffer.from(config.authSecret, 'hex');
  const limits = new Map();

  function signature(req, value) {
    const sessionBinding = createHash('sha256').update(cookie(req, '__Host-session')).digest('hex');
    return createHmac('sha256', secret).update(`${sessionBinding}:${value}`).digest('hex');
  }

  function validToken(req, token) {
    const match = /^(\d{10})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const age = Math.floor(now() / 1000) - Number(match[1]);
    return age >= -30 && age <= csrfLifetimeSeconds
      && equal(match[3], signature(req, `${match[1]}.${match[2]}`));
  }

  function allow(key, count, windowMs, res) {
    const time = now();
    let entry = limits.get(key);
    if (!entry || entry.expiresAt <= time) {
      if (limits.size >= 10_000) {
        for (const [oldKey, value] of limits) {
          if (value.expiresAt <= time) limits.delete(oldKey);
        }
        if (limits.size >= 10_000) limits.delete(limits.keys().next().value);
      }
      entry = { count: 0, expiresAt: time + windowMs };
      limits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > count) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - time) / 1000))));
      const error = new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
      error.retryAt = new Date(entry.expiresAt).toISOString();
      throw error;
    }
  }

  router.get('/auth/csrf', (req, res) => {
    if (req.get('Origin') && req.get('Origin') !== config.appOrigin) {
      throw new HttpError(403, 'CSRF_REJECTED', 'This request could not be verified.');
    }
    allow(`csrf:${req.ip}`, 120, 60_000, res);
    let csrfToken = cookie(req, '__Host-csrf');
    // Tabs share this cookie. Replacing a valid token would invalidate another
    // tab's in-flight mutation or its single CSRF recovery attempt.
    if (!validToken(req, csrfToken)) {
      const value = `${Math.floor(now() / 1000)}.${randomBytes(32).toString('hex')}`;
      csrfToken = `${value}.${signature(req, value)}`;
      res.cookie('__Host-csrf', csrfToken, {
        secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: csrfLifetimeSeconds * 1000,
      });
    }
    res.json({ data: { csrfToken }, meta: { requestId: req.requestId } });
  });

  router.use((req, res, next) => {
    if (safeMethods.has(req.method)) return next();
    const header = req.get('X-CSRF-Token') ?? '';
    if (req.get('Origin') !== config.appOrigin || req.get('X-App-Request') !== 'web'
      || !validToken(req, header) || !equal(header, cookie(req, '__Host-csrf'))) {
      return next(new HttpError(403, 'CSRF_REJECTED', 'This request could not be verified.'));
    }

    // Express accepts case variants and trailing slashes for these routes.
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    if (path === '/auth/register' && req.method === 'POST') {
      allow(`register:${req.ip}`, 10, 60 * 60_000, res);
    } else if (path === '/auth/login' && req.method === 'POST') {
      allow(`login-ip:${req.ip}`, 30, 15 * 60_000, res);
      if (typeof req.body?.email === 'string') {
        const identity = createHash('sha256').update(req.body.email.trim().normalize('NFC').toLowerCase()).digest('hex');
        allow(`login-identity:${identity}`, 10, 15 * 60_000, res);
      }
    } else {
      allow(`mutation:${req.ip}`, 120, 60_000, res);
    }
    return next();
  });
  return router;
}
