import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import { migrateAuth } from '../src/migrations/001-auth.js';
import { createAuthService } from '../src/modules/auth/service.js';

// The supplied URI is used only to reach the server. Every write targets this
// run's random database, never the database named in TEST_MONGODB_URI.
test('real MongoDB account, profile and session lifecycle', {
  skip: !process.env.TEST_MONGODB_URI && 'Set TEST_MONGODB_URI to run isolated MongoDB auth integration tests.',
  timeout: 120_000,
}, async (t) => {
  const databaseName = `gather_auth_test_${randomBytes(8).toString('hex')}`;
  const connection = mongoose.createConnection();
  t.after(async () => {
    try {
      if (connection.readyState === 1) {
        assert.match(databaseName, /^gather_auth_test_[a-f0-9]{16}$/);
        assert.equal(connection.db.databaseName, databaseName);
        await connection.dropDatabase();
      }
    } finally {
      await connection.close();
    }
  });
  await connection.openUri(process.env.TEST_MONGODB_URI, {
    dbName: databaseName, maxPoolSize: 3, autoCreate: false, autoIndex: false,
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
  });
  await migrateAuth(connection);
  await migrateAuth(connection);
  const initialTime = new Date();
  let currentTime = new Date(initialTime);
  const auth = createAuthService({ connection, now: () => new Date(currentTime) });
  const password = 'a correct horse battery staple';
  let primary;
  let secondary;
  const users = connection.db.collection('users');
  const sessions = connection.db.collection('sessions');
  const collections = connection.db.collection('saved_collections');

  await t.test('registration normalizes identity, hashes credentials and atomically creates the default collection', async () => {
    primary = await auth.register({
      email: '  Account+tag@Example.com  ', username: 'Test_Member', displayName: 'First Member', password,
    });
    assert.equal(primary.user.email, 'account+tag@example.com');
    assert.equal(primary.user.username, 'test_member');
    assert.equal(primary.user.status, 'active');
    assert.equal(primary.user.passwordHash, undefined);
    assert.equal(primary.user.token, undefined);
    const stored = await users.findOne({ emailNormalized: 'account+tag@example.com' });
    assert.ok(stored);
    assert.match(stored.passwordHash, /^scrypt/);
    assert.notEqual(stored.passwordHash, password);
    assert.equal(stored.authVersion, 0);
    const session = await sessions.findOne({ userId: stored._id });
    assert.equal(session.tokenHash, createHash('sha256').update(primary.token).digest('hex'));
    assert.doesNotMatch(JSON.stringify(session), new RegExp(primary.token));
    const saved = await collections.findOne({ ownerId: stored._id, isDefault: true });
    assert.equal(saved.name, 'Saved');
    assert.equal(await collections.countDocuments({ ownerId: stored._id, isDefault: true }), 1);
    assert.equal((await auth.resolveSession(primary.token)).user.id, primary.user.id);
    assert.equal(new Date(primary.expiresAt).getTime() - currentTime.getTime(), 7 * 24 * 60 * 60 * 1000);
  });

  await t.test('parallel duplicate registration produces exactly one account and one default collection', async () => {
    const results = await Promise.allSettled([
      auth.register({ email: 'race@example.com', username: 'race_one', displayName: 'Race One', password }),
      auth.register({ email: 'RACE@example.com', username: 'race_two', displayName: 'Race Two', password }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.equal(failure.status, 409);
    assert.equal(failure.code, 'IDENTITY_UNAVAILABLE');
    assert.equal(await users.countDocuments({ emailNormalized: 'race@example.com' }), 1);
    assert.equal(await collections.countDocuments({ isDefault: true }), await users.countDocuments());
    await assert.rejects(auth.register({ email: 'other@example.com', username: 'test_member', displayName: 'Duplicate', password }),
      (error) => error.status === 409 && error.code === 'IDENTITY_UNAVAILABLE');
  });

  await t.test('invalid signup fields are rejected before writing an account', async () => {
    const before = await users.countDocuments();
    for (const extra of [{ role: 'admin' }, { status: 'active' }, { username: 'bad.name' }, { password: 'short' }]) {
      await assert.rejects(auth.register({ email: 'invalid@example.com', username: 'invalid_member', displayName: 'Invalid Member', password, ...extra }),
        (error) => error.status === 422 && error.code === 'VALIDATION_ERROR');
    }
    assert.equal(await users.countDocuments(), before);
  });

  await t.test('login uses normalized email and gives identical credential errors for unknown users and wrong passwords', async () => {
    const login = await auth.login({ email: ' ACCOUNT+tag@EXAMPLE.COM ', password });
    assert.equal(login.user.id, primary.user.id);
    assert.notEqual(login.token, primary.token);
    let knownFailure;
    let unknownFailure;
    try { await auth.login({ email: 'account+tag@example.com', password: 'not the right password' }); } catch (error) { knownFailure = error; }
    try { await auth.login({ email: 'unknown@example.com', password: 'not the right password' }); } catch (error) { unknownFailure = error; }
    assert.equal(knownFailure.status, 401);
    assert.equal(knownFailure.code, 'INVALID_CREDENTIALS');
    assert.equal(unknownFailure.status, knownFailure.status);
    assert.equal(unknownFailure.code, knownFailure.code);
    assert.equal(unknownFailure.message, knownFailure.message);
  });

  await t.test('profile editing only updates the owner and rejects protected properties', async () => {
    secondary = await auth.register({ email: 'second@example.com', username: 'second_member', displayName: 'Second Member', password });
    const updated = await auth.updateProfile(primary.token, { displayName: 'New Name', username: 'new_name', bio: 'A real profile.' }, primary.user.id);
    assert.equal(updated.displayName, 'New Name');
    assert.equal(updated.username, 'new_name');
    assert.equal(updated.bio, 'A real profile.');
    assert.equal((await auth.resolveSession(secondary.token)).user.displayName, 'Second Member');
    await assert.rejects(auth.updateProfile(primary.token, { displayName: 'Attack', userId: secondary.user.id }, primary.user.id),
      (error) => error.status === 422 && error.code === 'VALIDATION_ERROR');
    await assert.rejects(auth.updateProfile(primary.token, { role: 'admin', email: 'replace@example.com' }, primary.user.id),
      (error) => error.status === 422 && error.code === 'VALIDATION_ERROR');
    await assert.rejects(auth.updateProfile(primary.token, { username: 'second_member' }, primary.user.id),
      (error) => error.status === 409 && error.code === 'IDENTITY_UNAVAILABLE');
  });

  await t.test('a stale form cannot edit or log out a different account after cookie switching', async () => {
    const original = await users.findOne({ _id: new mongoose.Types.ObjectId(secondary.user.id) });
    await assert.rejects(auth.updateProfile(secondary.token, {
      displayName: 'Edits intended for the first account', username: 'unused_stale_form', bio: 'Do not apply to the second member.',
    }, primary.user.id), (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
    assert.deepEqual(await users.findOne({ _id: original._id }), original);
    await assert.rejects(auth.logout(secondary.token, primary.user.id),
      (error) => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
    assert.equal((await auth.resolveSession(secondary.token)).user.id, secondary.user.id);
  });

  await t.test('expiry is enforced without relying on asynchronous TTL cleanup', async () => {
    currentTime = new Date(new Date(primary.expiresAt).getTime() + 1);
    await assert.rejects(auth.resolveSession(primary.token),
      (error) => error.status === 401 && error.code === 'SESSION_EXPIRED');
    assert.ok(await sessions.findOne({ tokenHash: createHash('sha256').update(primary.token).digest('hex') }));
    currentTime = new Date(initialTime);
  });

  await t.test('authVersion changes invalidate previous sessions', async () => {
    const login = await auth.login({ email: 'second@example.com', password });
    await users.updateOne({ _id: new mongoose.Types.ObjectId(secondary.user.id) }, { $inc: { authVersion: 1 } });
    await assert.rejects(auth.resolveSession(login.token), (error) => error.status === 401);
  });

  await t.test('logout revokes the presented session and remains idempotent', async () => {
    const login = await auth.login({ email: 'account+tag@example.com', password });
    await auth.logout(login.token);
    await assert.rejects(auth.resolveSession(login.token), (error) => error.status === 401);
    await auth.logout(login.token);
    await auth.logout(undefined);
  });
});
