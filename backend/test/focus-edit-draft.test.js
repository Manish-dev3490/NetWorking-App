import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { characterCount, describeError } from '../../frontend/src/features/auth/form-utils.js';
import { countCharacters, normalizedTags, validatePostFields } from '../../frontend/src/features/posts/post-utils.js';

const account = { id: '507f1f77bcf86cd799439011', username: 'alice', displayName: 'Alice', status: 'active' };
const post = {
  id: '507f1f77bcf86cd799439012', author: { id: account.id, displayName: account.displayName },
  caption: 'The saved caption', hashtags: ['original'], media: [], canManage: true, version: 3,
};
const source = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const cardSource = await readFile(new URL('../../frontend/src/features/posts/RealPostCard.jsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../../frontend/src/features/posts/PostDetail.jsx', import.meta.url), 'utf8');
const reactionsSource = await readFile(new URL('../../frontend/src/features/posts/PostReactions.jsx', import.meta.url), 'utf8');
const commentsSource = await readFile(new URL('../../frontend/src/features/posts/PostComments.jsx', import.meta.url), 'utf8');
const feedSource = await readFile(new URL('../../frontend/src/features/posts/PostFeed.jsx', import.meta.url), 'utf8');
const engagementSource = await readFile(new URL('../../frontend/src/features/posts/post-engagement.js', import.meta.url), 'utf8');
const providerType = 'PostEditorProvider';
const componentTypes = ['HomePage', 'AuthPage', 'ProfilePage', 'Icon', 'PostComposer', 'PostDetail',
  'MemberSearch', 'MemberProfile', 'FollowRequests', 'EditPost', 'Avatar', 'RealPostCard', 'PostComments', 'SavedPage', 'PostFeed'];

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...tree.children.flatMap(nodes)];
}

