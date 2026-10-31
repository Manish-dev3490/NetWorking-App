import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../src/config/database.js';

test('database is unavailable before connection and remains unavailable after close', async () => {
  const database = createDatabase();
  try {
    assert.equal(await database.isAvailable(), false);
  } finally {
    await database.close();
  }
  assert.equal(await database.isAvailable(), false);
});

test('configured MongoDB connects, answers a real readiness ping, and closes', {
  skip: !process.env.TEST_MONGODB_URI && 'Set TEST_MONGODB_URI to run the read-only MongoDB integration check.',
}, async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await database.connect(process.env.TEST_MONGODB_URI);
  assert.equal(await database.isAvailable(), true);
  await database.close();
  assert.equal(await database.isAvailable(), false);
});
