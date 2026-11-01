import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const alice = '507f1f77bcf86cd799439011';
const bob = '507f1f77bcf86cd799439012';
let moduleVersion = 0;

async function client(t, fetchHandler) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  globalThis.fetch = fetchHandler;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  // The browser module has no imports. Supply only Vite's public env object;
  // exercise its real request, retry and account-change logic unchanged.
  const source = (await readFile(new URL('../../frontend/src/services/api.js', import.meta.url), 'utf8'))
    .replaceAll('import.meta.env', '({})');
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleVersion++}`);
  return { ...api, events };
}

function response(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('a fresh CSRF token never retargets an old profile form to the current cookie account', async (t) => {
  let mutations = 0;
  let accountEvents = 0;
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) return response(200, { data: { csrfToken: 'bob-token' } });
    mutations += 1;
    assert.equal(new Headers(options.headers).get('X-Account-Id'), alice);
    assert.equal(options.accountId, undefined);
    return response(409, { error: { code: 'ACCOUNT_CHANGED', message: 'Review the current account.' } });
  });
  api.events.addEventListener('gather:account-changed', () => { accountEvents += 1; });
  await assert.rejects(api.apiRequest('me/profile', {
    method: 'PATCH', accountId: alice, body: { displayName: 'Alice edit' },
  }), (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
  assert.equal(mutations, 1);
  assert.equal(accountEvents, 1);
});

test('CSRF recovery preserves the original account precondition and stops after account change', async (t) => {
  let currentAccount = alice;
  let profileAttempts = 0;
  let writesToBob = 0;
  let csrfFetches = 0;
  const api = await client(t, async (url, options) => {
    if (url.endsWith('/auth/csrf')) {
      csrfFetches += 1;
      return response(200, { data: { csrfToken: `${currentAccount}-token` } });
    }
    if (url.endsWith('/fixture')) return response(200, { data: {} });
    profileAttempts += 1;
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Account-Id'), alice);
    if (headers.get('X-CSRF-Token') !== `${currentAccount}-token`) {
      return response(403, { error: { code: 'CSRF_REJECTED', message: 'Refresh token.' } });
    }
    if (headers.get('X-Account-Id') !== currentAccount) {
      return response(409, { error: { code: 'ACCOUNT_CHANGED', message: 'Review account.' } });
    }
    writesToBob += 1;
    return response(200, { data: { id: bob } });
  });
  await api.apiRequest('fixture', { method: 'POST', body: {} });
  currentAccount = bob;
  await assert.rejects(api.apiRequest('me/profile', {
    method: 'PATCH', accountId: alice, body: { displayName: 'Alice edit' },
  }), (error) => error.code === 'ACCOUNT_CHANGED');
  assert.equal(profileAttempts, 2);
  assert.equal(csrfFetches, 2);
  assert.equal(writesToBob, 0);
});

test('a protected response for another identity is rejected instead of being applied to the form', async (t) => {
  let changed = 0;
  const api = await client(t, async (url) => url.endsWith('/auth/csrf')
    ? response(200, { data: { csrfToken: 'token' } })
    : response(200, { data: { id: bob, displayName: 'Bob' } }));
  api.events.addEventListener('gather:account-changed', () => { changed += 1; });
  await assert.rejects(api.apiRequest('me/profile', { method: 'PATCH', accountId: alice, body: {} }),
    (error) => error.code === 'ACCOUNT_CHANGED');
  assert.equal(changed, 1);
});

test('session-ended events identify the request account so late failures cannot sign out a newer account', async (t) => {
  let requestAccount;
  const api = await client(t, async (url) => url.endsWith('/auth/csrf')
    ? response(200, { data: { csrfToken: 'token' } })
    : response(401, { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } }));
  api.events.addEventListener('gather:session-ended', (event) => { requestAccount = event.detail.accountId; });
  await assert.rejects(api.apiRequest('me/profile', { method: 'PATCH', accountId: alice, body: {} }),
    (error) => error.status === 401);
  assert.equal(requestAccount, alice);
});

test('aborted account checks do not emit session-ended events after a new login', async (t) => {
  const controller = new AbortController();
  let ended = 0;
  const api = await client(t, async () => {
    controller.abort();
    return response(401, { error: { code: 'AUTH_REQUIRED', message: 'Old response.' } });
  });
  api.events.addEventListener('gather:session-ended', () => { ended += 1; });
  await assert.rejects(api.apiRequest('me', { signal: controller.signal }));
  assert.equal(ended, 0);
});
