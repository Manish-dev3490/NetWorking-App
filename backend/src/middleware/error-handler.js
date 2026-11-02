import { constants as zlibConstants } from 'node:zlib';
import { HttpError } from '../shared/http-error.js';

const brotliFormatErrors = new Set(
  Object.entries(zlibConstants)
    .filter(([name]) => name.startsWith('BROTLI_DECODER_ERROR_FORMAT_'))
    .map(([, errno]) => errno),
);

function isCompressedBodyError(error, req) {
  const encoding = req.get('Content-Encoding')?.toLowerCase();
  // body-parser wraps native decoder failures with status 400 and no error.type.
  return error.status === 400
    && !error.type
    && ['gzip', 'deflate', 'br', 'zstd'].includes(encoding)
    && Number.isInteger(error.errno)
    && typeof error.code === 'string'
    && (
      ['Z_DATA_ERROR', 'Z_BUF_ERROR', 'Z_NEED_DICT'].includes(error.code)
      || (encoding === 'br' && brotliFormatErrors.has(error.errno))
      || (encoding === 'zstd' && error.code.startsWith('ZSTD_error_'))
    );
}

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
  } else if (error.status === 415 && !(error instanceof HttpError)) {
    status = 415;
    code = 'UNSUPPORTED_MEDIA_TYPE';
    message = 'Use a supported JSON content type, charset, and encoding.';
  } else if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (isCompressedBodyError(error, req)) {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'The request body must contain valid compressed JSON.';
  }

  if (status >= 500) {
    console.error(JSON.stringify({ requestId: req.requestId, code }));
  }

  const details = { code, message };
  if (error instanceof HttpError && Array.isArray(error.fields)) details.fields = error.fields;
  if (error instanceof HttpError && error.retryAt) details.retryAt = error.retryAt;
  res.status(status).json({ error: details, meta: { requestId: req.requestId } });
}