// Compile the actual JSX to inspect the rendered ownership/key of the editor,
// rather than assuming a source location for it. No DOM or network is needed.
function renderer(file, name, globals = {}) {
  const code = transformSync(file.replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export default /gm, '').replace(/^export /gm, ''), {
    loader: 'jsx', jsxFactory: 'createElement', jsxFragment: 'Fragment', target: 'es2022',
  }).code;
  const states = [];
  const refs = [];
  const effects = [];
  let stateIndex;
  let refIndex;
  let effectIndex;
  const create = runInNewContext(code + '\n' + name, {
    ...Object.fromEntries(componentTypes.map((type) => [type, type])),
    Fragment: 'Fragment', PostEditorContext: { Provider: providerType },
    AbortController, describeError, countCharacters, normalizedTags, validatePostFields,
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useRef(initial) { const index = refIndex++; refs[index] ??= { current: initial }; return refs[index]; },
    useEffect(effect, dependencies) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
        effects[index] = { effect, dependencies, cleanup: previous?.cleanup, scheduled: true };
      }
    },
    ...globals,
  });
  return {
    states,
    render(props) {
      stateIndex = 0; refIndex = 0; effectIndex = 0;
      const tree = create(props);
      for (const node of nodes(tree)) if (node.props.ref && typeof node.props.ref === 'object') {
        node.props.ref.current ??= { showModal() {}, focus() {} };
      }
      return tree;
    },
    flushEffects() {
      for (const effect of effects) if (effect.scheduled) {
        effect.cleanup?.(); effect.cleanup = effect.effect(); effect.scheduled = false;
      }
    },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

async function application(path = '/') {
  let currentAccount = account;
  const browser = new EventTarget();
  browser.location = { pathname: path, hash: '' };
  browser.history = {
    state: null,
    replaceState(state) { this.state = state; },
    pushState(state) { this.state = state; },
  };
  browser.scrollTo = () => {};
  browser.requestAnimationFrame = (callback) => callback();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.getElementById = () => ({ focus() {} });
  const app = renderer(source, 'App', {
    window: browser, document, clearCsrfToken() {},
    apiRequest: async (route) => {
      assert.equal(route, 'me');
      return { data: currentAccount };
    },
  });
  app.render(); app.flushEffects(); await setImmediate();
  app.render(); app.flushEffects();
  return { ...app, browser, setAccount(value) { currentAccount = value; } };
}

function editorNode(tree) { return nodes(tree).find((node) => node.type === 'EditPost'); }
function input(tree, type) { return nodes(tree).find((node) => node.type === type); }

function engagement() {
  return runInNewContext(`${engagementSource.replace(/^export /gm, '')}\n({ pendingLikes, pendingSaves, notifyEngagement, observeEngagement })`, {
    window: new EventTarget(), EventTarget, Event, CustomEvent,
  });
}

test('Saved opens from Home and rechecks its posts on tab focus', async () => {
  const app = await application();
  input(app.render(), 'HomePage').props.onOpenSaved();
  const saved = input(app.render(), 'SavedPage');
  assert.ok(saved);
  assert.equal(saved.props.user.id, account.id);
  app.browser.dispatchEvent(new Event('focus')); await setImmediate();
  const focused = input(app.render(), 'SavedPage');
  assert.equal(focused.props.revision, saved.props.revision + 1);
  focused.props.onOpenPost(post.id);
  const detail = input(app.render(), 'PostDetail');
  assert.equal(detail.props.backToSaved, true);
  detail.props.onBack();
  input(app.render(), 'SavedPage').props.onBack();
  assert.equal(input(app.render(), 'SavedPage'), undefined);
  app.unmount();
});

test('a completed unsave removes its card from Saved even if the request started before navigation', async () => {
  const events = engagement();
  const savedPost = { ...post, savedByMe: true };
  const saveSource = await readFile(new URL('../../frontend/src/features/posts/PostSaveButton.jsx', import.meta.url), 'utf8');
  let finish;
  const control = renderer(saveSource, 'PostSaveButton', {
    ...events,
    apiRequest: (path, options) => {
      assert.equal(path, `posts/${post.id}/save`);
      assert.equal(options.method, 'DELETE');
      assert.equal(options.accountId, account.id);
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const button = input(control.render({ post: savedPost, user: account }), 'button');
  control.flushEffects();
  assert.equal(button.props['aria-pressed'], true);
  const unsaving = button.props.onClick();
  control.unmount();

  const reads = [];
  const feed = renderer(feedSource, 'PostFeed', {
    ...events, URLSearchParams,
    apiRequest: (path, options) => {
      assert.match(path, /^me\/saved-posts\?/);
      assert.equal(options.accountId, account.id);
      return new Promise((resolve) => reads.push(resolve));
    },
  });
  const props = { user: account, scope: 'saved', revision: 0 };
  feed.render(props); feed.flushEffects();
  events.notifyEngagement('different-account', post.id, { savedByMe: false });
  reads[0]({ data: [savedPost] }); await setImmediate();
  assert.ok(input(feed.render(props), 'RealPostCard'));

  props.revision += 1;
  feed.render(props); feed.flushEffects();
  assert.equal(input(feed.render(props), 'RealPostCard'), undefined, 'revalidation hides the previously loaded page');
  finish({ data: { savedByMe: false } }); await unsaving;
  reads[1]({ data: [savedPost] }); await setImmediate();
  assert.equal(input(feed.render(props), 'RealPostCard'), undefined, 'a stale read cannot restore an unsaved post');
  feed.unmount();
});

test('Saved Load more rechecks earlier pages and drops revoked and deleted posts', async () => {
  const bookmarks = ['revoked', 'deleted', 'retained', 'next'].map((id) => ({ ...post, id, savedByMe: true }));
  const [revoked, deleted, retained, next] = bookmarks;
  const reads = [];
  const feed = renderer(feedSource, 'PostFeed', {
    ...engagement(), URLSearchParams,
    apiRequest(path, options) {
      assert.equal(options.accountId, account.id);
      return new Promise((resolve) => reads.push({ cursor: new URLSearchParams(path.split('?')[1]).get('cursor'), resolve }));
    },
  });
  const props = { user: account, scope: 'saved' };
  const cards = () => nodes(feed.render(props)).filter((node) => node.type === 'RealPostCard').map((node) => node.props.post.id);
  feed.render(props); feed.flushEffects();
  reads[0].resolve({ data: [revoked, deleted, retained], meta: { hasMore: true, nextCursor: 'old' } }); await setImmediate();
  assert.deepEqual(cards(), ['revoked', 'deleted', 'retained']);
  const loadMore = nodes(feed.render(props)).find((node) => node.type === 'button' && node.children.includes('Load more posts'));
  const loading = loadMore.props.onClick();
  assert.equal(reads[1].cursor, null);
  assert.deepEqual(cards(), []);
  reads[1].resolve({ data: [retained], meta: { hasMore: true, nextCursor: 'fresh' } }); await setImmediate();
  assert.equal(reads[2].cursor, 'fresh');
  reads[2].resolve({ data: [next] }); await loading; await setImmediate();
  assert.deepEqual(cards(), ['retained', 'next']);
  feed.unmount();
});

test('a late bookmark 404 clears the replacement Saved view and cannot restore the card from an older read', async () => {
  const events = engagement();
  const savedPost = { ...post, savedByMe: true };
  const saveSource = await readFile(new URL('../../frontend/src/features/posts/PostSaveButton.jsx', import.meta.url), 'utf8');
  let fail;
  const control = renderer(saveSource, 'PostSaveButton', {
    ...events, apiRequest: () => new Promise((resolve, reject) => { fail = reject; }),
  });
  const button = input(control.render({ post: savedPost, user: account, onAccessLost: () => assert.fail('departed view callback') }), 'button');
  control.flushEffects();
  const unsaving = button.props.onClick();
  control.unmount();

  const reads = [];
  const feed = renderer(feedSource, 'PostFeed', {
    ...events, URLSearchParams,
    apiRequest: () => new Promise((resolve) => reads.push(resolve)),
  });
  const props = { user: account, scope: 'saved' };
  feed.render(props); feed.flushEffects();
  reads[0]({ data: [savedPost] }); await setImmediate();
  assert.ok(input(feed.render(props), 'RealPostCard'));
  events.notifyEngagement('different-account', post.id, { unavailable: true });
  assert.ok(input(feed.render(props), 'RealPostCard'));
  fail(Object.assign(new Error('Unavailable'), { status: 404 })); await unsaving;
  assert.equal(input(feed.render(props), 'RealPostCard'), undefined);

  const olderRead = renderer(feedSource, 'PostFeed', {
    ...events, URLSearchParams,
    apiRequest: () => new Promise((resolve) => reads.push(resolve)),
  });
  olderRead.render(props); olderRead.flushEffects();
  events.notifyEngagement(account.id, post.id, { unavailable: true });
  reads[1]({ data: [savedPost] }); await setImmediate();
  assert.equal(input(olderRead.render(props), 'RealPostCard'), undefined);
  feed.unmount(); olderRead.unmount();
});

function nodePath(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === type) return [tree];
  for (const child of tree.children) {
    const branch = nodePath(child, type);
    if (branch) return [tree, ...branch];
  }
  return null;
}

test('uppercase permalinks use the canonical ID for detail engagement updates', async () => {
  const app = await application(`/p/${post.id.toUpperCase()}`);
  const route = input(app.render(), 'PostDetail');
  let update;
  const detail = renderer(detailSource, 'PostDetail', {
    observeEngagement(accountId, listener) {
      assert.equal(accountId, account.id);
      update = listener;
      return () => {};
    },
    apiRequest: async (path) => {
      assert.equal(path, `posts/${post.id}`);
      return { data: { ...post, likeCount: 0, commentCount: 0 } };
    },
  });
  detail.render(route.props); detail.flushEffects(); await setImmediate();
  update(post.id, { likedByMe: true, likeCount: 1 });
  update(post.id, { commentCount: 2 });
  const rendered = input(detail.render(route.props), 'RealPostCard').props.post;
  assert.equal(rendered.likedByMe, true);
  assert.equal(rendered.likeCount, 1);
  assert.equal(rendered.commentCount, 2);
  detail.unmount(); app.unmount();
});

test('detail refresh keeps the comment draft mounted, hides it pending access checks and drops it on revocation', async () => {
  const visiblePost = { ...post, commentsEnabled: true };
  const checks = [];
  const detail = renderer(detailSource, 'PostDetail', {
    observeEngagement: () => () => {},
    apiRequest: (path) => {
      assert.equal(path, `posts/${post.id}`);
      return new Promise((resolve, reject) => checks.push({ resolve, reject }));
    },
  });
  const props = { postId: post.id, user: account, revision: 0 };
  detail.render(props); detail.flushEffects();
  checks[0].resolve({ data: visiblePost }); await setImmediate();
  const original = nodePath(detail.render(props), 'PostComments');
  assert.ok(original);

  props.revision += 1;
  detail.render(props); detail.flushEffects();
  const refreshing = nodePath(detail.render(props), 'PostComments');
  assert.ok(refreshing, 'permission refresh should preserve the mounted comment form');
  assert.deepEqual(refreshing.map(({ type, props }) => [type, props.key]), original.map(({ type, props }) => [type, props.key]));
  assert.ok(refreshing.some((node) => node.props.hidden), 'comments must be hidden while access is rechecked');

  checks[1].resolve({ data: { ...visiblePost } }); await setImmediate();
  const accepted = nodePath(detail.render(props), 'PostComments');
  assert.ok(accepted);
  assert.ok(!accepted.some((node) => node.props.hidden));

  props.revision += 1;
  detail.render(props); detail.flushEffects();
  checks[2].reject(Object.assign(new Error('Unavailable'), { status: 404 })); await setImmediate();
  const revoked = detail.render(props);
  assert.equal(nodePath(revoked, 'PostComments'), null);
  assert.equal(nodePath(revoked, 'RealPostCard'), null);
  assert.ok(nodes(revoked).some((node) => node.props.role === 'alert'));
  detail.unmount();
});

test('private comment rows and draft stay hidden after a failed refresh until access is verified again', async () => {
  const reads = [];
  let lost = 0;
  const view = renderer(commentsSource, 'PostComments', {
    URLSearchParams, characterCount, formatPostDate: () => 'now', notifyEngagement() {},
    apiRequest: (path) => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
  });
  const comment = { id: 'comment-a', author: account, text: 'Previously loaded private comment', canManage: true, version: 0 };
  const props = { post: { ...post, commentsEnabled: true }, user: account, refreshKey: 0, onAccessLost: () => { lost += 1; } };
  const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && node.children.includes(label));
  const firstPage = (row) => ({ data: [row], meta: { commentCount: 1, hasMore: true, nextCursor: 'next' } });
  view.render(props); view.flushEffects();
  reads[0].resolve(firstPage(comment)); await setImmediate();
  button(view.render(props), 'Edit').props.onClick();
  input(view.render(props), 'textarea').props.onChange({ target: { value: 'Unsaved private edit' } });

  const more = button(view.render(props), 'Load more comments').props.onClick();
  reads[1].reject(Object.assign(new Error('Unavailable'), { status: 503 })); await more;
  assert.ok(input(view.render(props), 'li'), 'a pagination failure preserves the verified page');

  props.refreshKey += 1;
  let tree = view.render(props);
  assert.equal(input(tree, 'li'), undefined);
  assert.equal(input(tree, 'textarea'), undefined);
  view.flushEffects();
  reads[2].reject(Object.assign(new Error('Unavailable'), { status: 503 })); await setImmediate();
  tree = view.render(props);
  assert.equal(input(tree, 'li'), undefined);
  assert.equal(input(tree, 'textarea'), undefined);
  const retry = button(tree, 'Try again').props.onClick();
  assert.ok(!reads[3].path.includes('cursor='));
  reads[3].resolve(firstPage({ ...comment, text: 'Fresh private comment' })); await retry;
  tree = view.render(props);
  assert.ok(nodes(tree).some((node) => node.type === 'p' && node.children.includes('Fresh private comment')));
  assert.equal(input(tree, 'textarea').props.value, 'Unsaved private edit');

  const denied = button(tree, 'Load more comments').props.onClick();
  reads[4].reject(Object.assign(new Error('Unavailable'), { status: 404 })); await denied;
  assert.equal(lost, 1);
  assert.equal(input(view.render(props), 'li'), undefined);
  view.unmount();
});

test('like controls serialize writes, use the current account, and publish the server response', async () => {
  const calls = [];
  const summaries = [];
  let lost = 0;
  const reactions = renderer(reactionsSource, 'PostReactions', {
    pendingLikes: engagement().pendingLikes,
    notifyEngagement: (...args) => summaries.push(args),
    apiRequest: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
  });
  const props = { post, user: account, detail: true, onAccessLost: () => { lost += 1; } };
  let control = input(reactions.render(props), 'button'); reactions.flushEffects();
  assert.equal(control.props['aria-pressed'], false);
  const liking = control.props.onClick();
  await control.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `posts/${post.id}/like`);
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.accountId, account.id);
  assert.equal(input(reactions.render(props), 'button').props.disabled, true);
  const response = { likedByMe: true, likeCount: 3 };
  calls[0].resolve({ data: response }); await liking;
  assert.deepEqual(summaries, [[account.id, post.id, response]]);

  control = input(reactions.render({ ...props, post: { ...post, ...response } }), 'button');
  assert.equal(control.props['aria-pressed'], true);
  const unliking = control.props.onClick();
  assert.equal(calls[1].options.method, 'DELETE');
  calls[1].reject(Object.assign(new Error('Unavailable'), { status: 404 })); await unliking;
  assert.equal(lost, 1);
  assert.equal(summaries.length, 1);
  reactions.unmount();
});

