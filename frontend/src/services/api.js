const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
let csrfToken;
let csrfRequest;
let csrfGeneration = 0;

export class ApiError extends Error {
  constructor(message, { status, code, fields, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.requestId = requestId;
  }
}

export function clearCsrfToken() {
  csrfGeneration += 1;
  csrfToken = undefined;
  csrfRequest = undefined;
}

async function readResponse(response, method) {
  if (response.status === 204 || (method === 'HEAD' && response.ok)) return null;
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Gather returned an unexpected response. Please try again.', {
      status: response.status, code: 'INVALID_RESPONSE', requestId: response.headers.get('X-Request-Id'),
    });
  }
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || 'The request could not be completed.', {
      status: response.status,
      code: payload?.error?.code || 'REQUEST_FAILED',
      fields: payload?.error?.fields,
      requestId: payload?.meta?.requestId || response.headers.get('X-Request-Id'),
    });
  }
  return payload;
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    const generation = csrfGeneration;
    const request = fetch(`${apiBaseUrl}/auth/csrf`, {
      credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    }).then((response) => readResponse(response, 'GET')).then((payload) => {
      const token = payload?.data?.csrfToken;
      if (typeof token !== 'string' || !token) {
        throw new ApiError('Unable to prepare your request. Please try again.', { code: 'INVALID_RESPONSE' });
      }
      if (generation === csrfGeneration) csrfToken = token;
      return token;
    }).finally(() => { if (csrfRequest === request) csrfRequest = undefined; });
    csrfRequest = request;
  }
  return csrfRequest;
}

// Session cookies stay HttpOnly; only the CSRF request token is held in memory.
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, rawBody, accountId, headers: customHeaders, ...requestOptions } = options;
  const requestMethod = method.toUpperCase();
  const normalizedPath = path.replace(/^\/+/, '');
  const mutating = !safeMethods.has(requestMethod);
  const headers = new Headers(customHeaders);
  headers.set('Accept', 'application/json');
  // Keep the originating account across cookie changes and CSRF retries.
  if (accountId) headers.set('X-Account-Id', accountId);
  if (mutating) {
    headers.set('X-App-Request', 'web');
    if (rawBody === undefined) headers.set('Content-Type', 'application/json');
    else if (!headers.has('Content-Type')) headers.set('Content-Type', rawBody.type || 'application/octet-stream');
  } else if (body !== undefined) headers.set('Content-Type', 'application/json');

  async function send(retryCsrf) {
    if (mutating) headers.set('X-CSRF-Token', await getCsrfToken());
    try {
      const timeout = rawBody === undefined ? 15000 : 60000;
      const signal = requestOptions.signal
        ? AbortSignal.any([requestOptions.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout);
      const response = await fetch(`${apiBaseUrl}/${normalizedPath}`, {
        ...requestOptions, signal, method: requestMethod, headers, credentials: 'include',
        body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
      });
      const payload = await readResponse(response, requestMethod);
      if (mutating && normalizedPath === 'me/profile' && accountId && payload?.data?.id && payload.data.id !== accountId) {
        throw new ApiError('Your signed-in account changed. Please review the current account before saving.', {
          status: 409, code: 'ACCOUNT_CHANGED', requestId: payload.meta?.requestId,
        });
      }
      return payload;
    } catch (error) {
      if (requestOptions.signal?.aborted) throw error;
      // An explicit CSRF rejection happens before the mutation executes.
      if (mutating && retryCsrf && error.status === 403 && error.code === 'CSRF_REJECTED') {
        clearCsrfToken();
        return send(false);
      }
      if (error.status === 409 && error.code === 'ACCOUNT_CHANGED') {
        clearCsrfToken();
        window.dispatchEvent(new Event('gather:account-changed'));
      }
      if (error.status === 401 && (['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)
        || normalizedPath === 'me' || normalizedPath.startsWith('me/'))) {
        clearCsrfToken();
        window.dispatchEvent(new CustomEvent('gather:session-ended', { detail: { accountId } }));
      }
      throw error;
    }
  }

  const payload = await send(true);
  if (mutating && ['auth/register', 'auth/login', 'auth/logout'].includes(normalizedPath)) clearCsrfToken();
  return payload;
}
