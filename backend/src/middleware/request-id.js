import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  // Ignore caller-supplied IDs rather than reflecting untrusted header values.
  req.requestId = randomUUID();
  res.set('X-Request-Id', req.requestId);
  next();
}