test('a committed like survives Back and a committed unlike survives tab refresh', async (t) => {
  for (const back of [true, false]) {
    await t.test(back ? 'Back from detail' : 'tab focus refresh', async () => {
      const app = await application(back ? `/p/${post.id}` : '/');
      const events = engagement();
      const previous = { ...post, likedByMe: !back, likeCount: back ? 0 : 1 };
      const reads = [];
      const feed = renderer(feedSource, 'PostFeed', {
        ...events, URLSearchParams,
        apiRequest: () => new Promise((resolve) => reads.push(resolve)),
      });
      const renderFeed = () => {
        const home = input(app.render(), 'HomePage');
        return feed.render({ user: account, revision: home.props.postRevision });
      };
      renderFeed(); feed.flushEffects();
      reads[0]({ data: [previous] }); await setImmediate();

      let complete;
      const apiRequest = (path, options) => {
        assert.equal(path, `posts/${post.id}/like`);
        assert.equal(options.method, back ? 'PUT' : 'DELETE');
        assert.equal(options.accountId, account.id);
        assert.equal(options.signal, undefined);
        return new Promise((resolve) => { complete = resolve; });
      };
      const original = renderer(reactionsSource, 'PostReactions', { ...events, apiRequest });
      const button = (view, data) => input(view.render({ post: data, user: account }), 'button');
      const control = button(original, previous); original.flushEffects();
      const writing = control.props.onClick();

      if (back) {
        input(app.render(), 'PostDetail').props.onBack();
        assert.equal(input(app.render(), 'PostDetail'), undefined);
      } else {
        app.browser.dispatchEvent(new Event('focus')); await setImmediate();
        renderFeed(); feed.flushEffects();
        assert.equal(input(renderFeed(), 'RealPostCard'), undefined);
        reads[1]({ data: [previous] }); await setImmediate();
      }
      original.unmount();
      const replacement = renderer(reactionsSource, 'PostReactions', { ...events, apiRequest });
      const before = input(renderFeed(), 'RealPostCard').props.post;
      assert.equal(before.likedByMe, !back);
      assert.equal(button(replacement, before).props.disabled, true);
      replacement.flushEffects();

      complete({ data: { likedByMe: back, likeCount: back ? 1 : 0 } }); await writing;
      const after = input(renderFeed(), 'RealPostCard').props.post;
      assert.equal(after.likeCount, back ? 1 : 0);
      const updated = button(replacement, after);
      assert.equal(updated.props['aria-pressed'], back);
      assert.equal(updated.props.disabled, false);
      replacement.unmount(); feed.unmount(); app.unmount();
    });
  }
});

