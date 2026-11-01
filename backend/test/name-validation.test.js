import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProfile as validateClientProfile } from '../../frontend/src/features/auth/form-utils.js';
import { displayNameSearch, validateProfile, validateRegistration } from '../src/modules/auth/validation.js';

const account = {
  email: 'name-test@example.com', username: 'name_test', displayName: 'A Member',
  password: '  A long unnormalized e\u0301 password  ',
};

function rejectsName(work) {
  assert.throws(work, (error) => error.status === 422 && error.code === 'VALIDATION_ERROR'
    && error.fields.some((field) => field.path === 'displayName'));
}

test('mark-only names receive a field error before signup or profile persistence', () => {
  for (const name of ['\u0301', '\u0301\u0308', '\u0301 \u0308']) {
    rejectsName(() => validateRegistration({ ...account, displayName: name }));
    rejectsName(() => validateProfile({ displayName: name }));
    assert.ok(validateClientProfile({ ...account, displayName: name }).displayName);
  }
});

test('client and server count NFC-normalized names at the same character boundaries', () => {
  for (const count of [31, 60]) {
    const decomposed = 'e\u0301'.repeat(count);
    const values = { ...account, displayName: `  ${decomposed}  ` };
    assert.equal(validateClientProfile(values).displayName, undefined);
    assert.equal(validateRegistration(values).displayName, 'é'.repeat(count));
    assert.equal(validateProfile({ displayName: values.displayName }).displayName, 'é'.repeat(count));
  }
  const tooLong = 'e\u0301'.repeat(61);
  assert.ok(validateClientProfile({ ...account, displayName: tooLong }).displayName);
  rejectsName(() => validateRegistration({ ...account, displayName: tooLong }));
  rejectsName(() => validateProfile({ displayName: tooLong }));
});

test('international, emoji and punctuation names retain nonempty search values', () => {
  for (const name of ['José', '李明', 'मानिश', '🦊', '—', "O’Connor"]) {
    const registered = validateRegistration({ ...account, displayName: name });
    assert.equal(registered.displayName, name.normalize('NFC'));
    assert.ok(displayNameSearch(registered.displayName).trim());
    assert.equal(validateProfile({ displayName: name }).displayName, registered.displayName);
    assert.equal(validateClientProfile({ ...account, displayName: name }).displayName, undefined);
  }
});

test('client bio limits use the same trim and NFC normalization as the server', () => {
  const allowed = `  ${'e\u0301'.repeat(160)}  `;
  assert.equal(validateClientProfile({ ...account, bio: allowed }).bio, undefined);
  assert.equal(validateProfile({ bio: allowed }).bio, 'é'.repeat(160));
  const tooLong = 'e\u0301'.repeat(161);
  assert.ok(validateClientProfile({ ...account, bio: tooLong }).bio);
  assert.throws(() => validateProfile({ bio: tooLong }), (error) => error.status === 422);
});

test('name normalization leaves password characters and bytes unchanged', () => {
  assert.equal(validateRegistration({ ...account, displayName: 'e\u0301' }).password, account.password);
});
