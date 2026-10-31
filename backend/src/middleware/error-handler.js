import { HttpError } from '../shared/http-error.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';

  if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'JSON request bodies must not exceed 32 KiB.';
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'The request body must contain valid JSON.';
  } else if (error.status === 415) {
    status = 415;
    code = 'UNSUPPORTED_MEDIA_TYPE';
    message = 'Use a supported JSON content type, charset, and encoding.';
  } else if (error instanceof HttpError) {
    ({ status, code, message } = error);
  }

  if (status >= 500) {
    console.error(JSON.stringify({ requestId: req.requestId, code }));
  }

  res.status(status).json({ error: { code, message }, meta: { requestId: req.requestId } });
}