test('caption and hashtag drafts remain mounted through tab focus refreshes on every post surface', async (t) => {
  for (const path of ['/', '/profile', '/u/' + account.id, '/p/' + post.id]) {
    await t.test(path, async () => {
      const app = await application(path);
      const before = app.render();
      assert.equal(before.type, providerType);
      // This may be an older post from a later loaded feed page. The editor
      // must survive even when a fresh first page no longer contains its card.
      before.props.value(post);
      const opened = app.render();
      const original = editorNode(opened);
      assert.ok(original);
      assert.ok(opened.children.includes(original), 'the editor must be outside refreshable page/feed children');
      const draft = renderer(cardSource, 'EditPost', { apiRequest: async () => assert.fail('focus must not save a draft') });
      let form = draft.render(original.props); draft.flushEffects();
      input(form, 'textarea').props.onChange({ target: { value: 'My unsaved caption after copying text' } });
      input(form, 'input').props.onChange({ target: { value: 'draft tags' } });
      const priorRevision = nodes(opened).find((node) => node.type === 'HomePage').props.postRevision;
      app.browser.dispatchEvent(new Event('focus'));
      await setImmediate();
      const refreshed = app.render(); app.flushEffects();
      const retained = editorNode(refreshed);
      assert.ok(retained, 'a background refresh must not unmount the active edit session');
      assert.equal(retained.type, original.type);
      assert.equal(retained.props.key, original.props.key);
      assert.equal(retained.props.post, original.props.post);
      assert.equal(nodes(refreshed).find((node) => node.type === 'HomePage').props.postRevision, priorRevision + 1,
        'permission/data refresh must still run while the independent editor remains mounted');
      form = draft.render(retained.props); draft.flushEffects();
      assert.equal(input(form, 'textarea').props.value, 'My unsaved caption after copying text');
      assert.equal(input(form, 'input').props.value, 'draft tags');
      draft.unmount(); app.unmount();
    });
  }
});

