import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService, hashToken } from '../src/modules/auth/service.js';

function fixture() {
  const aliceId = '507f1f77bcf86cd799439011';
  const bobId = '507f1f77bcf86cd799439012';
  const token = 'b'.repeat(43);
  const bob = {
    _id: bobId, emailNormalized: 'bob@example.com', usernameNormalized: 'bob', displayName: 'Bob',
    status: 'active', authVersion: 0, visibility: 'public', bio: '', createdAt: new Date(),
  };
  let session = { _id: '507f1f77bcf86cd799439013', userId: bobId, authVersion: 0, expiresAt: new Date(Date.now() + 60_000) };
  const writes = [];
  const auth = createAuthService({ repository: {
    findSession: async (hash) => hash === hashToken(token) ? session : null,
    findUser: async (id) => id === bobId ? bob : null,
    updateProfile: async (id, version, fields) => {
      writes.push({ id, version, fields });
      Object.assign(bob, fields);
      return bob;
    },
    deleteSession: async () => { writes.push({ deletedSession: true }); session = null; },
  } });
  return { auth, token, aliceId, bobId, bob, writes };
}

test('stale profile forms cannot write another signed-in account, even with a new CSRF token', async () => {
  const { auth, token, aliceId, bobId, bob, writes } = fixture();
  for (const expectedId of [aliceId, undefined, '', 'not-an-account']) {
    await assert.rejects(auth.updateProfile(token, {
      displayName: 'Alice edits', username: 'new_alice_handle', bio: 'Alice draft',
    }, expectedId), (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
  }
  assert.deepEqual(writes, []);
  assert.equal(bob.displayName, 'Bob');
  const updated = await auth.updateProfile(token, { displayName: 'Updated Bob' }, bobId);
  assert.equal(updated.id, bobId);
  assert.equal(updated.displayName, 'Updated Bob');
  assert.equal(writes.length, 1);
});

test('a stale logout cannot revoke another account and matching logout stays idempotent', async () => {
  const { auth, token, aliceId, bobId, writes } = fixture();
  await assert.rejects(auth.logout(token, aliceId), (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
  assert.deepEqual(writes, []);
  assert.equal((await auth.resolveSession(token)).user.id, bobId);
  await auth.logout(token, bobId);
  await assert.rejects(auth.resolveSession(token), (error) => error.status === 401);
  await auth.logout(token, bobId);
  await auth.logout(undefined, bobId);
});
