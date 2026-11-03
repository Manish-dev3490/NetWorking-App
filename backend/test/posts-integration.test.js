import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { migrateAuth } from '../src/migrations/001-auth.js';
import { migratePosts } from '../src/migrations/002-posts.js';
import { migrateEngagement } from '../src/migrations/004-engagement.js';
import { migrateSavedPosts } from '../src/migrations/005-saved-posts.js';
import { migrateNotifications } from '../src/migrations/006-notifications.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createPostService } from '../src/modules/posts/service.js';

const fails = (status, code) => (error) => error.status === status && error.code === code;
const objectId = (value) => new mongoose.Types.ObjectId(value);
const binaryBytes = (value) => Buffer.isBuffer(value) ? value : Buffer.from(value.value());

test('real MongoDB photo storage, publication, visibility and cleanup lifecycle', {
  skip: !process.env.TEST_MONGODB_URI && 'Set TEST_MONGODB_URI to run isolated MongoDB photo-post integration tests.',
  timeout: 180_000,
}, async (t) => {
  const databaseName = `gather_posts_test_${randomBytes(8).toString('hex')}`;
  const connection = mongoose.createConnection();
  t.after(async () => {
    try {
      if (connection.readyState === 1) {
        assert.match(databaseName, /^gather_posts_test_[a-f0-9]{16}$/);
        assert.equal(connection.db.databaseName, databaseName);
        await connection.dropDatabase();
      }
    } finally { await connection.close(); }
  });
  // Every write and the final drop target this random database, never the URI's database.
  await connection.openUri(process.env.TEST_MONGODB_URI, {
    dbName: databaseName, maxPoolSize: 3, autoCreate: false, autoIndex: false,
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
  });
  await migrateAuth(connection);
  await migratePosts(connection);
  await migratePosts(connection);
  await migrateEngagement(connection);
  await migrateSavedPosts(connection);
  await migrateNotifications(connection);
  let currentTime = new Date();
  const service = createPostService({ connection, now: () => new Date(currentTime), cursorSecret: 'posts-integration-cursor-secret' });
  const auth = createAuthService({ connection });
  const password = 'a photo integration test password';
  const alice = (await auth.register({ email: 'alice@example.com', username: 'alice', displayName: 'Alice', password })).user;
  const bob = (await auth.register({ email: 'bob@example.com', username: 'bob', displayName: 'Bob', password })).user;
  const users = connection.db.collection('users');
  const posts = connection.db.collection('posts');
  const assets = connection.db.collection('media_assets');
  const images = connection.db.collection('media_images');
  const photoBytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#7d9d80' } }).webp().toBuffer();
  const otherBytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#a58b72' } }).webp().toBuffer();
  const imageInput = (overrides = {}) => ({ data: photoBytes, contentType: 'image/webp', width: 4, height: 3, uploadKey: randomUUID(), ...overrides });
  const upload = (viewer, overrides) => service.uploadImage(viewer, imageInput(overrides));
  let firstAsset;
  let firstPost;
  let firstKey;
  let firstInput;
  let racePost;

  await t.test('uploads persist bounded binary bytes separately from metadata and support safe retry keys', async () => {
    const key = randomUUID();
    firstAsset = await upload(alice, { uploadKey: key });
    assert.equal(firstAsset.status, 'ready');
    assert.equal(firstAsset.contentUrl, `/api/v1/media/${firstAsset.id}/content`);
    assert.equal(firstAsset.sizeBytes, photoBytes.length);
    assert.equal(firstAsset.data, undefined);
    const metadata = await assets.findOne({ _id: objectId(firstAsset.id) });
    const binary = await images.findOne({ _id: objectId(firstAsset.id) });
    assert.equal(metadata.ownerId.toString(), alice.id);
    assert.equal(metadata.state, 'ready');
    assert.equal(metadata.data, undefined);
    assert.deepEqual(binaryBytes(binary.data), photoBytes);
    const replay = await upload(alice, { uploadKey: key });
    assert.equal(replay.id, firstAsset.id);
    assert.equal(await images.countDocuments(), 1);
    await assert.rejects(upload(alice, { uploadKey: key, data: otherBytes }), fails(409, 'IDEMPOTENCY_CONFLICT'));
    assert.equal(await images.countDocuments(), 1);
  });

  await t.test('unpublished photos are owner-only and publication cannot claim another account asset', async () => {
    assert.deepEqual((await service.getImage(alice, firstAsset.id)).data, photoBytes);
    await assert.rejects(service.getImage(bob, firstAsset.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.publish(bob, { media: [{ assetId: firstAsset.id }] }, randomUUID()), fails(409, 'ASSET_NOT_READY'));
    assert.equal(await posts.countDocuments(), 0);
    await assert.rejects(service.publish(alice, { media: [{ assetId: firstAsset.id }, { assetId: firstAsset.id }] }, randomUUID()), fails(422, 'VALIDATION_ERROR'));
  });

  await t.test('publication atomically attaches owned photos and returns metadata without private fields or bytes', async () => {
    firstKey = randomUUID();
    firstInput = { caption: '  Our first moment  ', hashtags: ['Moments', 'moments'], media: [{ assetId: firstAsset.id, altText: 'A small green photo' }] };
    const result = await service.publish(alice, firstInput, firstKey);
    firstPost = result.post;
    assert.equal(result.replayed, false);
    assert.equal(firstPost.author.id, alice.id);
    assert.equal(firstPost.author.email, undefined);
    assert.equal(firstPost.caption, 'Our first moment');
    assert.deepEqual(firstPost.hashtags, ['moments']);
    assert.equal(firstPost.canManage, true);
    assert.equal(firstPost.media[0].assetId, firstAsset.id);
    assert.equal(firstPost.media[0].data, undefined);
    assert.equal(firstPost.requestHash, undefined);
    const attached = await assets.findOne({ _id: objectId(firstAsset.id) });
    assert.equal(attached.state, 'attached');
    assert.equal(attached.postId.toString(), firstPost.id);
    assert.equal((await service.getPost(bob, firstPost.id)).canManage, false);
    assert.deepEqual((await service.getImage(bob, firstAsset.id)).data, photoBytes);
  });

  await t.test('publish retries replay once, reject changed payloads and never create duplicate posts', async () => {
    const replay = await service.publish(alice, firstInput, firstKey);
    assert.equal(replay.replayed, true);
    assert.equal(replay.post.id, firstPost.id);
    await assert.rejects(service.publish(alice, { ...firstInput, caption: 'Different caption' }, firstKey), fails(409, 'IDEMPOTENCY_CONFLICT'));
    assert.equal(await posts.countDocuments(), 1);
    await assert.rejects(service.publish(alice, firstInput, randomUUID()), fails(409, 'ASSET_NOT_READY'));
  });

  await t.test('concurrent publications cannot attach one image to two posts', async () => {
    const asset = await upload(alice);
    const input = { media: [{ assetId: asset.id }], caption: 'One owner, one attachment' };
    const results = await Promise.allSettled([
      service.publish(alice, input, randomUUID()), service.publish(alice, input, randomUUID()),
    ]);
    const success = results.filter((result) => result.status === 'fulfilled');
    assert.equal(success.length, 1);
    racePost = success[0].value.post;
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.equal(failure.status, 409);
    assert.equal(failure.code, 'ASSET_NOT_READY');
    assert.equal(await posts.countDocuments({ 'media.assetId': objectId(asset.id), status: 'published' }), 1);
    assert.equal((await assets.findOne({ _id: objectId(asset.id) })).postId.toString(), racePost.id);
  });

  await t.test('only the owner can modify a post and stale versions cannot overwrite a newer caption', async () => {
    await assert.rejects(service.updatePost(bob, firstPost.id, { expectedVersion: firstPost.version, caption: 'Not mine' }), fails(403, 'FORBIDDEN'));
    await assert.rejects(service.deletePost(bob, firstPost.id), fails(403, 'FORBIDDEN'));
    const updated = await service.updatePost(alice, firstPost.id, { expectedVersion: firstPost.version, caption: 'An updated moment' });
    assert.equal(updated.caption, 'An updated moment');
    assert.equal(updated.version, firstPost.version + 1);
    await assert.rejects(service.updatePost(alice, firstPost.id, { expectedVersion: firstPost.version, caption: 'An old editor' }), fails(409, 'VERSION_CONFLICT'));
    assert.equal((await service.getPost(bob, firstPost.id)).caption, 'An updated moment');
    await assert.rejects(service.updatePost(alice, firstPost.id, { expectedVersion: updated.version, authorId: bob.id }), fails(422, 'VALIDATION_ERROR'));
  });

  await t.test('post and photo reads recheck current author privacy and active status', async () => {
    await users.updateOne({ _id: objectId(alice.id) }, { $set: { visibility: 'private' } });
    await assert.rejects(service.getPost(bob, firstPost.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.getImage(bob, firstAsset.id), fails(404, 'NOT_FOUND'));
    assert.equal((await service.getPost(alice, firstPost.id)).id, firstPost.id);
    assert.deepEqual((await service.getImage(alice, firstAsset.id)).data, photoBytes);
    assert.ok((await service.listOwn(alice, { limit: 10 })).items.some((post) => post.id === firstPost.id));
    assert.equal((await service.listRecent(bob, { limit: 10 })).items.some((post) => post.author.id === alice.id), false);
    await users.updateOne({ _id: objectId(alice.id) }, { $set: { status: 'suspended' } });
    await assert.rejects(service.getPost(bob, firstPost.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.getImage(bob, firstAsset.id), fails(404, 'NOT_FOUND'));
    await users.updateOne({ _id: objectId(alice.id) }, { $set: { visibility: 'public', status: 'active' } });
  });

  await t.test('expired unattached photos cannot publish and orphan cleanup removes metadata with its bytes', async () => {
    const orphan = await upload(alice);
    const priorTime = currentTime;
    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000 + 1);
    await assert.rejects(service.getImage(alice, orphan.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.publish(alice, { media: [{ assetId: orphan.id }] }, randomUUID()), fails(409, 'ASSET_NOT_READY'));
    const cleanup = await service.cleanupOrphans();
    assert.ok(cleanup.removed >= 1);
    assert.equal(await assets.findOne({ _id: objectId(orphan.id) }), null);
    assert.equal(await images.findOne({ _id: objectId(orphan.id) }), null);
    assert.ok(await images.findOne({ _id: objectId(firstAsset.id) }));
    currentTime = priorTime;
  });

  await t.test('cursor pagination has no repeats and is bound to route and viewer', async () => {
    for (let index = 0; index < 3; index += 1) {
      const asset = await upload(alice);
      await service.publish(alice, { caption: `Another moment ${index}`, media: [{ assetId: asset.id }] }, randomUUID());
    }
    const bobAssets = [await upload(bob), await upload(bob)];
    const bobPost = (await service.publish(bob, { caption: 'Bob post', media: bobAssets.map((asset) => ({ assetId: asset.id })) }, randomUUID())).post;
    const first = await service.listRecent(bob, { limit: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    assert.equal(typeof first.nextCursor, 'string');
    const seen = first.items.map((post) => post.id);
    let page = first;
    let count = 0;
    while (page.hasMore && count < 10) {
      page = await service.listRecent(bob, { limit: 2, cursor: page.nextCursor });
      seen.push(...page.items.map((post) => post.id)); count += 1;
    }
    assert.equal(page.hasMore, false);
    assert.equal(new Set(seen).size, seen.length);
    assert.equal(seen.length, await posts.countDocuments({ status: 'published' }));
    await assert.rejects(service.listRecent(alice, { limit: 2, cursor: first.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(service.listOwn(bob, { limit: 2, cursor: first.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(service.listRecent(bob, { limit: 2, cursor: `${first.nextCursor}tampered` }), fails(400, 'INVALID_CURSOR'));

    // Newer private candidates must not hide an older eligible public post.
    const newestPrivateAsset = await upload(alice);
    await service.publish(alice, { caption: 'A newer private candidate', media: [{ assetId: newestPrivateAsset.id }] }, randomUUID());
    await users.updateOne({ _id: objectId(alice.id) }, { $set: { visibility: 'private' } });
    const filtered = await service.listRecent(bob, { limit: 1 });
    assert.deepEqual(filtered.items.map((post) => post.id), [bobPost.id]);
    if (filtered.hasMore) {
      const remaining = await service.listRecent(bob, { limit: 1, cursor: filtered.nextCursor });
      assert.deepEqual(remaining.items, []);
      assert.equal(remaining.hasMore, false);
    }
    await users.updateOne({ _id: objectId(alice.id) }, { $set: { visibility: 'public' } });
  });

  await t.test('post deletion removes photo bytes, likes, comments and bookmarks while preserving the publish tombstone', async () => {
    const id = objectId(firstPost.id);
    const likes = connection.db.collection('post_likes');
    const comments = connection.db.collection('post_comments');
    const bookmarks = connection.db.collection('saved_posts');
    const commentKey = randomUUID();
    const commentInput = { text: 'A comment to remove' };
    const { comment } = await service.createComment(bob, firstPost.id, commentInput, commentKey);
    assert.deepEqual(await service.deleteComment(bob, firstPost.id, comment.id), { commentCount: 0 });
    await assert.rejects(service.createComment(bob, firstPost.id, commentInput, commentKey), fails(409, 'RESOURCE_DELETED'));
    await service.createComment(bob, firstPost.id, { text: 'A live comment to remove' }, randomUUID());
    await service.setLike(bob, firstPost.id, true);
    await service.setSaved(alice, firstPost.id, true);
    await service.setSaved(bob, firstPost.id, true);
    assert.equal(await likes.countDocuments({ postId: id }), 1);
    assert.equal(await comments.countDocuments({ postId: id }), 2);
    assert.equal(await bookmarks.countDocuments({ postId: id }), 2);
    assert.deepEqual((await service.listSaved(bob, {})).items.map(({ id }) => id), [firstPost.id]);
    await assert.rejects(service.removeUpload(alice, firstAsset.id), fails(409, 'ASSET_IN_USE'));
    await service.deletePost(alice, firstPost.id);
    await service.deletePost(alice, firstPost.id);
    await assert.rejects(service.getPost(bob, firstPost.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.getImage(alice, firstAsset.id), fails(404, 'NOT_FOUND'));
    assert.equal(await images.findOne({ _id: objectId(firstAsset.id) }), null);
    assert.equal(await assets.findOne({ _id: objectId(firstAsset.id) }), null);
    assert.equal(await likes.countDocuments({ postId: id }), 0);
    assert.equal(await comments.countDocuments({ postId: id }), 0);
    assert.equal(await bookmarks.countDocuments({ postId: id }), 0);
    for (const member of [alice, bob]) assert.deepEqual((await service.listSaved(member, {})).items, []);
    await assert.rejects(service.setSaved(bob, firstPost.id, true), fails(404, 'NOT_FOUND'));
    await assert.rejects(service.listComments(bob, firstPost.id, {}), fails(404, 'NOT_FOUND'));
    assert.equal((await posts.findOne({ _id: objectId(firstPost.id) })).status, 'deleted');
    await assert.rejects(service.publish(alice, firstInput, firstKey), fails(409, 'RESOURCE_DELETED'));
    assert.equal(await posts.countDocuments({ _id: objectId(firstPost.id) }), 1);
  });

  await t.test('cancelling an unattached image deletes its bytes and remains idempotent', async () => {
    const asset = await upload(bob);
    await service.removeUpload(bob, asset.id);
    await service.removeUpload(bob, asset.id);
    assert.equal(await assets.findOne({ _id: objectId(asset.id) }), null);
    assert.equal(await images.findOne({ _id: objectId(asset.id) }), null);
  });

  await t.test('concurrent uploads obey draft quotas while retries and expired-draft reclamation remain available', async () => {
    const member = (await auth.register({ email: 'quota@example.com', username: 'quota_member', displayName: 'Quota Member', password })).user;
    const retryKey = randomUUID();
    const retryAsset = await upload(member, { uploadKey: retryKey });
    for (let index = 1; index < 19; index += 1) await upload(member);
    const competing = await Promise.allSettled([upload(member), upload(member)]);
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = competing.find((result) => result.status === 'rejected').reason;
    assert.equal(rejected.status, 409);
    assert.equal(rejected.code, 'MEDIA_QUOTA_EXCEEDED');
    const ownerId = objectId(member.id);
    const quotaAssets = await assets.find({ ownerId }).toArray();
    assert.equal(quotaAssets.length, 20);
    const quotaIds = quotaAssets.map((asset) => asset._id);
    assert.equal(await images.countDocuments({ _id: { $in: quotaIds } }), 20);
    await service.assertCanUpload(member, retryKey);
    assert.equal((await upload(member, { uploadKey: retryKey })).id, retryAsset.id);
    await assert.rejects(service.assertCanUpload(member, randomUUID()), fails(409, 'MEDIA_QUOTA_EXCEEDED'));
    await assert.rejects(upload(member), fails(409, 'MEDIA_QUOTA_EXCEEDED'));

    await assets.updateMany({ ownerId }, { $set: { expiresAt: new Date(currentTime.getTime() - 1) } });
    await assert.rejects(service.assertCanUpload(member, retryKey), fails(409, 'ASSET_NOT_READY'));
    const freshKey = randomUUID();
    await service.assertCanUpload(member, freshKey);
    assert.equal(await assets.countDocuments({ ownerId }), 0);
    assert.equal(await images.countDocuments({ _id: { $in: quotaIds } }), 0);
    const fresh = await upload(member, { uploadKey: freshKey });
    assert.equal(fresh.status, 'ready');
    assert.equal(await assets.countDocuments({ ownerId }), 1);
  });
});