test('focus refresh keeps the original edit version so a competing save cannot be silently overwritten', async () => {
  const app = await application('/p/' + post.id);
  app.render().props.value(post);
  const original = editorNode(app.render());
  const writes = [];
  const draft = renderer(cardSource, 'EditPost', {
    apiRequest: async (path, options) => {
      assert.equal(path, 'posts/' + post.id);
      writes.push(options.body);
      // Another tab has now committed version 4.
      throw Object.assign(new Error('This post changed elsewhere.'), { status: 409, code: 'VERSION_CONFLICT' });
    },
  });
  let form = draft.render(original.props); draft.flushEffects();
  input(form, 'textarea').props.onChange({ target: { value: 'My unsaved work' } });
  app.browser.dispatchEvent(new Event('focus')); await setImmediate();
  const retained = editorNode(app.render()); app.flushEffects();
  assert.equal(retained.props.post.version, 3);
  form = draft.render(retained.props);
  await input(form, 'form').props.onSubmit({ preventDefault() {} });
  form = draft.render(retained.props);
  assert.equal(writes[0].expectedVersion, 3);
  assert.equal(writes[0].caption, 'My unsaved work');
  assert.equal(input(form, 'textarea').props.value, 'My unsaved work');
  assert.equal(input(form, 'fieldset').props.disabled, true);
  assert.ok(nodes(form).some((node) => node.props.role === 'alert'));
  assert.ok(editorNode(app.render()), 'a conflict must preserve the draft until an explicit close/reload');
  draft.unmount(); app.unmount();
});

