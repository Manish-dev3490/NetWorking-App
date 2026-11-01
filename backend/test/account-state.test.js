import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
// Execute the component's real account functions without mounting its JSX.
// Deferred reads let these tests control response order independently of timing.
const accountFunctions = appSource.slice(
  appSource.indexOf('  function updateAccount('), appSource.indexOf('  function navigate('),
);
const profileSavedFunction = appSource.slice(
  appSource.indexOf('  function profileSaved('), appSource.indexOf('  async function logout('),
);

function accountState(user) {
  let completeRead;
  const pendingRead = new Promise((resolve) => { completeRead = resolve; });
  const userRef = { current: user };
  const updates = [];
  const notices = [];
  const context = {
    AbortController,
    userRef,
    accountEpochRef: { current: 0 },
    profileVersionRef: { current: 0 },
    refreshRef: { current: null },
    apiRequest: async () => pendingRead,
    setUser: (account) => updates.push(account),
    clearCsrfToken() {},
    setLoading() {},
    setRestoreError() {},
    setAccountError: (message) => notices.push(message),
    setPath() {},
    describeError: (error) => error.message,
    window: { location: { pathname: '/profile', hash: '' }, history: { replaceState() {} } },
  };
  const actions = runInNewContext(
    `${accountFunctions}\n${profileSavedFunction}\n({ reconcileAccount, profileSaved });`, context,
  );
  return { ...actions, userRef, updates, notices, completeRead };
}

test('an older same-account refresh cannot overwrite a completed profile save', async () => {
  const original = { id: 'alice', displayName: 'Original name', bio: 'Original bio' };
  const saved = { ...original, displayName: 'Saved name', bio: 'Saved bio' };
  const state = accountState(original);
  const refresh = state.reconcileAccount();

  state.profileSaved(saved);
  state.completeRead({ data: original });
  await refresh;

  assert.deepEqual(state.userRef.current, saved);
  assert.deepEqual(state.updates, [saved]);
});

test('a pending refresh still applies a different account after a profile save', async () => {
  const original = { id: 'alice', displayName: 'Alice' };
  const saved = { ...original, displayName: 'Alice saved' };
  const switched = { id: 'bob', displayName: 'Bob' };
  const state = accountState(original);
  const refresh = state.reconcileAccount();

  state.profileSaved(saved);
  state.completeRead({ data: switched });
  await refresh;

  assert.deepEqual(state.userRef.current, switched);
  assert.deepEqual(state.updates, [saved, switched]);
  assert.ok(state.notices.some((message) => message.includes('changed in another tab')));
});
