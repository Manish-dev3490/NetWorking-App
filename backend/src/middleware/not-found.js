import { HttpError } from '../shared/http-error.js';

export function notFound(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', 'Resource not found.'));
}