test('an account switch clears the active editor and never restores another account draft', async () => {
  const app = await application();
  app.render().props.value(post);
  assert.ok(editorNode(app.render()));
  app.setAccount({ ...account, id: '507f1f77bcf86cd799439013', username: 'bob' });
  app.browser.dispatchEvent(new Event('focus')); await setImmediate();
  let tree = app.render();
  assert.equal(editorNode(tree), undefined, 'the old account editor must disappear before cleanup effects');
  app.flushEffects();
  app.setAccount(account);
  app.browser.dispatchEvent(new Event('focus')); await setImmediate();
  tree = app.render(); app.flushEffects();
  assert.equal(editorNode(tree), undefined);
  app.unmount();
});

test('restricted accounts and non-owner cards cannot expose an active edit session', async () => {
  const app = await application();
  app.render().props.value({ ...post, author: { id: '507f1f77bcf86cd799439013' } });
  assert.equal(editorNode(app.render()), undefined);
  app.render().props.value({ ...post, canManage: false });
  assert.equal(editorNode(app.render()), undefined);
  app.render().props.value(post);
  assert.ok(editorNode(app.render()));
  app.setAccount({ ...account, status: 'suspended' });
  app.browser.dispatchEvent(new Event('focus')); await setImmediate();
  assert.equal(editorNode(app.render()), undefined);
  app.unmount();
});

