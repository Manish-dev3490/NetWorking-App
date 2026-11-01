import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { createAuthSecurity } from '../src/middleware/auth-security.js';
import { errorHandler } from '../src/middleware/error-handler.js';

const config = { nodeEnv: 'test', appOrigin: 'http://localhost:5173', authSecret: 'b'.repeat(64) };
const member = { id: '507f1f77bcf86cd799439011', displayName: 'Member' };

async function serve(t, { now } = {}) {
  const writes = [];
  let app;
  if (now) {
    // The clock is injectable at the security middleware boundary.
    app = express();
    app.use(express.json(), createAuthSecurity({ config, now }));
    app.post('/save', (req, res) => res.json({ data: {} }));
    app.use(errorHandler);
  } else {
    app = createApp({
      database: { isAvailable: async () => true }, config,
      authService: {
        async resolveSession() { return { user: member, sessionId: 'session' }; },
        async updateProfile(token, input) { writes.push(input); return { ...member, ...input }; },
      },
    });
  }
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}${now ? '' : '/api/v1'}`;
  const cookies = new Map([['__Host-session', 'same-browser-session']]);
  const cookieHeader = () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  function apply(response) {
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';');
      const separator = pair.indexOf('=');
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  return {
    cookies, writes, apply,
    async bootstrap({ snapshot = cookieHeader(), applyCookie = true } = {}) {
      const response = await fetch(`${base}/auth/csrf`, { headers: { Cookie: snapshot } });
      assert.equal(response.status, 200);
      if (applyCookie) apply(response);
      return { response, token: (await response.json()).data.csrfToken };
    },
    async save(token, name = 'Updated member') {
      return fetch(`${base}${now ? '/save' : '/me/profile'}`, {
        method: now ? 'POST' : 'PATCH',
        headers: {
          Cookie: cookieHeader(), Origin: config.appOrigin, 'X-App-Request': 'web',
          'X-CSRF-Token': token, 'X-Account-Id': member.id, 'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: name }),
      });
    },
  };
}

test('a second tab reuses the current valid CSRF token without replacing its cookie', async (t) => {
  const browser = await serve(t);
  const first = await browser.bootstrap();
  const second = await browser.bootstrap();
  assert.ok(second.token === first.token, 'a valid shared token should be reused');
  assert.deepEqual(second.response.headers.getSetCookie(), []);
  assert.equal((await browser.save(first.token)).status, 200);
});

test('interleaved stale-tab recovery converges instead of invalidating the other tab retry', async (t) => {
  const browser = await serve(t);
  const first = await browser.bootstrap();
  browser.cookies.delete('__Host-csrf');
  const second = await browser.bootstrap();
  browser.cookies.delete('__Host-csrf');
  const current = await browser.bootstrap();
  assert.equal((await browser.save(first.token)).status, 403);
  assert.equal((await browser.save(second.token)).status, 403);
  const refreshedA = await browser.bootstrap();
  const refreshedB = await browser.bootstrap();
  assert.ok(refreshedA.token === current.token, 'tab A should recover the current shared token');
  assert.ok(refreshedB.token === current.token, 'tab B should recover the current shared token');
  assert.equal((await browser.save(refreshedA.token, 'Tab A')).status, 200);
  assert.equal((await browser.save(refreshedB.token, 'Tab B')).status, 200);
  assert.equal(browser.writes.length, 2);
});

test('racing first bootstraps converge on the established cookie during recovery', async (t) => {
  const browser = await serve(t);
  const snapshot = '__Host-session=same-browser-session';
  const [first, second] = await Promise.all([
    browser.bootstrap({ snapshot, applyCookie: false }),
    browser.bootstrap({ snapshot, applyCookie: false }),
  ]);
  browser.apply(first.response);
  browser.apply(second.response);
  assert.equal((await browser.save(first.token)).status, 403);
  const refreshA = await browser.bootstrap();
  const refreshB = await browser.bootstrap();
  assert.ok(refreshA.token === second.token, 'tab A should converge on the established cookie');
  assert.ok(refreshB.token === second.token, 'tab B should converge on the established cookie');
  assert.equal((await browser.save(refreshA.token)).status, 200);
  assert.equal((await browser.save(refreshB.token)).status, 200);
});

test('tampered, expired, future-dated and other-session cookies are replaced rather than reused', async (t) => {
  let time = Date.now();
  const browser = await serve(t, { now: () => time });
  let previous = await browser.bootstrap();
  const tampered = `${previous.token.slice(0, -1)}${previous.token.endsWith('0') ? '1' : '0'}`;
  browser.cookies.set('__Host-csrf', tampered);
  let next = await browser.bootstrap();
  assert.ok(next.token !== tampered, 'tampered tokens should be replaced');
  assert.equal((await browser.save(tampered)).status, 403);

  previous = next;
  time += (2 * 60 * 60 + 1) * 1000;
  next = await browser.bootstrap();
  assert.ok(next.token !== previous.token, 'expired tokens should be replaced');
  assert.equal((await browser.save(previous.token)).status, 403);

  previous = next;
  time -= 31 * 1000;
  next = await browser.bootstrap();
  assert.ok(next.token !== previous.token, 'future-dated tokens should be replaced');
  assert.equal((await browser.save(previous.token)).status, 403);

  previous = next;
  browser.cookies.set('__Host-session', 'a-different-session');
  next = await browser.bootstrap();
  assert.ok(next.token !== previous.token, 'another session should receive a new token');
  assert.equal((await browser.save(previous.token)).status, 403);
  assert.equal((await browser.save(next.token)).status, 200);
});
