import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function serve(t, database = { isAvailable: async () => false }) {
  const server = createServer(createApp({ database }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function errorResponse(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const requestId = response.headers.get('x-request-id');
  assert.match(requestId, uuidPattern);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.ok(body.error.message.length > 0);
  assert.deepEqual(body.meta, { requestId });
  assert.deepEqual(Object.keys(body).sort(), ['error', 'meta']);
  assert.equal(body.error.stack, undefined);
  return body;
}

function jsonBodyOfSize(size) {
  const emptyBody = JSON.stringify({ value: '' });
  return JSON.stringify({ value: 'x'.repeat(size - Buffer.byteLength(emptyBody)) });
}

test('liveness does not depend on the database and replaces untrusted request IDs', async (t) => {
  let checks = 0;
  const origin = await serve(t, {
    isAvailable: async () => {
      checks += 1;
      throw new Error('Database must not be queried for liveness');
    },
  });
  const response = await fetch(`${origin}/health/live`, {
    headers: { 'X-Request-Id': 'caller-controlled-id' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.match(response.headers.get('x-request-id'), uuidPattern);
  assert.notEqual(response.headers.get('x-request-id'), 'caller-controlled-id');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(checks, 0);
});

for (const scenario of [
  { name: 'usable database', check: async () => true, status: 200, state: 'ready' },
  { name: 'unavailable database', check: async () => false, status: 503, state: 'unavailable' },
  {
    name: 'database check throws',
    check: async () => { throw new Error('private-dependency-detail'); },
    status: 503,
    state: 'unavailable',
  },
]) {
  test(`readiness reflects ${scenario.name}`, async (t) => {
    let checks = 0;
    const origin = await serve(t, {
      isAvailable: async () => {
        checks += 1;
        return scenario.check();
      },
    });
    const response = await fetch(`${origin}/health/ready`);
    assert.equal(response.status, scenario.status);
    assert.deepEqual(await response.json(), { status: scenario.state });
    assert.match(response.headers.get('x-request-id'), uuidPattern);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(checks, 1);
  });
}

test('unknown routes return the documented not-found error envelope', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`);
  const body = await errorResponse(response, 404, 'NOT_FOUND');
  assert.deepEqual(body.error, { code: 'NOT_FOUND', message: 'Resource not found.' });
});

test('malformed JSON returns a safe 400 error', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"password":"request-secret",',
  });
  const body = await errorResponse(response, 400, 'BAD_REQUEST');
  assert.doesNotMatch(JSON.stringify(body), /request-secret|SyntaxError|stack/);
});

test('JSON at exactly 32 KiB reaches routing', async (t) => {
  const origin = await serve(t);
  const body = jsonBodyOfSize(32 * 1024);
  assert.equal(Buffer.byteLength(body), 32 * 1024);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  await errorResponse(response, 404, 'NOT_FOUND');
});

test('JSON exceeding 32 KiB is rejected before routing', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: jsonBodyOfSize(32 * 1024 + 1),
  });
  await errorResponse(response, 413, 'PAYLOAD_TOO_LARGE');
});

test('API mutations reject unsupported content types', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  await errorResponse(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('empty mutations with JSON Content-Type reach routing without body framing headers', async (t) => {
  const origin = await serve(t);
  const response = await new Promise((resolve, reject) => {
    const req = request(`${origin}/api/v1/not-implemented`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});
