import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { describeError, characterCount, serverFieldErrors, validateProfile } from '../../frontend/src/features/auth/form-utils.js';
import { MAX_IMAGE_BYTES } from '../../frontend/src/features/posts/post-utils.js';

const account = { id: '507f1f77bcf86cd799439011', username: 'viewer', displayName: 'Viewer', visibility: 'public', bio: '', avatarUrl: null };
const targetId = '507f1f77bcf86cd799439012';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Exercise the component's real actions/effects with persistent hooks. Pending
// requests deliberately ignore cancellation, as a server may already commit.
async function component(name, marker, actionNames, props, globals = {}) {
  const folder = name === 'ProfilePage' ? 'auth' : name === 'PostFeed' ? 'posts' : 'network';
  const file = await readFile(new URL(`../../frontend/src/features/${folder}/${name}.jsx`, import.meta.url), 'utf8');
  const source = file.slice(0, file.indexOf(marker)).replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export default ', '');
  const states = [];
  const refs = [];
  const effects = [];
  const updates = [];
  let stateIndex;
  let refIndex;
  let effectIndex;
  const create = runInNewContext(`${source}\nreturn { ${actionNames.join(', ')} };\n}\n${name}`, {
    AbortController, URLSearchParams, describeError, characterCount, serverFieldErrors, validateProfile, MAX_IMAGE_BYTES,
    crypto: { randomUUID }, URL: { createObjectURL: () => 'blob:test-profile-photo', revokeObjectURL() {} },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
        updates.push(index);
      }];
    },
    useRef(initial) { const index = refIndex++; refs[index] ??= { current: initial }; return refs[index]; },
    useEffect(effect, dependencies) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
        effects[index] = { dependencies, effect, previousCleanup: previous?.cleanup, scheduled: true };
      }
    },
    ...globals,
  });
  return {
    states, updates,
    render(nextProps = props) {
      props = nextProps;
      stateIndex = 0; refIndex = 0; effectIndex = 0;
      return create(props);
    },
    flushEffects() {
      for (const effect of effects) if (effect.scheduled) {
        effect.previousCleanup?.();
        effect.cleanup = effect.effect();
        effect.scheduled = false;
      }
    },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test('a late follow completion from an unmounted account profile cannot refresh or navigate the new account', async () => {
  const pending = deferred();
  const changes = [];
  let mutationSignal;
  const profile = { id: targetId, relationship: { followingStatus: 'none' } };
  const state = await component('MemberProfile', '  const status =', ['changeFollow'], {
    user: account, memberId: targetId, revision: 0, onChanged: () => changes.push('old-account-change'),
  }, {
    apiRequest: async (path, options) => {
      if (!options.method) return { data: profile };
      assert.equal(path, `me/following/${targetId}`);
      assert.equal(options.accountId, account.id);
      mutationSignal = options.signal;
      return pending.promise;
    },
  });
  state.render(); state.flushEffects(); await setImmediate();
  const action = state.render().changeFollow();
  state.unmount();
  const updateCount = state.updates.length;
  assert.equal(mutationSignal.aborted, true);
  pending.resolve({ data: { userId: targetId, status: 'accepted' } });
  await action;
  assert.deepEqual(changes, []);
  assert.equal(state.updates.length, updateCount);
});

test('an approval finishing after leaving the old account request inbox cannot change the next page', async () => {
  const pending = deferred();
  const changes = [];
  let mutationSignal;
  const request = { id: 'request-1', follower: { id: targetId, displayName: 'Requester' } };
  const state = await component('FollowRequests', '  return <NetworkPage', ['respond'], {
    user: account, revision: 0, onChanged: () => changes.push('old-inbox-change'),
  }, {
    apiRequest: async (path, options) => {
      if (!options.method) return { data: [request], meta: { hasMore: false, nextCursor: null } };
      assert.equal(path, `me/follow-requests/${targetId}`);
      assert.equal(options.method, 'PUT');
      assert.equal(options.accountId, account.id);
      mutationSignal = options.signal;
      return pending.promise;
    },
  });
  state.render(); state.flushEffects(); await setImmediate();
  const action = state.render().respond(request, true);
  state.unmount();
  const updateCount = state.updates.length;
  assert.equal(mutationSignal.aborted, true);
  pending.resolve({ data: { userId: targetId, status: 'accepted' } });
  await action;
  assert.deepEqual(changes, []);
  assert.equal(state.updates.length, updateCount);
});

test('rejecting an already approved request reports retained access and preserves the outcome through inbox refresh', async () => {
  const entry = { id: 'stale-pending-request', follower: { id: targetId, displayName: 'Requester' } };
  let reads = 0;
  let changes = 0;
  const props = { user: account, revision: 0, onChanged: () => { changes += 1; } };
  const state = await component('FollowRequests', '  return <NetworkPage', ['respond'], props, {
    apiRequest: async (path, options) => {
      if (!options.method) return { data: ++reads === 1 ? [entry] : [], meta: { hasMore: false, nextCursor: null } };
      assert.equal(path, `me/follow-requests/${targetId}`);
      assert.equal(options.method, 'DELETE');
      assert.equal(options.accountId, account.id);
      throw Object.assign(new Error('This member is already approved.'), { status: 409, code: 'REQUEST_ALREADY_APPROVED' });
    },
  });
  state.render(); state.flushEffects(); await setImmediate();
  assert.equal(state.states[0].length, 1);
  await state.render().respond(entry, false);
  assert.equal(state.states[0].length, 0);
  assert.match(state.states[3], /already approved.*can see your private posts.*Followers.*revoke access/i);
  assert.doesNotMatch(state.states[3], /was rejected/i);
  assert.equal(state.states[2], '');
  assert.equal(changes, 1);
  const outcome = state.states[3];
  state.render({ ...props, revision: 1 }); state.flushEffects(); await setImmediate();
  assert.equal(state.states[0].length, 0);
  assert.equal(state.states[3], outcome, 'refresh must not erase the actual approval/access result');
  assert.equal(state.states[4], null);
  state.unmount();
});

test('rejecting a pending or already cancelled request accurately reports that no pending request remains', async () => {
  for (const serverState of ['pending', 'absent']) {
    const entry = { id: `request-${serverState}`, follower: { id: targetId, displayName: 'Requester' } };
    let relationship = serverState;
    const state = await component('FollowRequests', '  return <NetworkPage', ['respond'], {
      user: account, revision: 0, onChanged() {},
    }, {
      apiRequest: async (path, options) => {
        if (!options.method) return { data: [entry], meta: { hasMore: false, nextCursor: null } };
        assert.equal(options.method, 'DELETE');
        if (relationship === 'pending') relationship = 'absent';
        return null;
      },
    });
    state.render(); state.flushEffects(); await setImmediate();
    await state.render().respond(entry, false);
    assert.equal(relationship, 'absent');
    assert.equal(state.states[0].length, 0);
    assert.match(state.states[3], /has no pending follow request/i);
    assert.doesNotMatch(state.states[3], /was rejected|already approved/i);
    state.unmount();
  }
});

test('a stale rejection conflict received after leaving an account cannot announce an old private-access outcome', async () => {
  const pending = deferred();
  const entry = { id: 'old-request', follower: { id: targetId, displayName: 'Old account requester' } };
  let changes = 0;
  const state = await component('FollowRequests', '  return <NetworkPage', ['respond'], {
    user: account, revision: 0, onChanged: () => { changes += 1; },
  }, {
    apiRequest: async (path, options) => !options.method
      ? { data: [entry], meta: { hasMore: false, nextCursor: null } } : pending.promise,
  });
  state.render(); state.flushEffects(); await setImmediate();
  const rejecting = state.render().respond(entry, false);
  state.unmount();
  const updateCount = state.updates.length;
  pending.reject(Object.assign(new Error('Already approved'), { status: 409, code: 'REQUEST_ALREADY_APPROVED' }));
  await rejecting;
  assert.equal(state.updates.length, updateCount);
  assert.equal(changes, 0);
  assert.equal(state.states[3], '');
});

test('a profile draft does not resubmit an untouched stale privacy setting after another tab changes it', async () => {
  const writes = [];
  let currentAccount = account;
  const props = { user: account, onSaved() {} };
  const state = await component('ProfilePage', '  return <div', ['submit', 'update'], props, {
    apiRequest: async (path, options) => {
      assert.equal(path, 'me/profile'); writes.push(options.body);
      return { data: { ...currentAccount, ...options.body } };
    },
  });
  state.render(); state.flushEffects();
  state.render().update({ target: { name: 'bio', value: 'My unsaved biography' } });
  currentAccount = { ...account, visibility: 'private' };
  // Preserve the current draft even if a user saves before the new effect runs.
  const actions = state.render({ ...props, user: currentAccount });
  await actions.submit({ preventDefault() {} });
  assert.equal(Object.hasOwn(writes[0], 'visibility'), false);
  assert.equal(writes[0].bio, 'My unsaved biography');
  state.flushEffects();
  assert.equal(state.states[0].visibility, 'private');
  assert.equal(state.states[0].bio, 'My unsaved biography');
  state.render().update({ target: { name: 'visibility', value: 'public' } });
  await state.render().submit({ preventDefault() {} });
  assert.equal(writes[1].visibility, 'public', 'an explicit privacy selection must still be saved');
  state.unmount();
});

test('an uncertain avatar retry that discovers a discarded asset releases the draft and uses a new upload key', async () => {
  const uploads = [];
  const patches = [];
  const discarded = [];
  const saved = [];
  const busy = [];
  const assetIds = ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439022'];
  const state = await component('AvatarEditor', '  return <section', ['select', 'save'], {
    user: account, onSaved: (user) => saved.push(user), onBusyChange: (value) => busy.push(value),
  }, {
    discardImage: async (id, owner) => { discarded.push({ id, owner }); },
    apiRequest: async (path, options) => {
      assert.equal(options.accountId, account.id);
      if (path === 'media/uploads') {
        uploads.push(options);
        return { data: { id: assetIds[uploads.length - 1] } };
      }
      assert.equal(path, 'me/profile'); patches.push(options.body);
      if (patches.length === 1) throw Object.assign(new Error('Unknown result'), { status: 503 });
      if (patches.length === 2) throw Object.assign(new Error('Asset was discarded'), { status: 409, code: 'ASSET_NOT_READY' });
      return { data: { ...account, avatarUrl: `/api/v1/media/${assetIds[1]}/content` } };
    },
  });
  state.render(); state.flushEffects();
  const file = { type: 'image/png', size: 100, name: 'avatar.png' };
  state.render().select({ target: { files: [file], value: 'avatar.png' } });
  await state.render().save();
  assert.equal(state.states[4], true, 'an ambiguous attachment needs a safe retry');
  assert.equal(uploads.length, 1);
  const firstKey = uploads[0].headers['Idempotency-Key'];
  await state.render().save();
  assert.equal(uploads.length, 1, 'the uncertain retry must check its existing attachment first');
  assert.equal(patches[1], patches[0]);
  assert.equal(state.states[4], false, 'a known missing asset must release uncertainty');
  assert.equal(state.states[0], file, 'the selected photo should stay available for recovery');
  assert.deepEqual(discarded, [{ id: assetIds[0], owner: account.id }]);
  await state.render().save();
  assert.equal(uploads.length, 2);
  assert.notEqual(uploads[1].headers['Idempotency-Key'], firstKey);
  assert.equal(uploads[1].rawBody, file);
  assert.equal(uploads[1].headers['X-Media-Purpose'], 'avatar');
  assert.equal(patches[2].avatarAssetId, assetIds[1]);
  assert.equal(saved[0].avatarUrl, `/api/v1/media/${assetIds[1]}/content`);
  assert.equal(state.states[0], null);
  assert.equal(busy.at(-1), false);
  state.unmount();
});

test('a private post-page denial removes loaded posts and resets the profile to its current private gate', async () => {
  const visibleProfile = { id: targetId, visibility: 'private', canViewContent: true,
    bio: 'A private biography', counts: { posts: 20, followers: 3, following: 4 }, relationship: { followingStatus: 'accepted' } };
  const privateProfile = { id: targetId, visibility: 'private', canViewContent: false, relationship: { followingStatus: 'none' } };
  let profileReads = 0;
  const profile = await component('MemberProfile', '  const status =', ['accessLost'], {
    user: account, memberId: targetId, revision: 0,
  }, {
    apiRequest: async () => ({ data: ++profileReads === 1 ? visibleProfile : privateProfile }),
  });
  profile.render(); profile.flushEffects(); await setImmediate();
  assert.equal(profile.states[0].bio, 'A private biography');
  const gate = profile.render().accessLost;
  let reads = 0;
  const feed = await component('PostFeed', '  const normalizedQuery', ['load'], {
    user: account, scope: 'profile', memberId: targetId, onAccessLost: gate,
  }, {
    apiRequest: async (path) => {
      if (++reads === 1) return { data: [{ id: 'private-post' }], meta: { nextCursor: 'C1', hasMore: true } };
      assert.equal(new URLSearchParams(path.split('?')[1]).get('cursor'), 'C1');
      throw Object.assign(new Error('Post or photo not found.'), { status: 404 });
    },
  });
  await feed.render().load(null, true);
  assert.equal(feed.states[0].length, 1);
  await feed.render().load('C1');
  assert.equal(feed.states[0].length, 0);
  assert.equal(feed.states[3], null);
  assert.equal(feed.states[4], false);
  assert.equal(profile.states[0], null, 'private biography and counts must disappear before the refresh completes');
  profile.render(); profile.flushEffects(); await setImmediate();
  assert.equal(profile.states[0].canViewContent, false);
  assert.equal(profile.states[0].bio, undefined);
  assert.equal(profile.states[0].counts, undefined);
  profile.unmount(); feed.unmount();
});

test('a denied relationship-list page clears cached members and its pagination before requesting a profile gate refresh', async () => {
  let reads = 0;
  let lost = 0;
  const state = await component('MemberList', '  return <div', ['load'], {
    user: account, path: `users/${targetId}/followers`, onAccessLost: () => {
      lost += 1;
      assert.equal(state.states[0].length, 0);
      assert.equal(state.states[3], null);
      assert.equal(state.states[4], false);
    },
  }, {
    apiRequest: async () => {
      if (++reads === 1) return { data: [{ id: 'a-private-follower' }], meta: { nextCursor: 'C1', hasMore: true } };
      throw Object.assign(new Error('Member not found.'), { status: 404 });
    },
  });
  await state.render().load(null, true);
  assert.equal(state.states[0].length, 1);
  await state.render().load('C1');
  assert.equal(lost, 1);
  assert.equal(state.states[1], false);
  assert.equal(state.states[2], '');
  state.unmount();
});

test('a non-profile feed read failure retains its loaded posts and exposes retry instead of invoking a profile privacy gate', async () => {
  let reads = 0;
  const state = await component('PostFeed', '  const normalizedQuery', ['load'], {
    user: account, scope: 'own', onAccessLost: () => assert.fail('an own feed must not use the profile gate'),
  }, {
    apiRequest: async () => {
      if (++reads === 1) return { data: [{ id: 'own-post' }], meta: { nextCursor: 'C1', hasMore: true } };
      throw Object.assign(new Error('Temporary read failure'), { status: 404 });
    },
  });
  await state.render().load(null, true);
  await state.render().load('C1');
  assert.equal(state.states[0].length, 1);
  assert.equal(state.states[0][0].id, 'own-post');
  assert.equal(state.states[2], 'Temporary read failure');
  assert.equal(state.states[3], 'C1');
  assert.equal(state.states[4], true);
  state.unmount();
});
