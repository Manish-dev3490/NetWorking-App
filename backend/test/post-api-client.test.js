import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const accountId = '507f1f77bcf86cd799439011';
const assetId = '507f1f77bcf86cd799439012';
const postId = '507f1f77bcf86cd799439013';
const uploadKey = '11111111-1111-4111-8111-111111111111';
const publishKey = '22222222-2222-4222-8222-222222222222';
let moduleVersion = 0;

async function client(t, fetchHandler) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  globalThis.fetch = fetchHandler;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  // Load the real browser client and post wrappers, replacing only Vite's env
  // expression and the wrapper's module URL, as in account-client.test.js.
  const source = (await readFile(new URL('../../frontend/src/services/api.js', import.meta.url), 'utf8'))
    .replaceAll('import.meta.env', '({})');
  const apiUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleVersion++}`;
  const wrapper = (await readFile(new URL('../../frontend/src/features/posts/post-api.js', import.meta.url), 'utf8'))
    .replace('../../services/api.js', apiUrl);
  const api = await import(apiUrl);
  const posts = await import(`data:text/javascript;base64,${Buffer.from(wrapper).toString('base64')}`);
  return { ...api, ...posts, events };
}

function response(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('a File upload retains its raw bytes, MIME type, account and retry key across one CSRF refresh', async (t) => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
  const file = new File([bytes], 'moment.png', { type: 'image/png' });
  const controller = new AbortController();
  let csrfFetches = 0;
  let uploads = 0;
  let changed = 0;
  const requestTokens = [];
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) {
      csrfFetches += 1;
      return response(200, { data: { csrfToken: `token-${csrfFetches}` } });
    }
    assert.equal(url, '/api/v1/media/uploads');
    uploads += 1;
    const headers = new Headers(options.headers);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.body, file);
    assert.deepEqual(new Uint8Array(await options.body.arrayBuffer()), bytes);
    assert.equal(options.rawBody, undefined);
    assert.equal(options.accountId, undefined);
    assert.equal(headers.get('Content-Type'), 'image/png');
    assert.equal(headers.get('X-Account-Id'), accountId);
    assert.equal(headers.get('Idempotency-Key'), uploadKey);
    assert.equal(headers.get('X-App-Request'), 'web');
    assert.equal(options.signal.aborted, false);
    requestTokens.push(headers.get('X-CSRF-Token'));
    if (uploads === 1) return response(403, { error: { code: 'CSRF_REJECTED', message: 'Refresh token.' } });
    return response(201, { data: { id: assetId, status: 'ready' } });
  });
  api.events.addEventListener('gather:account-changed', () => { changed += 1; });
  const result = await api.uploadImage(file, accountId, uploadKey, controller.signal);
  assert.equal(result.data.id, assetId);
  assert.notEqual(result.data.id, accountId);
  assert.equal(changed, 0);
  assert.equal(uploads, 2);
  assert.equal(csrfFetches, 2);
  assert.deepEqual(requestTokens, ['token-1', 'token-2']);
});

test('a raw Blob body infers its image MIME type and accepts a media resource ID', async (t) => {
  const blob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' });
  let uploads = 0;
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) return response(200, { data: { csrfToken: 'token' } });
    uploads += 1;
    assert.equal(options.body, blob);
    assert.equal(new Headers(options.headers).get('Content-Type'), 'image/webp');
    assert.equal(new Headers(options.headers).get('X-Account-Id'), accountId);
    return response(201, { data: { id: assetId } });
  });
  const result = await api.apiRequest('media/uploads', {
    method: 'POST', rawBody: blob, accountId, headers: { 'Idempotency-Key': uploadKey },
  });
  assert.equal(result.data.id, assetId);
  assert.equal(uploads, 1);
});

test('publication retries preserve the JSON payload and key while accepting a post ID distinct from its author', async (t) => {
  const body = { caption: 'A moment', hashtags: ['moments'], media: [{ assetId, altText: 'A photo' }] };
  let csrfFetches = 0;
  let publications = 0;
  let changed = 0;
  const requestTokens = [];
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) {
      csrfFetches += 1;
      return response(200, { data: { csrfToken: `token-${csrfFetches}` } });
    }
    assert.equal(url, '/api/v1/posts');
    publications += 1;
    const headers = new Headers(options.headers);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, JSON.stringify(body));
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('X-Account-Id'), accountId);
    assert.equal(headers.get('Idempotency-Key'), publishKey);
    requestTokens.push(headers.get('X-CSRF-Token'));
    if (publications === 1) return response(403, { error: { code: 'CSRF_REJECTED', message: 'Refresh token.' } });
    return response(201, { data: { id: postId, author: { id: accountId } } });
  });
  api.events.addEventListener('gather:account-changed', () => { changed += 1; });
  const result = await api.publishPost(body, accountId, publishKey);
  assert.equal(result.data.id, postId);
  assert.notEqual(result.data.id, accountId);
  assert.equal(changed, 0);
  assert.equal(publications, 2);
  assert.equal(csrfFetches, 2);
  assert.deepEqual(requestTokens, ['token-1', 'token-2']);
});

test('binary uploads stop after one CSRF retry without changing the body or account precondition', async (t) => {
  const file = new File(['photo bytes'], 'moment.jpg', { type: 'image/jpeg' });
  let uploads = 0;
  let csrfFetches = 0;
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) {
      csrfFetches += 1;
      return response(200, { data: { csrfToken: `token-${csrfFetches}` } });
    }
    uploads += 1;
    assert.equal(options.body, file);
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Content-Type'), 'image/jpeg');
    assert.equal(headers.get('X-Account-Id'), accountId);
    assert.equal(headers.get('Idempotency-Key'), uploadKey);
    return response(403, { error: { code: 'CSRF_REJECTED', message: 'Still rejected.' } });
  });
  await assert.rejects(api.uploadImage(file, accountId, uploadKey), (error) => error.status === 403 && error.code === 'CSRF_REJECTED');
  assert.equal(uploads, 2);
  assert.equal(csrfFetches, 2);
});
