import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const [cardSource, feedSource] = await Promise.all([
  readFile(new URL('../../frontend/src/features/posts/RealPostCard.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../frontend/src/features/posts/PostFeed.jsx', import.meta.url), 'utf8'),
]);

// Run the real component's asynchronous actions and effect cleanups. Deferred
// responses deliberately ignore abort, as an already-finished server may do.
function hooks() {
  const states = [];
  const effects = [];
  const updates = [];
  return {
    states, effects, updates,
    useRef: (current) => ({ current }),
    useEffect: (effect) => { effects.push(effect); },
    useState(initial) {
      const index = states.length;
      states.push(initial);
      return [initial, (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
        updates.push({ index, value: states[index] });
      }];
    },
  };
}

function card(request, onChanged) {
  const lifecycle = hooks();
  const source = cardSource.slice(cardSource.indexOf('export default function RealPostCard('), cardSource.indexOf('  return <article'))
    .replace('export default ', '');
  const create = runInNewContext(`${source}\nreturn { remove };\n}\nRealPostCard`, {
    ...lifecycle, AbortController, apiRequest: request, describeError: (error) => error.message,
  });
  const actions = create({ post: { id: 'post-a', author: { id: 'alice' }, media: [], canManage: true }, user: { id: 'alice' }, onChanged });
  const cleanups = lifecycle.effects.map((effect) => effect());
  return { ...actions, ...lifecycle, unmount: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test('a delete finishing after leaving the detail page cannot navigate the next page', async () => {
  let complete;
  let signal;
  const changes = [];
  const state = card((path, options) => {
    signal = options.signal;
    return new Promise((resolve) => { complete = resolve; });
  }, (result) => changes.push(result));
  const removing = state.remove();
  state.unmount();
  assert.equal(signal.aborted, true);
  complete(null);
  await removing;
  assert.deepEqual(changes, []);
});

test('a late delete failure cannot update an unmounted account card', async () => {
  let reject;
  const state = card(() => new Promise((resolve, fail) => { reject = fail; }), () => assert.fail('old account callback'));
  const removing = state.remove();
  state.unmount();
  const updateCount = state.updates.length;
  reject(new Error('Late network failure'));
  await removing;
  assert.equal(state.updates.length, updateCount);
});

test('an available card still announces a successful deletion', async () => {
  const changes = [];
  const state = card(async () => null, (result) => changes.push(result));
  await state.remove();
  assert.equal(changes[0].deletedId, 'post-a');
  state.unmount();
});

test('retry after an empty visibility scan requests the failed next cursor', async () => {
  const lifecycle = hooks();
  const paths = [];
  const source = feedSource.slice(feedSource.indexOf('export default function PostFeed('), feedSource.indexOf('  const normalizedQuery'))
    .replace('export default ', '');
  const create = runInNewContext(`${source}\nreturn { load, retry };\n}\nPostFeed`, {
    ...lifecycle, AbortController, URLSearchParams, describeError: (error) => error.message,
    apiRequest: async (path) => {
      paths.push(path);
      if (paths.length === 2) throw new Error('Temporarily offline');
      return { data: [], meta: { nextCursor: paths.length === 1 ? 'C1' : null, hasMore: paths.length === 1 } };
    },
  });
  const actions = create({ user: { id: 'alice' }, onChanged() {}, onOpenPost() {}, onCreate() {} });
  await actions.load(null, true);
  await actions.load('C1');
  await actions.retry();
  assert.equal(paths.length, 3);
  assert.equal(new URLSearchParams(paths[2].split('?')[1]).get('cursor'), 'C1');
  assert.equal(new URLSearchParams(paths[0].split('?')[1]).has('cursor'), false);
});
