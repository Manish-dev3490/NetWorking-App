import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/shared/http-error.js';

const origin = 'http://localhost:5173';
const member = { id: '507f1f77bcf86cd799439011', username: 'network_member', displayName: 'Network Member', status: 'active', visibility: 'public' };
const targetId = '507f1f77bcf86cd799439012';
const assetId = '507f1f77bcf86cd799439013';
const token = 'network-test-session';
const summary = { id: targetId, username: 'another_member', displayName: 'Another Member', avatarUrl: null, visibility: 'private' };
const profile = { ...summary, isSelf: false, canViewContent: false, relationship: { followingStatus: 'none', followedBy: false } };
const samplePost = { id: '507f1f77bcf86cd799439014', author: summary, caption: 'A followed moment', hashtags: [], media: [] };

async function serve(t, { active = true } = {}) {
  const calls = [];
  const page = (items) => ({ items, nextCursor: 'next-network-page', hasMore: true });
  const networkService = {
    async getProfile(viewer, id) { calls.push(['getProfile', viewer.id, id]); return profile; },
    async searchUsers(viewer, query) { calls.push(['searchUsers', viewer.id, query]); return page([summary]); },
    async listFollowers(viewer, id, query) { calls.push(['listFollowers', viewer.id, id, query]); return page([summary]); },
    async listFollowing(viewer, id, query) { calls.push(['listFollowing', viewer.id, id, query]); return page([summary]); },
    async follow(viewer, id) { calls.push(['follow', viewer.id, id]); return { userId: id, status: 'pending' }; },
    async unfollow(viewer, id) { calls.push(['unfollow', viewer.id, id]); },
    async listRequests(viewer, query) { calls.push(['listRequests', viewer.id, query]); return page([{ id: 'request-id', follower: summary, createdAt: new Date().toISOString() }]); },
    async acceptRequest(viewer, id) { calls.push(['acceptRequest', viewer.id, id]); return { userId: id, status: 'accepted' }; },
    async rejectRequest(viewer, id) { calls.push(['rejectRequest', viewer.id, id]); },
    async removeFollower(viewer, id) { calls.push(['removeFollower', viewer.id, id]); },
  };
  const postService = {
    async listFollowing(viewer, query) { calls.push(['listFollowingPosts', viewer.id, query]); return page([samplePost]); },
    async listUser(viewer, id, query) { calls.push(['listUserPosts', viewer.id, id, query]); return page([samplePost]); },
    async getPost(viewer, id) { calls.push(['getPost', viewer.id, id]); return samplePost; },
    async assertCanUpload(viewer, key, purpose) { calls.push(['assertCanUpload', viewer.id, key, purpose]); },
    async uploadImage(viewer, input) {
      calls.push(['uploadImage', viewer.id, input]);
      return { id: assetId, status: 'ready', contentUrl: `/api/v1/media/${assetId}/content`, width: input.width, height: input.height, sizeBytes: input.data.length };
    },
  };
  const notificationService = {
    async list(viewer, query) {
      calls.push(['listNotifications', viewer.id, query]);
      return { ...page([{ id: assetId, type: 'follow', actor: summary, readAt: null }]), unreadCount: 2 };
    },
    async unreadCount(viewer) { calls.push(['unreadNotifications', viewer.id]); return { unreadCount: 2 }; },
    async markRead(viewer, id) { calls.push(['readNotification', viewer.id, id]); return { unreadCount: 1 }; },
    async markAllRead(viewer) { calls.push(['readAllNotifications', viewer.id]); return { unreadCount: 0 }; },
  };
  const authService = {
    async resolveSession(value) {
      if (value !== token) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      return { user: { ...member, status: active ? 'active' : 'suspended' }, sessionId: 'session' };
    },
  };
  const server = createServer(createApp({
    database: { isAvailable: async () => true }, authService, postService, networkService, notificationService,
    config: { nodeEnv: 'test', appOrigin: origin, authSecret: 'd'.repeat(64) },
  }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const cookies = new Map([['__Host-session', token]]);
  return {
    calls,
    async request(path, { method = 'GET', body, rawBody, headers = {}, anonymous = false } = {}) {
      const requestHeaders = { ...headers };
      if (!anonymous) requestHeaders.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const response = await fetch(`${base}${path}`, { method, headers: requestHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
      if (!anonymous) for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0]; const separator = pair.indexOf('=');
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    },
    async mutationHeaders(extra = {}) {
      const response = await this.request('/auth/csrf');
      assert.equal(response.status, 200);
      const payload = await response.json();
      return { Origin: origin, 'Content-Type': 'application/json', 'X-App-Request': 'web', 'X-CSRF-Token': payload.data.csrfToken, 'X-Account-Id': member.id, ...extra };
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
}

test('notification reads bind the account and mark-as-read writes enforce CSRF', async (t) => {
  const client = await serve(t);
  const account = { 'X-Account-Id': member.id };
  const list = '/notifications?limit=2&cursor=next';
  const single = `/notifications/${assetId}/read`;
  await expectError(await client.request(list, { anonymous: true, headers: account }), 401, 'AUTH_REQUIRED');
  await expectError(await client.request(list, { headers: { 'X-Account-Id': targetId } }), 409, 'ACCOUNT_CHANGED');
  await expectError(await client.request('/notifications/unread-count'), 409, 'ACCOUNT_CHANGED');
  await expectError(await client.request(single, { method: 'PATCH', body: {}, headers: account }), 403, 'CSRF_REJECTED');
  assert.deepEqual(client.calls, []);

  const response = await client.request(list, { headers: account });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data[0].type, 'follow');
  assert.equal(payload.meta.unreadCount, 2);
  assert.equal(payload.meta.nextCursor, 'next-network-page');
  const badge = await client.request('/notifications/unread-count', { headers: account });
  assert.deepEqual((await badge.json()).data, { unreadCount: 2 });
  const headers = await client.mutationHeaders();
  const read = await client.request(single, { method: 'PATCH', headers });
  assert.deepEqual((await read.json()).data, { unreadCount: 1 });
  const all = await client.request('/notifications/read-all', { method: 'PATCH', headers });
  assert.deepEqual((await all.json()).data, { unreadCount: 0 });
  assert.equal(client.calls[0][1], member.id);
  assert.equal(Number(client.calls[0][2].limit), 2);
  assert.deepEqual(client.calls.slice(1), [
    ['unreadNotifications', member.id], ['readNotification', member.id, assetId], ['readAllNotifications', member.id],
  ]);
});

test('member profiles, search and relationship lists are authenticated paginated routes', async (t) => {
  const client = await serve(t);
  await expectError(await client.request(`/users/${targetId}`, { anonymous: true }), 401, 'AUTH_REQUIRED');
  assert.equal(client.calls.length, 0);
  const result = await client.request(`/users/${targetId}`);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).data, profile);
  for (const [path, method] of [
    ['/search/users?q=an&match=displayName&limit=2&cursor=search-page', 'searchUsers'],
    [`/users/${targetId}/followers?limit=2&cursor=followers-page`, 'listFollowers'],
    [`/users/${targetId}/following?limit=2&cursor=following-page`, 'listFollowing'],
    ['/me/follow-requests?limit=2&cursor=requests-page', 'listRequests'],
  ]) {
    const response = await client.request(path);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.meta.nextCursor, 'next-network-page');
    assert.equal(payload.meta.hasMore, true);
    assert.equal(payload.meta.requestId, response.headers.get('X-Request-Id'));
    const call = client.calls.find(([name]) => name === method);
    assert.equal(call[1], member.id);
    assert.equal(Number(call.at(-1).limit), 2);
  }
  assert.equal(client.calls.find(([name]) => name === 'searchUsers').at(-1).q, 'an');
});

test('follow, cancellation and incoming request actions use the session owner and safe empty responses', async (t) => {
  const client = await serve(t);
  const operations = [
    ['PUT', `/me/following/${targetId}`, 'follow', 200],
    ['DELETE', `/me/following/${targetId}`, 'unfollow', 204],
    ['PUT', `/me/follow-requests/${targetId}`, 'acceptRequest', 200],
    ['DELETE', `/me/follow-requests/${targetId}`, 'rejectRequest', 204],
    ['DELETE', `/me/followers/${targetId}`, 'removeFollower', 204],
  ];
  for (const [method, path, action, status] of operations) {
    const response = await client.request(path, { method, headers: await client.mutationHeaders() });
    assert.equal(response.status, status);
    if (status === 204) assert.equal(await response.text(), '');
    else assert.equal((await response.json()).data.userId, targetId);
    assert.deepEqual(client.calls.find(([name]) => name === action), [action, member.id, targetId]);
  }
});

test('relationship writes reject CSRF, stale account identity and unexpected writable fields before service calls', async (t) => {
  const client = await serve(t);
  const path = `/me/following/${targetId}`;
  await expectError(await client.request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }), 403, 'CSRF_REJECTED');
  await expectError(await client.request(path, {
    method: 'PUT', headers: await client.mutationHeaders({ 'X-Account-Id': targetId }),
  }), 409, 'ACCOUNT_CHANGED');
  await expectError(await client.request(path, {
    method: 'PUT', body: { followerId: targetId, status: 'accepted' }, headers: await client.mutationHeaders(),
  }), 422, 'VALIDATION_ERROR');
  assert.equal(client.calls.length, 0);
  const restricted = await serve(t, { active: false });
  await expectError(await restricted.request(`/users/${targetId}`), 403, 'ACCOUNT_RESTRICTED');
  assert.equal(restricted.calls.length, 0);
});

