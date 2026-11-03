import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as zlib from 'node:zlib';
import { createApp } from '../src/app.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function serve(t, database = { isAvailable: async () => false }, frontendDirectory) {
  const server = createServer(createApp({ database, frontendDirectory }));
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

test('production serves frontend routes and assets without masking API or health errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gather-frontend-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const html = '<!doctype html><title>Gather</title>';
  await mkdir(join(directory, 'assets'));
  await Promise.all([
    writeFile(join(directory, 'index.html'), html),
    writeFile(join(directory, 'assets', 'app-hashed.js'), 'export {};'),
  ]);
  const origin = await serve(t, { isAvailable: async () => true }, directory);
  for (const path of ['/', '/notifications', '/p/507f1f77bcf86cd799439011']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), html);
  }
  const asset = await fetch(`${origin}/assets/app-hashed.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(await asset.text(), 'export {};');
  for (const path of ['/api/v1/missing', '/health/missing', '/assets/missing.js']) {
    await errorResponse(await fetch(`${origin}${path}`), 404, 'NOT_FOUND');
  }
  assert.deepEqual(await (await fetch(`${origin}/health/ready`)).json(), { status: 'ready' });
});

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

for (const [encoding, compress] of [
  ['gzip', zlib.gzipSync],
  ['deflate', zlib.deflateSync],
  ['br', zlib.brotliCompressSync],
]) {
  for (const scenario of ['malformed', 'truncated']) {
    test(`${scenario} ${encoding} bodies return a safe 400 error`, async (t) => {
      const origin = await serve(t);
      const compressed = compress('{"value":"request-secret"}');
      const requestBody = scenario === 'malformed'
        ? Buffer.from('invalid-compression-secret')
        : compressed.subarray(0, 4);
      const response = await fetch(`${origin}/api/v1/not-implemented`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding },
        body: requestBody,
      });
      const body = await errorResponse(response, 400, 'BAD_REQUEST');
      assert.doesNotMatch(
        JSON.stringify(body),
        /request-secret|compression-secret|header check|end of file|Decompression|errno|stack|Z_DATA_ERROR|Z_BUF_ERROR|ERR__ERROR/,
      );
    });
  }

  test(`valid ${encoding} JSON reaches routing`, async (t) => {
    const origin = await serve(t);
    const response = await fetch(`${origin}/api/v1/not-implemented`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding },
      body: compress('{"value":"example"}'),
    });
    await errorResponse(response, 404, 'NOT_FOUND');
  });

  test(`${encoding} bodies exceeding the decompressed JSON limit return 413`, async (t) => {
    const origin = await serve(t);
    const response = await fetch(`${origin}/api/v1/not-implemented`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding },
      body: compress(jsonBodyOfSize(32 * 1024 + 1)),
    });
    await errorResponse(response, 413, 'PAYLOAD_TOO_LARGE');
  });
}

test('Brotli bodies with invalid window bits return a safe 400 error', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' },
    body: Buffer.from([0x11, 0x00]),
  });
  const body = await errorResponse(response, 400, 'BAD_REQUEST');
  assert.doesNotMatch(JSON.stringify(body), /WINDOW_BITS|errno|stack|Decompression/);
});

test('malformed zstd bodies return a safe 400 error when supported by Node', {
  skip: typeof zlib.createZstdDecompress !== 'function' && 'This Node version does not support zstd.',
}, async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'zstd' },
    body: 'invalid-compression-secret',
  });
  const body = await errorResponse(response, 400, 'BAD_REQUEST');
  assert.doesNotMatch(JSON.stringify(body), /compression-secret|frame descriptor|ZSTD_error|errno|stack/);
});

test('unsupported JSON compression returns a safe 415 error', async (t) => {
  const origin = await serve(t);
  const response = await fetch(`${origin}/api/v1/not-implemented`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'unsupported-encoding' },
    body: '{}',
  });
  const body = await errorResponse(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
  assert.doesNotMatch(JSON.stringify(body), /unsupported-encoding|stack/);
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
