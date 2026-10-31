import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config/env.js';

const mongoUri = 'mongodb://127.0.0.1:27017/scaffold_test';

test('configuration requires an explicit MongoDB URI', () => {
  assert.throws(() => readConfig({}), /MONGODB_URI is required/);
});

test('configuration applies local defaults without mutating its input', () => {
  const input = { MONGODB_URI: mongoUri };
  const config = readConfig(input);
  assert.deepEqual(config, { nodeEnv: 'development', host: '127.0.0.1', port: 3000, mongoUri });
  assert.deepEqual(input, { MONGODB_URI: mongoUri });
  assert.equal(Object.isFrozen(config), true);
});

test('configuration accepts explicit production settings', () => {
  assert.deepEqual(readConfig({
    MONGODB_URI: mongoUri,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '8080',
  }), { nodeEnv: 'production', host: '0.0.0.0', port: 8080, mongoUri });
});

for (const port of ['', '0', '-1', '65536', '3.5', '1e3', '3000junk']) {
  test(`configuration rejects invalid port ${JSON.stringify(port)}`, () => {
    assert.throws(() => readConfig({ MONGODB_URI: mongoUri, PORT: port }), /PORT must be an integer/);
  });
}

test('configuration rejects unknown runtime modes and empty hosts', () => {
  assert.throws(() => readConfig({ MONGODB_URI: mongoUri, NODE_ENV: 'staging' }), /NODE_ENV must be/);
  assert.throws(() => readConfig({ MONGODB_URI: mongoUri, HOST: '  ' }), /HOST must not be empty/);
});

test('invalid configuration errors never echo a credential-bearing URI', () => {
  const secretUri = 'https://private-user:private-password@example.invalid/database';
  assert.throws(() => readConfig({ MONGODB_URI: secretUri }), (error) => {
    assert.match(error.message, /MONGODB_URI must be/);
    assert.doesNotMatch(error.message, /private-user|private-password|example\.invalid/);
    return true;
  });
});