test('Following and member-post routes are distinct from individual post and profile routes', async (t) => {
  const client = await serve(t);
  for (const [path, action] of [
    ['/posts/following?limit=2&cursor=feed-page', 'listFollowingPosts'],
    [`/users/${targetId}/posts?limit=2&cursor=profile-page`, 'listUserPosts'],
  ]) {
    const response = await client.request(path);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.data, [samplePost]);
    assert.equal(payload.meta.nextCursor, 'next-network-page');
    assert.equal(client.calls.find(([name]) => name === action)[1], member.id);
  }
  assert.equal(client.calls.some(([name]) => name === 'getPost' || name === 'getProfile'), false);
});

test('avatar binary uploads preserve purpose and raw-image processing before storage', async (t) => {
  const client = await serve(t);
  const image = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#6b8b70' } }).png().toBuffer();
  const key = randomUUID();
  const response = await client.request('/media/uploads', {
    method: 'POST', rawBody: image,
    headers: await client.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': key, 'X-Media-Purpose': 'avatar' }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.id, assetId);
  assert.deepEqual(client.calls.find(([name]) => name === 'assertCanUpload'), ['assertCanUpload', member.id, key, 'avatar']);
  const stored = client.calls.find(([name]) => name === 'uploadImage')[2];
  assert.equal(stored.purpose, 'avatar');
  assert.equal(stored.contentType, 'image/webp');
  assert.equal((await sharp(stored.data).metadata()).format, 'webp');
  const badPurpose = await client.request('/media/uploads', {
    method: 'POST', rawBody: image,
    headers: await client.mutationHeaders({ 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID(), 'X-Media-Purpose': 'banner' }),
  });
  await expectError(badPurpose, 422, 'VALIDATION_ERROR');
  assert.equal(client.calls.filter(([name]) => name === 'uploadImage').length, 1);
});
