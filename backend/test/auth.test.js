import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/shared/http-error.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';
import { validateLogin, validateProfile, validateRegistration } from '../src/modules/auth/validation.js';

const appOrigin = 'http://localhost:5173';
const sessionToken = 'session-test-token-'.padEnd(64, 'a');
const member = {
  id: '507f1f77bcf86cd799439011',
  email: 'member@example.com',
  username: 'member',
  displayName: 'Gather Member',
  bio: '',
  visibility: 'public',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const signup = {
  displayName: member.displayName,
  username: member.username,
  email: member.email,
  password: 'a strong sample password',
};

function fakeAuthService(overrides = {}) {
  const calls = [];
  const signedIn = () => ({
    user: member,
    token: sessionToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  let revoked = false;
  return {
    calls,
    async register(input) { calls.push(['register', input]); return signedIn(); },
    async login(input) { calls.push(['login', input]); return signedIn(); },
    async resolveSession(token) {
      calls.push(['resolveSession', token]);
      if (token !== sessionToken || revoked) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      return { user: member, sessionId: '507f1f77bcf86cd799439012' };
    },
    async updateProfile(token, input, expectedAccountId) {
      await this.resolveSession(token);
      if (expectedAccountId !== member.id) throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account has changed.');
      calls.push(['updateProfile', token, input]);
      return { ...member, ...input };
    },
    async logout(token, expectedAccountId) {
      if (token === sessionToken && !revoked && expectedAccountId !== undefined && expectedAccountId !== member.id) {
        throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account has changed.');
      }
      calls.push(['logout', token]); if (token === sessionToken) revoked = true;
    },
    ...overrides,
  };
}

async function serve(t, authService = fakeAuthService()) {
  const server = createServer(createApp({
    database: { isAvailable: async () => true },
    authService,
    config: { nodeEnv: 'test', appOrigin, authSecret: 'a'.repeat(64) },
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const cookies = new Map();
  const client = {
    authService,
    cookies,
    async request(path, { method = 'GET', body, headers = {}, cookie = true } = {}) {
      const requestHeaders = { ...headers };
      if (cookie && cookies.size) requestHeaders.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const response = await fetch(`${base}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const value of response.headers.getSetCookie()) {
        const [pair] = value.split(';');
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        const content = pair.slice(separator + 1);
        if (content) cookies.set(name, content); else cookies.delete(name);
      }
      return response;
    },
    async csrf() {
      const response = await this.request('/auth/csrf');
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(typeof payload.data.csrfToken, 'string');
      return payload.data.csrfToken;
    },
    async mutate(path, body, { method = 'POST', headers = {} } = {}) {
      const csrfToken = await this.csrf();
      return this.request(path, {
        method,
        body,
        headers: { Origin: appOrigin, 'X-App-Request': 'web', 'X-CSRF-Token': csrfToken, 'X-Account-Id': member.id, 'Content-Type': 'application/json', ...headers },
      });
    },
  };
  return client;
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

test('CSRF bootstrap returns a token in a private response and a secure host-only cookie', async (t) => {
  const client = await serve(t);
  const response = await client.request('/auth/csrf');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.data.csrfToken.length >= 32);
  assert.equal(payload.meta.requestId, response.headers.get('X-Request-Id'));
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-csrf='));
  assert.ok(cookie);
  assert.match(cookie, /;\s*Secure(?:;|$)/i);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
  assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
  assert.doesNotMatch(cookie, /;\s*Domain=/i);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

for (const scenario of ['missing origin', 'foreign origin', 'missing app header', 'missing token', 'mismatched token', 'missing cookie']) {
  test(`signup rejects ${scenario} before account creation`, async (t) => {
    const client = await serve(t);
    const csrfToken = await client.csrf();
    const headers = { Origin: appOrigin, 'X-App-Request': 'web', 'X-CSRF-Token': csrfToken };
    if (scenario === 'missing origin') delete headers.Origin;
    if (scenario === 'foreign origin') headers.Origin = 'https://untrusted.example';
    if (scenario === 'missing app header') delete headers['X-App-Request'];
    if (scenario === 'missing token') delete headers['X-CSRF-Token'];
    if (scenario === 'mismatched token') headers['X-CSRF-Token'] = `${csrfToken}tampered`;
    const response = await client.request('/auth/register', {
      method: 'POST', body: signup, headers, cookie: scenario !== 'missing cookie',
    });
    await expectError(response, 403, 'CSRF_REJECTED');
    assert.equal(client.authService.calls.filter(([name]) => name === 'register').length, 0);
  });
}

test('signup immediately signs in an active member without exposing the session token in JSON', async (t) => {
  const client = await serve(t);
  const response = await client.mutate('/auth/register', signup);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.deepEqual(payload.data, member);
  assert.equal(payload.meta.requestId, response.headers.get('X-Request-Id'));
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(sessionToken));
  assert.equal(payload.data.passwordHash, undefined);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-session='));
  assert.ok(cookie);
  assert.match(cookie, /;\s*Secure(?:;|$)/i);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
  assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
  assert.doesNotMatch(cookie, /;\s*Domain=/i);
  const restored = await client.request('/me');
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).data, member);
});

test('login, profile editing, session restore and logout use the same server session', async (t) => {
  const client = await serve(t);
  const login = await client.mutate('/auth/login', { email: member.email, password: signup.password });
  assert.equal(login.status, 200);
  const profile = await client.mutate('/me/profile', { displayName: 'Updated Member', bio: 'A new introduction.' }, { method: 'PATCH' });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).data.displayName, 'Updated Member');
  assert.ok(client.authService.calls.some(([name, token]) => name === 'updateProfile' && token === sessionToken));
  const logout = await client.mutate('/auth/logout');
  assert.equal(logout.status, 204);
  assert.equal(await logout.text(), '');
  assert.ok(logout.headers.getSetCookie().some((value) => value.startsWith('__Host-session=;')));
  await expectError(await client.request('/me'), 401, 'AUTH_REQUIRED');
  assert.equal((await client.mutate('/auth/logout')).status, 204);
});

test('an anonymous CSRF token cannot be reused after a session cookie changes', async (t) => {
  const client = await serve(t);
  const anonymousToken = await client.csrf();
  client.cookies.set('__Host-session', sessionToken);
  await expectError(await client.request('/auth/logout', {
    method: 'POST',
    headers: { Origin: appOrigin, 'X-App-Request': 'web', 'X-CSRF-Token': anonymousToken, 'Content-Type': 'application/json' },
  }), 403, 'CSRF_REJECTED');
  assert.equal(client.authService.calls.filter(([name]) => name === 'logout').length, 0);
});

test('profile and logout routes preserve the form account precondition', async (t) => {
  const client = await serve(t);
  assert.equal((await client.mutate('/auth/login', { email: member.email, password: signup.password })).status, 200);
  const otherId = '507f1f77bcf86cd799439099';
  await expectError(await client.mutate('/me/profile', { displayName: 'Wrong account edit' }, {
    method: 'PATCH', headers: { 'X-Account-Id': otherId },
  }), 409, 'ACCOUNT_CHANGED');
  const csrf = await client.csrf();
  await expectError(await client.request('/me/profile', {
    method: 'PATCH', body: { displayName: 'Unbound edit' },
    headers: { Origin: appOrigin, 'X-App-Request': 'web', 'X-CSRF-Token': csrf },
  }), 409, 'ACCOUNT_CHANGED');
  assert.equal(client.authService.calls.filter(([name]) => name === 'updateProfile').length, 0);
  await expectError(await client.mutate('/auth/logout', undefined, {
    headers: { 'X-Account-Id': otherId },
  }), 409, 'ACCOUNT_CHANGED');
  assert.equal((await client.request('/me')).status, 200);
});

test('matching forged CSRF cookie and header still fail signature validation', async (t) => {
  const client = await serve(t);
  const forged = `${Math.floor(Date.now() / 1000)}.${'b'.repeat(64)}.${'0'.repeat(64)}`;
  client.cookies.set('__Host-csrf', forged);
  await expectError(await client.request('/auth/register', {
    method: 'POST', body: signup,
    headers: { Origin: appOrigin, 'X-App-Request': 'web', 'X-CSRF-Token': forged },
  }), 403, 'CSRF_REJECTED');
  assert.equal(client.authService.calls.filter(([name]) => name === 'register').length, 0);
});

test('signup rate limiting rejects excess attempts before password work and includes retry information', async (t) => {
  const client = await serve(t);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await client.mutate('/auth/register', signup)).status, 201);
  }
  const response = await client.mutate('/auth/register', signup);
  await expectError(response, 429, 'RATE_LIMITED');
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal(client.authService.calls.filter(([name]) => name === 'register').length, 10);
});

test('case and trailing-slash signup aliases share the registration IP limit', async (t) => {
  const client = await serve(t);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await client.mutate('/auth/register', signup)).status, 201);
  }
  for (const path of ['/AUTH/REGISTER', '/auth/register/', '/AUTH/REGISTER/']) {
    await expectError(await client.mutate(path, signup), 429, 'RATE_LIMITED');
  }
  assert.equal(client.authService.calls.filter(([name]) => name === 'register').length, 10);
});

test('case and trailing-slash login aliases share the per-identity limit', async (t) => {
  const client = await serve(t);
  const input = { email: member.email, password: signup.password };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await client.mutate('/auth/login', input)).status, 200);
  }
  for (const path of ['/AUTH/LOGIN', '/auth/login/', '/AUTH/LOGIN/']) {
    await expectError(await client.mutate(path, input), 429, 'RATE_LIMITED');
  }
  assert.equal(client.authService.calls.filter(([name]) => name === 'login').length, 10);
});

test('canonically equivalent Unicode emails share the login identity limit', async (t) => {
  const client = await serve(t);
  const composed = { email: 'mémber@example.com', password: signup.password };
  const decomposed = { email: 'me\u0301mber@example.com', password: signup.password };
  assert.equal(validateLogin(composed).email, validateLogin(decomposed).email);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await client.mutate('/auth/login', composed)).status, 200);
  }
  await expectError(await client.mutate('/auth/login', decomposed), 429, 'RATE_LIMITED');
  assert.equal(client.authService.calls.filter(([name]) => name === 'login').length, 10);
});

test('anonymous identity reads require authentication', async (t) => {
  const client = await serve(t);
  await expectError(await client.request('/me'), 401, 'AUTH_REQUIRED');
});

test('safe field validation errors retain their field codes and request ID', async (t) => {
  const error = new HttpError(422, 'VALIDATION_ERROR', 'Check the account details.');
  error.fields = [{ path: 'username', code: 'INVALID' }];
  const client = await serve(t, fakeAuthService({ async register() { throw error; } }));
  const payload = await expectError(await client.mutate('/auth/register', signup), 422, 'VALIDATION_ERROR');
  assert.deepEqual(payload.error.fields, error.fields);
  assert.equal(payload.error.password, undefined);
});

test('registration validation normalizes identities while preserving email aliases and password bytes', () => {
  const password = '  a long e\u0301 password 🦊  ';
  const validated = validateRegistration({
    email: ' First.Last+tag@EXAMPLE.COM ', username: ' Mixed_Case ', displayName: ' Member ', password,
  });
  assert.equal(validated.email, 'first.last+tag@example.com');
  assert.equal(validated.username, 'mixed_case');
  assert.equal(validated.displayName, 'Member');
  assert.equal(validated.password, password);
  assert.equal(validateLogin({ email: 'member@example.com', password: 'x' }).password, 'x');
});

test('account validation rejects protected fields, MongoDB operators and reserved usernames', () => {
  for (const input of [
    { ...signup, role: 'admin' }, { ...signup, status: 'active' },
    { ...signup, username: 'admin' }, { ...signup, username: { $ne: null } },
    { ...signup, $set: { role: 'admin' } },
  ]) {
    assert.throws(() => validateRegistration(input), (error) => error.status === 422 && error.code === 'VALIDATION_ERROR');
  }
  assert.throws(() => validateProfile({ userId: member.id, displayName: 'Someone Else' }),
    (error) => error.status === 422 && error.code === 'VALIDATION_ERROR');
  assert.throws(() => validateProfile({}), (error) => error.status === 422);
});

test('signup password and profile limits count Unicode characters without truncation', () => {
  assert.equal(validateRegistration({ ...signup, password: '🦊'.repeat(128) }).password.length, 256);
  assert.throws(() => validateRegistration({ ...signup, password: '🦊'.repeat(129) }), (error) => error.status === 422);
  assert.throws(() => validateRegistration({ ...signup, password: 'short password' }), (error) => error.status === 422);
  assert.equal(validateProfile({ bio: '🦊'.repeat(160) }).bio.length, 320);
  assert.throws(() => validateProfile({ bio: '🦊'.repeat(161) }), (error) => error.status === 422);
});

test('password hashing uses random salts and preserves exact whitespace and Unicode', async () => {
  const password = '  a long e\u0301 password 🦊  ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword(password.normalize('NFC'), first), false);
});
