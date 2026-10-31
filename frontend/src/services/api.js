const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(
  /\/+$/,
  '',
);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

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

// Return the complete API envelope so callers retain pagination and request IDs.
// No requests run until a future feature explicitly calls this function.
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers: customHeaders, ...requestOptions } = options;
  const requestMethod = method.toUpperCase();
  const headers = new Headers(customHeaders);
  headers.set('Accept', 'application/json');

  if (!safeMethods.has(requestMethod)) {
    headers.set('X-App-Request', 'web');
    headers.set('Content-Type', 'application/json');
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}/${path.replace(/^\/+/, '')}`, {
    ...requestOptions,
    method: requestMethod,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204 || (requestMethod === 'HEAD' && response.ok)) {
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The server returned an unexpected response.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
      requestId: response.headers.get('X-Request-Id'),
    });
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || 'The request could not be completed.',
      {
        status: response.status,
        code: payload?.error?.code || 'REQUEST_FAILED',
        fields: payload?.error?.fields,
        requestId: payload?.meta?.requestId || response.headers.get('X-Request-Id'),
      },
    );
  }

  return payload;
}
