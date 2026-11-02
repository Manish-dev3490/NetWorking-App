import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as postUtils from '../../frontend/src/features/posts/post-utils.js';
import { validatePublish } from '../src/modules/posts/validation.js';

const accountId = '507f1f77bcf86cd799439011';
const composerSource = (await readFile(new URL('../../frontend/src/features/posts/PostComposer.jsx', import.meta.url), 'utf8'))
  .split('  return <dialog')[0].replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export default ', '');
const jsonBytes = (body) => Buffer.byteLength(JSON.stringify(body));

function maximumBody() {
  return {
    caption: '😀'.repeat(2200),
    hashtags: Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x10428).repeat(48) + String.fromCodePoint(0x10428 + index)),
    media: Array.from({ length: 10 }, (_, index) => ({ assetId: (index + 1).toString(16).padStart(24, '0'), altText: '😀'.repeat(500) })),
  };
}

function boundaryBody() {
  const body = maximumBody();
  const caption = [...body.caption];
  // Keep valid per-field lengths while including text whose JSON representation
  // requires escaping. Replace enough four-byte emoji to fit the API exactly.
  caption.splice(-3, 3, '\n', '"', '\\');
  body.caption = caption.join('');
  const excess = jsonBytes(body) - 32768;
  const asciiCount = Math.floor(excess / 3);
  caption.fill('a', 0, asciiCount);
  if (excess % 3) caption[asciiCount] = excess % 3 === 1 ? '€' : 'é';
  body.caption = caption.join('');
  return body;
}

// Exercise the component's real async submit action with persistent hook state
// and refs, including a rerender between an uncertain result and its retry.
function composer(body, { caption = body.caption, tags = body.hashtags.join(' '), publish } = {}) {
  const photos = body.media.map((media, index) => ({
    key: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`,
    file: { assetId: media.assetId, type: 'image/png', size: 1 },
    preview: `blob:photo-${index}`, altText: media.altText,
  }));
  const states = [photos, caption, tags, '', '', false, false, false];
  const refs = [];
  const uploads = [];
  const publications = [];
  const published = [];
  let stateIndex;
  let refIndex;
  const create = runInNewContext(`${composerSource}\nreturn { submit };\n}\nPostComposer`, {
    ...postUtils,
    AbortController,
    crypto: { randomUUID },
    useEffect() {},
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    describeError: (error) => error.message,
    discardImage: async () => assert.fail('submission must not discard its images'),
    uploadImage: async (...args) => {
      uploads.push(args);
      return { data: { id: args[0].assetId } };
    },
    publishPost: async (...args) => {
      publications.push(args);
      return publish ? publish(...args) : { data: { id: 'published-post' } };
    },
  });
  return {
    states, photos, uploads, publications, published,
    async submit() {
      stateIndex = 0; refIndex = 0;
      const actions = create({ user: { id: accountId }, onClose() {}, onPublished: (post) => published.push(post) });
      await actions.submit({ preventDefault() {} });
    },
  };
}

test('the payload budget includes UTF-8 and JSON escaping and accepts exactly 32 KiB', () => {
  assert.equal(postUtils.MAX_POST_PAYLOAD_BYTES, 32768);
  const body = boundaryBody();
  validatePublish(body);
  assert.equal(postUtils.validatePostFields(body.caption, body.hashtags), '');
  assert.ok(body.caption.includes('\n') && body.caption.includes('"') && body.caption.includes('\\'));
  assert.equal(jsonBytes(body), 32768);
  assert.ok(JSON.stringify(body).length < 32768, 'UTF-16 string length is not the transport byte count');
  assert.equal(postUtils.validatePostPayload(body), '');

  const oversized = { ...body, caption: body.caption.replace('a', 'é') };
  validatePublish(oversized);
  assert.equal(jsonBytes(oversized), 32769);
  assert.match(postUtils.validatePostPayload(oversized), /shorten.+caption.+hashtags.+photo descriptions/i);
});

test('an oversized Unicode post stops before uploads and publishes after its draft is shortened', async () => {
  const body = maximumBody();
  validatePublish(body);
  assert.equal(postUtils.validatePostFields(body.caption, body.hashtags), '');
  assert.equal(body.hashtags.join(' ').length, 1979);
  assert.equal(jsonBytes(body), 33337);
  const state = composer(body);
  await state.submit();
  assert.equal(state.uploads.length, 0);
  assert.equal(state.publications.length, 0);
  assert.equal(state.published.length, 0);
  assert.match(state.states[3], /shorten.+caption.+hashtags.+photo descriptions/i);
  assert.equal(state.states[5], false, 'the editable draft must not become pending');

  state.states[1] = 'A shorter caption';
  await state.submit();
  assert.equal(state.uploads.length, 10);
  assert.equal(state.publications.length, 1);
  assert.equal(state.publications[0][0].caption, 'A shorter caption');
  assert.equal(state.publications[0][0].media.length, 10);
  assert.equal(state.published[0].id, 'published-post');
  assert.equal(state.states[3], '');
});

test('an exact-budget normalized post uploads every photo and publishes the same fields in order', async () => {
  const body = boundaryBody();
  const caption = ` \t${body.caption.normalize('NFD')}\n `;
  const tags = body.hashtags.map((tag) => `#${tag.toUpperCase()}`).join(' ');
  assert.ok(caption.length <= 4400 && tags.length <= 2000);
  assert.ok(jsonBytes({ ...body, caption }) > 32768, 'normalization must precede the budget check');
  const state = composer(body, { caption, tags });
  await state.submit();
  assert.equal(state.uploads.length, 10);
  for (let index = 0; index < state.uploads.length; index += 1) {
    const [file, owner, uploadKey, signal] = state.uploads[index];
    assert.equal(file, state.photos[index].file);
    assert.equal(owner, accountId);
    assert.equal(uploadKey, state.photos[index].key);
    assert.equal(signal.aborted, false);
  }
  assert.equal(state.publications.length, 1);
  const [actual, owner, publishKey, signal] = state.publications[0];
  assert.equal(JSON.stringify(actual), JSON.stringify(body));
  assert.equal(jsonBytes(actual), 32768);
  assert.equal(owner, accountId);
  assert.match(publishKey, /^[0-9a-f-]{36}$/);
  assert.equal(signal.aborted, false);
  assert.equal(state.published[0].id, 'published-post');
  assert.equal(state.states[3], '');
});

test('an uncertain publish retry keeps its original payload and key without uploading again', async () => {
  let attempts = 0;
  const body = { caption: 'Original moment', hashtags: ['moments'], media: [{ assetId: '507f1f77bcf86cd799439012', altText: 'Original photo description' }] };
  const state = composer(body, {
    publish: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('Outcome unknown'), { status: 503 });
      return { data: { id: 'one-published-post' } };
    },
  });
  await state.submit();
  assert.equal(state.states[7], true);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.publications.length, 1);
  const [originalPayload, originalOwner, originalKey] = state.publications[0];
  // A later render must continue the pending request snapshot rather than
  // constructing a different body from form state.
  state.states[1] = 'A newer draft value';
  state.states[2] = 'different';
  await state.submit();
  assert.equal(state.uploads.length, 1);
  assert.equal(state.publications.length, 2);
  const [retriedPayload, owner, key] = state.publications[1];
  assert.equal(retriedPayload, originalPayload);
  assert.equal(JSON.stringify(retriedPayload), JSON.stringify(body));
  assert.equal(owner, originalOwner);
  assert.equal(key, originalKey);
  assert.equal(state.published[0].id, 'one-published-post');
});
