import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAuthMigration } from '../src/migrations/001-auth.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { createAuthService } from '../src/modules/auth/service.js';

test('unknown identities use bounded password work and return the generic credentials error', async () => {
  const service = createAuthService({ repository: { findByEmail: async () => null } });
  const input = { email: 'unknown@example.test', password: 'A long password for this check' };
  const work = [hashPassword(input.password), hashPassword(input.password)];
  try {
    await assert.rejects(service.login(input), (error) => error.status === 503 && error.code === 'SERVICE_UNAVAILABLE');
  } finally {
    await Promise.all(work);
  }
  await assert.rejects(service.login(input), (error) => error.status === 401 && error.code === 'INVALID_CREDENTIALS');
});

test('authentication startup fails closed until the explicit migration is recorded', async () => {
  const checked = [];
  const connection = { db: { collection: (name) => {
    checked.push(name);
    return { findOne: async (filter) => { checked.push(filter); return null; } };
  } } };
  await assert.rejects(assertAuthMigration(connection), /Run the authentication migration/);
  assert.deepEqual(checked, ['schema_migrations', { _id: '001-auth' }]);
  await assert.rejects(assertAuthMigration({}), /Authentication schema is not ready/);
  await assertAuthMigration({ db: { collection: () => ({ findOne: async () => ({ _id: '001-auth' }) }) } });
});
