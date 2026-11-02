import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/shared/http-error.js';

const origin = 'http://localhost:5173';
const member = {
  id: '507f1f77bcf86cd799439011', displayName: 'Post Member', username: 'post_member',
  email: 'member@example.com', visibility: 'public', status: 'active', createdAt: new Date().toISOString(),
};
const sessionToken = 'test-post-session';
const assetId = '507f1f77bcf86cd799439012';
const postId = '507f1f77bcf86cd799439013';
const samplePost = {
  id: postId, author: { id: member.id, username: member.username, displayName: member.displayName },
  caption: 'A published moment', hashtags: ['moments'],
  media: [{ assetId, altText: 'A small image', contentUrl: `/api/v1/media/${assetId}/content`, width: 2, height: 2 }],
  version: 0, canManage: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), commentsEnabled: true,
};

async function serve(t, { active = true } = {}) {
  const calls = [];
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#789b83' } }).webp().toBuffer();
  const postService = {
    async assertCanUpload(viewer, key) { calls.push(['assertCanUpload', viewer, key]); },
    async uploadImage(viewer, input) {
      calls.push(['uploadImage', viewer, input]);
      return { id: assetId, status: 'ready', contentUrl: `/api/v1/media/${assetId}/content`, width: input.width, height: input.height, sizeBytes: input.data.length };
    },
    async removeUpload(viewer, id) { calls.push(['removeUpload', viewer, id]); },
    async getImage(viewer, id) { calls.push(['getImage', viewer, id]); return { data: image, contentType: 'image/webp', sizeBytes: image.length }; },
    async publish(viewer, input, key) { calls.push(['publish', viewer, input, key]); return { post: samplePost, replayed: key === '11111111-1111-4111-8111-111111111111' }; },
    async getPost(viewer, id) { calls.push(['getPost', viewer, id]); return samplePost; },
    async listRecent(viewer, query) { calls.push(['listRecent', viewer, query]); return { items: [samplePost], nextCursor: 'opaque-next', hasMore: true }; },
    async listOwn(viewer, query) { calls.push(['listOwn', viewer, query]); return { items: [samplePost], nextCursor: null, hasMore: false }; },
    async updatePost(viewer, id, input) { calls.push(['updatePost', viewer, id, input]); return { ...samplePost, caption: input.caption, version: 1 }; },
    async deletePost(viewer, id) { calls.push(['deletePost', viewer, id]); },
  };
  const authService = {
    async resolveSession(token) {
      if (token !== sessionToken) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      return { user: { ...member, status: active ? 'active' : 'suspended' }, sessionId: 'session' };
    },
  };
  const server = createServer(createApp({
    database: { isAvailable: async () => true }, authService, postService,
    config: { nodeEnv: 'test', appOrigin: origin, authSecret: 'c'.repeat(64) },
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const cookies = new Map([['__Host-session', sessionToken]]);
  return {
    calls, image,
    async request(path, { method = 'GET', body, rawBody, headers = {}, anonymous = false } = {}) {
      const requestHeaders = { ...headers };
      if (!anonymous) requestHeaders.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const response = await fetch(`${base}${path}`, { method, headers: requestHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
      if (!anonymous) for (const value of response.headers.getSetCookie()) {
        const [pair] = value.split(';'); const separator = pair.indexOf('=');
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    },
    async mutationHeaders(extra = {}) {
      const response = await this.request('/auth/csrf');
      assert.equal(response.status, 200);
      const payload = await response.json();
      return { Origin: origin, 'X-App-Request': 'web', 'X-CSRF-Token': payload.data.csrfToken, 'X-Account-Id': member.id, ...extra };
    },
  };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const payload = await response.json();
  assert.equal(payload.error.code, code);
  assert.equal(payload.meta.requestId, response.headers.get('X-Request-Id'));
  assert.equal(payload.error.stack, undefined);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return payload;
}

test('binary upload validates and re-encodes an image without expanding the JSON API limit', async (t) => {
  const client = await serve(t);
  const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#b9c8b1' } }).png().toBuffer();
  const key = randomUUID();
  const response = await client.request('/media/uploads', {
    method: 'POST', rawBody: input,
    headers: await client.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': key }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.id, assetId);
  assert.equal(payload.data.status, 'ready');
  assert.equal(client.calls.find(([name]) => name === 'assertCanUpload')[2], key);
  const upload = client.calls.find(([name]) => name === 'uploadImage');
  assert.ok(upload);
  assert.equal(upload[1].id, member.id);
  assert.equal(upload[2].uploadKey, key);
  assert.equal(upload[2].contentType, 'image/webp');
  assert.equal(upload[2].width, 3);
  assert.equal(upload[2].height, 2);
  assert.ok(Buffer.isBuffer(upload[2].data));
  assert.equal((await sharp(upload[2].data).metadata()).format, 'webp');
  assert.equal(payload.data.data, undefined);
  assert.equal(payload.meta.requestId, response.headers.get('X-Request-Id'));

  const tooLargeJson = await client.request('/posts', {
    method: 'POST', body: { caption: 'x'.repeat(33 * 1024) },
    headers: await client.mutationHeaders({ 'Idempotency-Key': randomUUID() }),
  });
  await expectError(tooLargeJson, 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(client.calls.filter(([name]) => name === 'publish').length, 0);
});

test('upload checks CSRF, active identity and account ownership before image processing', async (t) => {
  const client = await serve(t);
  await expectError(await client.request('/media/uploads', {
    method: 'POST', rawBody: Buffer.from('invalid'),
    headers: { 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID() },
  }), 403, 'CSRF_REJECTED');
  await expectError(await client.request('/media/uploads', {
    method: 'POST', rawBody: Buffer.from('invalid'),
    headers: await client.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID(), 'X-Account-Id': '507f1f77bcf86cd799439099' }),
  }), 409, 'ACCOUNT_CHANGED');
  assert.equal(client.calls.filter(([name]) => name === 'uploadImage').length, 0);

  const suspended = await serve(t, { active: false });
  await expectError(await suspended.request('/media/uploads', {
    method: 'POST', rawBody: Buffer.from('invalid'),
    headers: await suspended.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID() }),
  }), 403, 'ACCOUNT_RESTRICTED');
  assert.equal(suspended.calls.filter(([name]) => name === 'uploadImage').length, 0);
});

test('upload rejects unsupported encoding, missing retry key and oversized binary data safely', async (t) => {
  const client = await serve(t);
  const baseHeaders = { 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID() };
  await expectError(await client.request('/media/uploads', {
    method: 'POST', rawBody: client.image,
    headers: await client.mutationHeaders({ ...baseHeaders, 'Content-Encoding': 'gzip' }),
  }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  await expectError(await client.request('/media/uploads', {
    method: 'POST', rawBody: client.image,
    headers: await client.mutationHeaders({ 'Content-Type': 'image/png' }),
  }), 422, 'VALIDATION_ERROR');
  await expectError(await client.request('/media/uploads', {
    method: 'POST', rawBody: Buffer.alloc(5 * 1024 * 1024 + 1),
    headers: await client.mutationHeaders(baseHeaders),
  }), 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(client.calls.filter(([name]) => name === 'uploadImage').length, 0);
});

test('upload rejects malformed or mismatched bytes instead of trusting the declared type', async (t) => {
  const client = await serve(t);
  for (const rawBody of [Buffer.from('not an image'), client.image]) {
    await expectError(await client.request('/media/uploads', {
      method: 'POST', rawBody,
      headers: await client.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID() }),
    }), 422, 'INVALID_IMAGE');
  }
  assert.equal(client.calls.filter(([name]) => name === 'uploadImage').length, 0);
});

test('published media delivery authenticates before returning verified image bytes', async (t) => {
  const client = await serve(t);
  await expectError(await client.request(`/media/${assetId}/content`, { anonymous: true }), 401, 'AUTH_REQUIRED');
  assert.equal(client.calls.filter(([name]) => name === 'getImage').length, 0);
  const response = await client.request(`/media/${assetId}/content`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/webp');
  assert.equal(Number(response.headers.get('Content-Length')), client.image.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), client.image);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('post routes return request envelopes, pagination and idempotent publication semantics', async (t) => {
  const client = await serve(t);
  const input = { caption: 'A published moment', hashtags: ['moments'], media: [{ assetId, altText: 'A small image' }] };
  for (const [key, status] of [[randomUUID(), 201], ['11111111-1111-4111-8111-111111111111', 200]]) {
    const response = await client.request('/posts', { method: 'POST', body: input, headers: await client.mutationHeaders({ 'Idempotency-Key': key }) });
    assert.equal(response.status, status);
    assert.deepEqual((await response.json()).data, samplePost);
    if (status === 200) assert.equal(response.headers.get('Idempotency-Replayed'), 'true');
  }
  const recent = await client.request('/posts/recent?limit=2');
  assert.equal(recent.status, 200);
  const page = await recent.json();
  assert.deepEqual(page.data, [samplePost]);
  assert.equal(page.meta.nextCursor, 'opaque-next');
  assert.equal(page.meta.hasMore, true);
  assert.equal(page.meta.requestId, recent.headers.get('X-Request-Id'));
  const own = await client.request('/me/posts');
  assert.equal(own.status, 200);
  assert.equal((await own.json()).meta.hasMore, false);
  assert.equal((await client.request(`/posts/${postId}`)).status, 200);
});

test('post modifications require account preconditions and delegate versioned edits and deletion', async (t) => {
  const client = await serve(t);
  const edit = { expectedVersion: 0, caption: 'Edited caption' };
  const wrongAccountHeaders = await client.mutationHeaders({ 'X-Account-Id': '507f1f77bcf86cd799439099' });
  await expectError(await client.request(`/posts/${postId}`, { method: 'PATCH', body: edit, headers: wrongAccountHeaders }), 409, 'ACCOUNT_CHANGED');
  assert.equal(client.calls.filter(([name]) => name === 'updatePost').length, 0);
  const response = await client.request(`/posts/${postId}`, { method: 'PATCH', body: edit, headers: await client.mutationHeaders() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.version, 1);
  const removed = await client.request(`/posts/${postId}`, {
    method: 'DELETE', headers: await client.mutationHeaders({ 'Content-Type': 'application/json' }),
  });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), '');
  assert.ok(client.calls.some(([name]) => name === 'deletePost'));
});
