import { HttpError } from '../shared/http-error.js';

export function requireJson(req, res, next) {
  const mediaType = req.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && mediaType !== 'application/json') {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json for API writes.'));
  }

  next();
}