test('comment retry retains its key and stale edits preserve their draft without overwriting', async () => {
  const calls = [];
  const summaries = [];
  let comments = [];
  const created = {
    id: 'comment-a', author: account, text: 'First comment', canManage: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 0,
  };
  const view = renderer(commentsSource, 'PostComments', {
    URLSearchParams, characterCount, formatPostDate: () => 'Jan 1, 2026',
    crypto: { randomUUID },
    notifyEngagement: (...args) => summaries.push(args),
    apiRequest: async (path, options) => {
      calls.push({ path, options });
      if (!options.method) return { data: comments, meta: { commentCount: comments.length } };
      assert.equal(options.accountId, account.id);
      if (options.method === 'POST') {
        if (calls.filter((call) => call.options.method === 'POST').length === 1) {
          throw Object.assign(new Error('Response timed out'), { name: 'TimeoutError' });
        }
        comments = [created];
        return { data: created, meta: { commentCount: 1 } };
      }
      if (options.method === 'PATCH') {
        assert.equal(options.body.expectedVersion, created.version);
        comments = [{ ...created, text: 'Edited elsewhere', version: 1 }];
        throw Object.assign(new Error('Stale version'), { code: 'VERSION_CONFLICT' });
      }
      assert.equal(options.method, 'DELETE');
      comments = [];
      return { data: { commentCount: 0 } };
    },
  });
  const props = { post, user: account, refreshKey: 1 };
  const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && node.children.includes(label));
  const submit = (tree) => input(tree, 'form').props.onSubmit({ preventDefault() {} });
  const type = (tree, value) => input(tree, 'textarea').props.onChange({ target: { value } });

  view.render(props); view.flushEffects(); await setImmediate();
  type(view.render(props), '  First comment  ');
  await submit(view.render(props));
  assert.equal(input(view.render(props), 'textarea').props.value, '  First comment  ');
  await submit(view.render(props));
  assert.equal(calls[1].options.body.text, 'First comment');
  assert.equal(calls[1].options.headers['Idempotency-Key'], calls[2].options.headers['Idempotency-Key']);
  assert.equal(input(view.render(props), 'textarea').props.value, '');
  assert.equal(summaries.at(-1)[2].commentCount, 1);

  button(view.render(props), 'Edit').props.onClick();
  type(view.render(props), 'Keep this edit draft');
  await submit(view.render(props)); await setImmediate();
  const conflict = view.render(props);
  assert.equal(input(conflict, 'textarea').props.value, 'Keep this edit draft');
  assert.equal(button(conflict, 'Save comment').props.disabled, true);
  button(conflict, 'Cancel edit').props.onClick();
  button(view.render(props), 'Delete').props.onClick();
  await button(view.render(props), 'Delete comment').props.onClick();
  assert.equal(input(view.render(props), 'li'), undefined);
  assert.equal(summaries.at(-1)[2].commentCount, 0);
  view.unmount();
});
