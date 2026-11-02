import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describeError } from '../../frontend/src/features/auth/form-utils.js';
import { countCharacters, normalizedTags, validatePostFields } from '../../frontend/src/features/posts/post-utils.js';

const account = { id: '507f1f77bcf86cd799439011', username: 'alice', displayName: 'Alice', status: 'active' };
const post = {
  id: '507f1f77bcf86cd799439012', author: { id: account.id, displayName: account.displayName },
  caption: 'The saved caption', hashtags: ['original'], media: [], canManage: true, version: 3,
};
const source = await readFile(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const cardSource = await readFile(new URL('../../frontend/src/features/posts/RealPostCard.jsx', import.meta.url), 'utf8');
const providerType = 'PostEditorProvider';
const componentTypes = ['HomePage', 'AuthPage', 'ProfilePage', 'Icon', 'PostComposer', 'PostDetail',
  'MemberSearch', 'MemberProfile', 'FollowRequests', 'EditPost', 'Avatar'];

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
  browser.history = { replaceState() {}, pushState() {} };
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
