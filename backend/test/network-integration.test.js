import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { migrateAuth } from '../src/migrations/001-auth.js';
import { migratePosts } from '../src/migrations/002-posts.js';
import { migrateNetwork } from '../src/migrations/003-network.js';
import { migrateEngagement } from '../src/migrations/004-engagement.js';
import { migrateSavedPosts } from '../src/migrations/005-saved-posts.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createNetworkService } from '../src/modules/network/service.js';
import { createPostService } from '../src/modules/posts/service.js';

const fails = (status, code) => (error) => error.status === status && error.code === code;
const objectId = (value) => new mongoose.Types.ObjectId(value);

test('real MongoDB profiles, member search, follow requests, Following feed and private media lifecycle', {
  skip: !process.env.TEST_MONGODB_URI && 'Set TEST_MONGODB_URI to run isolated MongoDB networking integration tests.',
  timeout: 180_000,
}, async (t) => {
  const databaseName = `gather_network_test_${randomBytes(8).toString('hex')}`;
  const connection = mongoose.createConnection();
  t.after(async () => {
    try {
      if (connection.readyState === 1) {
        assert.match(databaseName, /^gather_network_test_[a-f0-9]{16}$/);
        assert.equal(connection.db.databaseName, databaseName);
        await connection.dropDatabase();
      }
    } finally { await connection.close(); }
  });
  // All writes and cleanup target this unique database, never the URI's app DB.
  await connection.openUri(process.env.TEST_MONGODB_URI, {
    dbName: databaseName, maxPoolSize: 3, autoCreate: false, autoIndex: false,
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
  });
  await migrateAuth(connection);
  await migratePosts(connection);
  await migrateNetwork(connection);
  await migrateNetwork(connection);
  await migrateEngagement(connection);
  await migrateEngagement(connection);
  assert.equal((await migrateSavedPosts(connection)).applied, true);
  assert.equal((await migrateSavedPosts(connection)).applied, false);
  let currentTime = new Date();
  const now = () => new Date(currentTime);
  const network = createNetworkService({ connection, now, cursorSecret: 'network-integration-cursor-secret' });
  const posts = createPostService({ connection, now, cursorSecret: 'network-integration-post-secret' });
  const auth = createAuthService({ connection, now });
  const password = 'a networking integration test password';
  const register = (username, displayName) => auth.register({ email: `${username}@example.com`, username, displayName, password });
  const owner = await register('private_member', 'Private Member');
  const viewer = await register('viewer_member', 'Viewer Member');
  const outsider = await register('outsider_member', 'Outside Member');
  const publicMember = await register('public_member', 'Public Member');
  owner.user = await auth.updateProfile(owner.token, { visibility: 'private', bio: 'A private biography' }, owner.user.id);
  const users = connection.db.collection('users');
  const follows = connection.db.collection('follows');
  const assets = connection.db.collection('media_assets');
  const images = connection.db.collection('media_images');
  const photoBytes = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#6b8b70' } }).webp().toBuffer();
  const upload = (member, purpose = 'post', key = randomUUID()) => posts.uploadImage(member.user ?? member, {
    data: photoBytes, contentType: 'image/webp', width: 3, height: 4, uploadKey: key, purpose,
  });
  async function publish(member, caption) {
    const asset = await upload(member);
    const result = await posts.publish(member.user, { caption, media: [{ assetId: asset.id, altText: `${caption} photo` }] }, randomUUID());
    return { post: result.post, asset };
  }
  const privateMoment = await publish(owner, 'A private moment');
  const ownMoment = await publish(viewer, 'My own moment');
  const unrelatedMoment = await publish(outsider, 'An unrelated public moment');
  const privatePostId = privateMoment.post.id;
  let privateCommentId;
  let privateCommentCursor;
  let savedBeforePrivate;

  async function assertEngagementHidden() {
    const absentCommentId = privateCommentId ?? new mongoose.Types.ObjectId().toString();
    const calls = [
      () => posts.setLike(viewer.user, privatePostId, true),
      () => posts.setLike(viewer.user, privatePostId, false),
      () => posts.listComments(viewer.user, privatePostId, { cursor: privateCommentCursor }),
      () => posts.createComment(viewer.user, privatePostId, { text: 'Access is required' }, randomUUID()),
      () => posts.updateComment(viewer.user, privatePostId, absentCommentId, { text: 'Access is required', expectedVersion: 0 }),
      () => posts.deleteComment(viewer.user, privatePostId, absentCommentId),
    ];
    for (const call of calls) await assert.rejects(call, fails(404, 'NOT_FOUND'));
  }

  async function assertPrivateBookmarkHidden() {
    await assert.rejects(posts.setSaved(viewer.user, privatePostId, true), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.setSaved(viewer.user, privatePostId, false), fails(404, 'NOT_FOUND'));
    const page = await posts.listSaved(viewer.user, {});
    assert.ok(page.items.every(({ id }) => id !== privatePostId));
  }

  await t.test('private non-followers receive minimal profiles without biography, counts, posts or photo bytes', async () => {
    const profile = await network.getProfile(viewer.user, owner.user.id);
    assert.equal(profile.id, owner.user.id);
    assert.equal(profile.username, owner.user.username);
    assert.equal(profile.visibility, 'private');
    assert.equal(profile.canViewContent, false);
    assert.equal(profile.isSelf, false);
    assert.equal(profile.relationship.followingStatus, 'none');
    for (const field of ['bio', 'counts', 'email', 'emailNormalized', 'passwordHash', 'policyVersion', 'authVersion']) assert.equal(profile[field], undefined);
    await assert.rejects(network.listFollowers(viewer.user, owner.user.id, {}), fails(404, 'NOT_FOUND'));
    await assert.rejects(network.listFollowing(viewer.user, owner.user.id, {}), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.listUser(viewer.user, owner.user.id, {}), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.getPost(viewer.user, privateMoment.post.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.getImage(viewer.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    await assertEngagementHidden();
    await assertPrivateBookmarkHidden();
    const self = await network.getProfile(owner.user, owner.user.id);
    assert.equal(self.canViewContent, true);
    assert.equal(self.isSelf, true);
    assert.equal(self.bio, 'A private biography');
    assert.equal(self.counts.posts, 1);
  });

  await t.test('concurrent private follow retries create one pending request and never grant content access', async () => {
    const results = await Promise.all([
      network.follow(viewer.user, owner.user.id), network.follow(viewer.user, owner.user.id), network.follow(viewer.user, owner.user.id),
    ]);
    assert.ok(results.every((result) => result.status === 'pending' && result.userId === owner.user.id));
    assert.equal(await follows.countDocuments({ followerId: objectId(viewer.user.id), followingId: objectId(owner.user.id) }), 1);
    const inbox = await network.listRequests(owner.user, { limit: 10 });
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].follower.id, viewer.user.id);
    assert.equal(inbox.items[0].follower.email, undefined);
    assert.equal((await network.listRequests(outsider.user, {})).items.length, 0);
    assert.equal((await network.getProfile(viewer.user, owner.user.id)).relationship.followingStatus, 'pending');
    await assert.rejects(posts.getPost(viewer.user, privateMoment.post.id), fails(404, 'NOT_FOUND'));
    await assertEngagementHidden();
    await assertPrivateBookmarkHidden();
    await assert.rejects(network.acceptRequest(outsider.user, viewer.user.id), fails(404, 'NOT_FOUND'));
  });

  await t.test('only the target approves a request and retries or later rejection cannot duplicate or remove acceptance', async () => {
    const accepted = await network.acceptRequest(owner.user, viewer.user.id);
    assert.equal(accepted.status, 'accepted');
    assert.equal((await network.acceptRequest(owner.user, viewer.user.id)).status, 'accepted');
    await assert.rejects(network.rejectRequest(owner.user, viewer.user.id), fails(409, 'REQUEST_ALREADY_APPROVED'));
    const record = await follows.findOne({ followerId: objectId(viewer.user.id), followingId: objectId(owner.user.id) });
    assert.equal(record.status, 'accepted');
    assert.ok(record.acceptedAt instanceof Date);
    assert.equal((await network.listRequests(owner.user, {})).items.length, 0);
    const profile = await network.getProfile(viewer.user, owner.user.id);
    assert.equal(profile.canViewContent, true);
    assert.equal(profile.bio, 'A private biography');
    assert.equal(profile.counts.followers, 1);
    assert.equal(profile.relationship.followingStatus, 'accepted');
    assert.equal((await posts.getPost(viewer.user, privateMoment.post.id)).id, privateMoment.post.id);
    assert.deepEqual((await posts.getImage(viewer.user, privateMoment.asset.id)).data, photoBytes);
    assert.deepEqual((await posts.listUser(viewer.user, owner.user.id, {})).items.map((post) => post.id), [privateMoment.post.id]);
    assert.deepEqual((await network.listFollowers(viewer.user, owner.user.id, {})).items.map((user) => user.id), [viewer.user.id]);
  });

  await t.test('Following includes self and accepted private follows but excludes unrelated and public-Recent private content', async () => {
    const feed = await posts.listFollowing(viewer.user, { limit: 10 });
    assert.ok(feed.items.some((post) => post.id === ownMoment.post.id));
    assert.ok(feed.items.some((post) => post.id === privateMoment.post.id));
    assert.equal(feed.items.some((post) => post.id === unrelatedMoment.post.id), false);
    assert.equal((await posts.listRecent(viewer.user, { limit: 10 })).items.some((post) => post.id === privateMoment.post.id), false);
    const outsiderFeed = await posts.listFollowing(outsider.user, { limit: 10 });
    assert.deepEqual(outsiderFeed.items.map((post) => post.id), [unrelatedMoment.post.id]);
  });

  await t.test('Saved is private to the member and paginates newest bookmarks first with retry-safe saves', async () => {
    const ownId = ownMoment.post.id;
    const unrelatedId = unrelatedMoment.post.id;
    assert.equal((await posts.getPost(viewer.user, privatePostId)).savedByMe, false);
    assert.deepEqual(await posts.setSaved(viewer.user, ownId, true), { savedByMe: true });
    currentTime = new Date(currentTime.getTime() + 1000);
    const retries = await Promise.all([
      posts.setSaved(viewer.user, privatePostId, true), posts.setSaved(viewer.user, privatePostId, true),
    ]);
    assert.deepEqual(retries, [{ savedByMe: true }, { savedByMe: true }]);
    currentTime = new Date(currentTime.getTime() + 1000);
    await posts.setSaved(viewer.user, unrelatedId, true);
    await posts.setSaved(viewer.user, ownId, true);
    assert.equal((await posts.getPost(viewer.user, privatePostId)).savedByMe, true);
    assert.equal((await posts.getPost(owner.user, privatePostId)).savedByMe, false);
    assert.deepEqual((await posts.listSaved(owner.user, {})).items, []);

    const expected = [unrelatedId, privatePostId, ownId];
    const found = [];
    let cursor;
    for (let index = 0; index < expected.length; index += 1) {
      const page = await posts.listSaved(viewer.user, { limit: 1, cursor });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].savedByMe, true);
      found.push(page.items[0].id);
      if (index === 0) savedBeforePrivate = page.nextCursor;
      cursor = page.nextCursor;
      assert.equal(page.hasMore, index < expected.length - 1);
    }
    assert.deepEqual(found, expected);
    await assert.rejects(posts.listSaved(owner.user, { cursor: savedBeforePrivate }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(posts.listFollowing(viewer.user, { cursor: savedBeforePrivate }), fails(400, 'INVALID_CURSOR'));
    for (const [page, id] of [
      [await posts.listFollowing(viewer.user, {}), privatePostId],
      [await posts.listUser(viewer.user, owner.user.id, {}), privatePostId],
      [await posts.listRecent(viewer.user, {}), unrelatedId],
      [await posts.listOwn(viewer.user, {}), ownId],
    ]) assert.equal(page.items.find((post) => post.id === id).savedByMe, true);
  });

  await t.test('approved followers can like and unlike a private post with retry-safe counts across post views', async () => {
    function engagement({ likedByMe, likeCount, commentCount }) {
      return { likedByMe, likeCount, commentCount };
    }
    assert.deepEqual(engagement(await posts.getPost(viewer.user, privatePostId)), { likedByMe: false, likeCount: 0, commentCount: 0 });
    const likes = await Promise.all([
      posts.setLike(viewer.user, privatePostId, true),
      posts.setLike(viewer.user, privatePostId, true),
    ]);
    for (const like of likes) assert.deepEqual(like, { likedByMe: true, likeCount: 1 });
    assert.deepEqual(engagement(await posts.getPost(owner.user, privatePostId)), { likedByMe: false, likeCount: 1, commentCount: 0 });
    const feedPost = (await posts.listFollowing(viewer.user, {})).items.find(({ id }) => id === privatePostId);
    const profilePost = (await posts.listUser(viewer.user, owner.user.id, {})).items.find(({ id }) => id === privatePostId);
    for (const post of [feedPost, profilePost]) {
      assert.deepEqual(engagement(post), { likedByMe: true, likeCount: 1, commentCount: 0 });
    }
    for (const removed of await Promise.all([
      posts.setLike(viewer.user, privatePostId, false),
      posts.setLike(viewer.user, privatePostId, false),
    ])) assert.deepEqual(removed, { likedByMe: false, likeCount: 0 });
    await posts.setLike(viewer.user, privatePostId, true);
  });

  await t.test('flat comments are paginated, replay-safe and editable only by their author', async () => {
    const key = randomUUID();
    const input = { text: 'A viewer comment' };
    await assert.rejects(async () => posts.createComment(viewer.user, privatePostId, { text: '  ' }, key), fails(422, 'VALIDATION_ERROR'));
    await assert.rejects(async () => posts.createComment(viewer.user, privatePostId, { ...input, parentId: privatePostId }, key), fails(422, 'VALIDATION_ERROR'));
    const created = await posts.createComment(viewer.user, privatePostId, input, key);
    privateCommentId = created.comment.id;
    assert.equal(created.replayed, false);
    assert.equal(created.commentCount, 1);
    assert.equal(created.comment.text, input.text);
    assert.equal(created.comment.author.id, viewer.user.id);
    assert.equal(created.comment.author.email, undefined);
    assert.equal(created.comment.canManage, true);
    const replay = await posts.createComment(viewer.user, privatePostId, input, key);
    assert.equal(replay.replayed, true);
    assert.equal(replay.comment.id, privateCommentId);
    assert.equal(replay.commentCount, 1);
    await assert.rejects(posts.createComment(viewer.user, privatePostId, { text: 'Changed retry body' }, key), fails(409, 'IDEMPOTENCY_CONFLICT'));

    const edit = { text: 'An edited comment', expectedVersion: created.comment.version };
    await assert.rejects(posts.updateComment(owner.user, privatePostId, privateCommentId, edit), fails(403, 'FORBIDDEN'));
    await assert.rejects(posts.deleteComment(owner.user, privatePostId, privateCommentId), fails(403, 'FORBIDDEN'));
    const updated = await posts.updateComment(viewer.user, privatePostId, privateCommentId, edit);
    assert.equal(updated.comment.text, edit.text);
    assert.equal(updated.comment.version, edit.expectedVersion + 1);
    assert.equal(updated.commentCount, 1);
    await assert.rejects(posts.updateComment(viewer.user, privatePostId, privateCommentId, edit), fails(409, 'VERSION_CONFLICT'));

    const second = await posts.createComment(owner.user, privatePostId, { text: 'An owner comment' }, randomUUID());
    const firstPage = await posts.listComments(viewer.user, privatePostId, { limit: 1 });
    privateCommentCursor = firstPage.nextCursor;
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.commentCount, 2);
    const nextPage = await posts.listComments(viewer.user, privatePostId, { limit: 1, cursor: privateCommentCursor });
    assert.equal(nextPage.hasMore, false);
    assert.deepEqual(new Set([...firstPage.items, ...nextPage.items].map(({ id }) => id)), new Set([privateCommentId, second.comment.id]));
    await assert.rejects(posts.listComments(viewer.user, ownMoment.post.id, { cursor: privateCommentCursor }), fails(400, 'INVALID_CURSOR'));
    const ownerView = await posts.listComments(owner.user, privatePostId, {});
    assert.equal(ownerView.items.find(({ id }) => id === privateCommentId).canManage, false);
    assert.equal((await posts.getPost(viewer.user, privatePostId)).commentCount, 2);
  });

  await t.test('disabled comments remain visible and editable, reject new comments and allow author deletion', async () => {
    const post = await posts.getPost(owner.user, privatePostId);
    await posts.updatePost(owner.user, privatePostId, { expectedVersion: post.version, commentsEnabled: false });
    await assert.rejects(
      posts.createComment(viewer.user, privatePostId, { text: 'A disabled comment' }, randomUUID()),
      fails(409, 'COMMENTS_DISABLED'),
    );
    const { items } = await posts.listComments(owner.user, privatePostId, {});
    assert.equal(items.length, 2);
    const original = items.find(({ canManage }) => canManage);
    const updated = await posts.updateComment(owner.user, privatePostId, original.id, { text: 'Still editable', expectedVersion: original.version });
    assert.equal(updated.comment.text, 'Still editable');
    assert.deepEqual(await posts.deleteComment(owner.user, privatePostId, original.id), { commentCount: 1 });
    assert.deepEqual(await posts.deleteComment(owner.user, privatePostId, original.id), { commentCount: 1 });
    const updatedPost = await posts.getPost(owner.user, privatePostId);
    assert.equal(updatedPost.commentCount, 1);
    await posts.updatePost(owner.user, privatePostId, { expectedVersion: updatedPost.version, commentsEnabled: true });
  });

  await t.test('follower removal immediately revokes profile content, direct posts, Following and image bytes', async () => {
    await network.removeFollower(owner.user, viewer.user.id);
    await network.removeFollower(owner.user, viewer.user.id);
    assert.equal((await network.getProfile(viewer.user, owner.user.id)).canViewContent, false);
    await assert.rejects(posts.listUser(viewer.user, owner.user.id, {}), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.getPost(viewer.user, privateMoment.post.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.getImage(viewer.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    await assertEngagementHidden();
    await assertPrivateBookmarkHidden();
    const savedAfterRevoke = await posts.listSaved(viewer.user, { limit: 1, cursor: savedBeforePrivate });
    assert.deepEqual(savedAfterRevoke.items.map(({ id }) => id), [ownMoment.post.id]);
    const unsave = () => posts.setSaved(viewer.user, ownMoment.post.id, false);
    assert.deepEqual(await Promise.all([unsave(), unsave()]), [{ savedByMe: false }, { savedByMe: false }]);
    assert.equal((await posts.getPost(viewer.user, ownMoment.post.id)).savedByMe, false);
    assert.deepEqual((await posts.listSaved(viewer.user, {})).items.map(({ id }) => id), [unrelatedMoment.post.id]);
    const ownerView = await posts.getPost(owner.user, privatePostId);
    assert.equal(ownerView.likeCount, 1);
    assert.equal(ownerView.commentCount, 1);
    assert.equal((await posts.listFollowing(viewer.user, { limit: 10 })).items.some((post) => post.id === privateMoment.post.id), false);
  });

  await t.test('rejecting or cancelling pending requests removes only that request and allows a fresh later request', async () => {
    await network.follow(viewer.user, owner.user.id);
    const first = (await network.listRequests(owner.user, {})).items[0];
    await network.rejectRequest(owner.user, viewer.user.id);
    await network.rejectRequest(owner.user, viewer.user.id);
    await assert.rejects(network.acceptRequest(owner.user, viewer.user.id), fails(404, 'NOT_FOUND'));
    assert.equal((await network.getProfile(viewer.user, owner.user.id)).relationship.followingStatus, 'none');
    await network.follow(viewer.user, owner.user.id);
    const next = (await network.listRequests(owner.user, {})).items[0];
    assert.notEqual(next.id, first.id);
    await network.unfollow(viewer.user, owner.user.id);
    await network.unfollow(viewer.user, owner.user.id);
    assert.equal((await network.listRequests(owner.user, {})).items.length, 0);
    await network.follow(viewer.user, owner.user.id);
    await network.acceptRequest(owner.user, viewer.user.id);
    assert.ok((await posts.listSaved(viewer.user, {})).items.some(({ id }) => id === privatePostId));
    await network.unfollow(viewer.user, owner.user.id);
    await assert.rejects(posts.getImage(viewer.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    await assertPrivateBookmarkHidden();
  });

  await t.test('public follows are accepted once, reverse follows are independent and self-follow is rejected', async () => {
    const results = await Promise.all([network.follow(viewer.user, publicMember.user.id), network.follow(viewer.user, publicMember.user.id)]);
    assert.ok(results.every((result) => result.status === 'accepted'));
    assert.equal(await follows.countDocuments({ followerId: objectId(viewer.user.id), followingId: objectId(publicMember.user.id) }), 1);
    await network.follow(publicMember.user, viewer.user.id);
    assert.equal((await network.getProfile(viewer.user, publicMember.user.id)).relationship.followedBy, true);
    assert.equal((await network.listFollowing(viewer.user, viewer.user.id, {})).items.some((user) => user.id === publicMember.user.id), true);
    await assert.rejects(network.follow(viewer.user, viewer.user.id), fails(422, 'VALIDATION_ERROR'));
  });

  await t.test('privacy transitions preserve accepted followers and keep pending requests pending', async () => {
    publicMember.user = await auth.updateProfile(publicMember.token, { visibility: 'private' }, publicMember.user.id);
    assert.equal((await network.getProfile(viewer.user, publicMember.user.id)).canViewContent, true);
    assert.equal((await network.follow(outsider.user, publicMember.user.id)).status, 'pending');
    publicMember.user = await auth.updateProfile(publicMember.token, { visibility: 'public' }, publicMember.user.id);
    assert.equal((await network.follow(outsider.user, publicMember.user.id)).status, 'pending');
    assert.equal((await network.listRequests(publicMember.user, {})).items[0].follower.id, outsider.user.id);
    await network.acceptRequest(publicMember.user, outsider.user.id);
    assert.equal((await network.getProfile(outsider.user, publicMember.user.id)).relationship.followingStatus, 'accepted');
    await assert.rejects(auth.updateProfile(publicMember.token, { visibility: 'friends' }, publicMember.user.id), fails(422, 'VALIDATION_ERROR'));
  });

  await t.test('member search uses normalized literal prefixes, active-only minimal results and bound pagination', async () => {
    const template = await users.findOne({ _id: objectId(viewer.user.id) });
    for (const [username, displayName, displayNameSearch, status] of [
      ['search_alpha', 'Séa Alpha', 'sea alpha', 'active'],
      ['search_alpine', 'Sea Alpine', 'sea alpine', 'active'],
      ['search_beta', 'Sea Beta', 'sea beta', 'active'],
      ['search_suspended', 'Sea Suspended', 'sea suspended', 'suspended'],
    ]) await users.insertOne({ ...template, _id: new mongoose.Types.ObjectId(), usernameNormalized: username, emailNormalized: `${username}@example.com`, displayName, displayNameSearch, status });
    const first = await network.searchUsers(viewer.user, { q: 'SEARCH_', match: 'username', limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);
    const seen = first.items.map((user) => user.id);
    let page = first;
    for (let index = 0; page.hasMore && index < 10; index += 1) {
      page = await network.searchUsers(viewer.user, { q: 'search_', match: 'username', limit: 1, cursor: page.nextCursor });
      seen.push(...page.items.map((user) => user.id));
    }
    assert.equal(page.hasMore, false);
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen).size, 3);
    for (const field of ['bio', 'counts', 'email', 'passwordHash', 'policyVersion']) assert.equal(first.items[0][field], undefined);
    assert.equal((await network.searchUsers(viewer.user, { q: 'sé', match: 'displayName', limit: 20 })).items.length, 3);
    assert.equal((await network.searchUsers(viewer.user, { q: '.*', match: 'username' })).items.length, 0);
    await assert.rejects(network.searchUsers(viewer.user, { q: 's', match: 'username' }), fails(422, 'VALIDATION_ERROR'));
    await assert.rejects(network.searchUsers(viewer.user, { q: 'search_', match: 'email' }), fails(422, 'VALIDATION_ERROR'));
    await assert.rejects(network.searchUsers(outsider.user, { q: 'search_', match: 'username', limit: 1, cursor: first.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(network.searchUsers(viewer.user, { q: 'sea', match: 'displayName', limit: 1, cursor: first.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(network.searchUsers(viewer.user, { q: 'search_', match: 'username', limit: 1, cursor: `${first.nextCursor}tampered` }), fails(400, 'INVALID_CURSOR'));
  });

  await t.test('post-feed and relationship cursors are bound to route, target, viewer and current access', async () => {
    await network.follow(viewer.user, owner.user.id);
    await network.acceptRequest(owner.user, viewer.user.id);
    await publish(owner, 'Another private moment');
    const feed = await posts.listFollowing(viewer.user, { limit: 1 });
    assert.equal(feed.hasMore, true);
    await assert.rejects(posts.listRecent(viewer.user, { limit: 1, cursor: feed.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await assert.rejects(posts.listFollowing(outsider.user, { limit: 1, cursor: feed.nextCursor }), fails(400, 'INVALID_CURSOR'));
    const userPosts = await posts.listUser(viewer.user, owner.user.id, { limit: 1 });
    assert.equal(userPosts.hasMore, true);
    await assert.rejects(posts.listUser(viewer.user, publicMember.user.id, { limit: 1, cursor: userPosts.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await network.follow(outsider.user, owner.user.id);
    await network.acceptRequest(owner.user, outsider.user.id);
    const followers = await network.listFollowers(owner.user, owner.user.id, { limit: 1 });
    assert.equal(followers.hasMore, true);
    await assert.rejects(network.listFollowing(owner.user, owner.user.id, { limit: 1, cursor: followers.nextCursor }), fails(400, 'INVALID_CURSOR'));
    await network.removeFollower(owner.user, viewer.user.id);
    await assert.rejects(posts.listUser(viewer.user, owner.user.id, { limit: 1, cursor: userPosts.nextCursor }), fails(404, 'NOT_FOUND'));
    assert.equal((await posts.listFollowing(viewer.user, { limit: 20, cursor: feed.nextCursor })).items.some((post) => post.author.id === owner.user.id), false);
  });

  await t.test('a follow racing a public-to-private change grants access only when its committed relationship is accepted', async () => {
    const [, result] = await Promise.all([
      auth.updateProfile(viewer.token, { visibility: 'private' }, viewer.user.id),
      network.follow(outsider.user, viewer.user.id),
    ]);
    const relation = await follows.findOne({ followerId: objectId(outsider.user.id), followingId: objectId(viewer.user.id) });
    assert.ok(['accepted', 'pending'].includes(result.status));
    assert.equal(relation.status, result.status);
    const profile = await network.getProfile(outsider.user, viewer.user.id);
    assert.equal(profile.visibility, 'private');
    assert.equal(profile.canViewContent, relation.status === 'accepted');
    if (relation.status === 'accepted') {
      assert.deepEqual((await posts.getImage(outsider.user, ownMoment.asset.id)).data, photoBytes);
    } else {
      await assert.rejects(posts.getPost(outsider.user, ownMoment.post.id), fails(404, 'NOT_FOUND'));
      await assert.rejects(posts.getImage(outsider.user, ownMoment.asset.id), fails(404, 'NOT_FOUND'));
    }
    await network.unfollow(outsider.user, viewer.user.id);
    viewer.user = await auth.updateProfile(viewer.token, { visibility: 'public' }, viewer.user.id);
  });

  await t.test('concurrent approval and rejection resolve to acceptance or absence without deleting an accepted follow', async () => {
    await network.follow(viewer.user, owner.user.id);
    const [approval, rejection] = await Promise.allSettled([
      network.acceptRequest(owner.user, viewer.user.id), network.rejectRequest(owner.user, viewer.user.id),
    ]);
    const relation = await follows.findOne({ followerId: objectId(viewer.user.id), followingId: objectId(owner.user.id) });
    if (approval.status === 'fulfilled') {
      assert.equal(rejection.status, 'rejected');
      assert.equal(rejection.reason.status, 409);
      assert.equal(rejection.reason.code, 'REQUEST_ALREADY_APPROVED');
      assert.equal(approval.value.status, 'accepted');
      assert.equal(relation.status, 'accepted');
      assert.deepEqual((await posts.getImage(viewer.user, privateMoment.asset.id)).data, photoBytes);
    } else {
      assert.equal(rejection.status, 'fulfilled');
      assert.equal(approval.reason.status, 404);
      assert.equal(approval.reason.code, 'NOT_FOUND');
      assert.equal(relation, null);
      await assert.rejects(posts.getImage(viewer.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    }
    assert.equal((await network.listRequests(owner.user, {})).items.some((request) => request.follower.id === viewer.user.id), false);
    await network.unfollow(viewer.user, owner.user.id);
  });

  await t.test('avatar purpose cannot cross post claims and only an owned ready avatar can be attached', async () => {
    const avatar = await upload(owner, 'avatar');
    await assert.rejects(posts.publish(owner.user, { media: [{ assetId: avatar.id }] }, randomUUID()), fails(409, 'ASSET_NOT_READY'));
    await assert.rejects(auth.updateProfile(viewer.token, { avatarAssetId: avatar.id }, viewer.user.id), fails(409, 'ASSET_NOT_READY'));
    const postAsset = await upload(owner);
    await assert.rejects(auth.updateProfile(owner.token, { avatarAssetId: postAsset.id }, owner.user.id), fails(409, 'ASSET_NOT_READY'));
    const attached = await auth.updateProfile(owner.token, { avatarAssetId: avatar.id }, owner.user.id);
    assert.equal(attached.avatarUrl, `/api/v1/media/${avatar.id}/content`);
    assert.equal((await auth.updateProfile(owner.token, { avatarAssetId: avatar.id }, owner.user.id)).avatarUrl, attached.avatarUrl);
    const metadata = await assets.findOne({ _id: objectId(avatar.id) });
    assert.equal(metadata.state, 'attached');
    assert.equal(metadata.purpose, 'avatar');
    assert.equal(metadata.postId, undefined);
    // Minimal-profile policy allows this avatar without granting private posts.
    assert.deepEqual((await posts.getImage(viewer.user, avatar.id)).data, photoBytes);
    assert.equal((await network.getProfile(viewer.user, owner.user.id)).avatarUrl, attached.avatarUrl);
    await assert.rejects(posts.getImage(viewer.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    await posts.removeUpload(owner.user, postAsset.id);
  });

  await t.test('avatar replacement and clearing atomically remove detached metadata and binary bytes', async () => {
    const previous = await users.findOne({ _id: objectId(owner.user.id) });
    const replacement = await upload(owner, 'avatar');
    const updated = await auth.updateProfile(owner.token, { avatarAssetId: replacement.id }, owner.user.id);
    assert.equal(updated.avatarUrl, `/api/v1/media/${replacement.id}/content`);
    assert.equal(await assets.findOne({ _id: previous.avatarAssetId }), null);
    assert.equal(await images.findOne({ _id: previous.avatarAssetId }), null);
    await assert.rejects(posts.getImage(viewer.user, previous.avatarAssetId.toString()), fails(404, 'NOT_FOUND'));
    const cleared = await auth.updateProfile(owner.token, { avatarAssetId: null }, owner.user.id);
    assert.equal(cleared.avatarUrl, null);
    assert.equal(await assets.findOne({ _id: objectId(replacement.id) }), null);
    assert.equal(await images.findOne({ _id: objectId(replacement.id) }), null);
    await assert.rejects(posts.getImage(owner.user, replacement.id), fails(404, 'NOT_FOUND'));
  });

  await t.test('upload-purpose retries cannot repurpose an asset and expired avatars cannot attach', async () => {
    const key = randomUUID();
    const asset = await upload(owner, 'post', key);
    await assert.rejects(posts.assertCanUpload(owner.user, key, 'avatar'), fails(409, 'IDEMPOTENCY_CONFLICT'));
    await assert.rejects(upload(owner, 'avatar', key), fails(409, 'IDEMPOTENCY_CONFLICT'));
    await posts.removeUpload(owner.user, asset.id);
    const expired = await upload(owner, 'avatar');
    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000 + 1);
    // Renew this test session's expiry so the assertion isolates avatar expiry.
    await connection.db.collection('sessions').updateMany({ userId: objectId(owner.user.id) }, { $set: { expiresAt: new Date(currentTime.getTime() + 86400_000) } });
    await assert.rejects(auth.updateProfile(owner.token, { avatarAssetId: expired.id }, owner.user.id), fails(409, 'ASSET_NOT_READY'));
    await posts.cleanupOrphans();
    assert.equal(await assets.findOne({ _id: objectId(expired.id) }), null);
    assert.equal(await images.findOne({ _id: objectId(expired.id) }), null);
  });

  await t.test('post and avatar uploads share one draft quota under concurrency while retries remain available', async () => {
    const retryKey = randomUUID();
    const firstAvatar = await upload(publicMember, 'avatar', retryKey);
    for (let index = 1; index < 19; index += 1) await upload(publicMember, 'post');
    const attempts = await Promise.allSettled([upload(publicMember, 'post'), upload(publicMember, 'avatar')]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find((result) => result.status === 'rejected').reason;
    assert.equal(rejected.status, 409);
    assert.equal(rejected.code, 'MEDIA_QUOTA_EXCEEDED');
    const ownerId = objectId(publicMember.user.id);
    assert.equal(await assets.countDocuments({ ownerId, state: 'ready' }), 20);
    await posts.assertCanUpload(publicMember.user, retryKey, 'avatar');
    assert.equal((await upload(publicMember, 'avatar', retryKey)).id, firstAvatar.id);
    await assert.rejects(posts.assertCanUpload(publicMember.user, retryKey, 'post'), fails(409, 'IDEMPOTENCY_CONFLICT'));
    for (const purpose of ['post', 'avatar']) {
      await assert.rejects(posts.assertCanUpload(publicMember.user, randomUUID(), purpose), fails(409, 'MEDIA_QUOTA_EXCEEDED'));
      await assert.rejects(upload(publicMember, purpose), fails(409, 'MEDIA_QUOTA_EXCEEDED'));
    }
    await posts.removeUpload(publicMember.user, firstAvatar.id);
    assert.equal((await upload(publicMember, 'post')).status, 'ready');
    assert.equal(await assets.countDocuments({ ownerId, state: 'ready' }), 20);
  });

  await t.test('inactive users cannot be followed, searched or read through profiles and photo URLs', async () => {
    await users.updateOne({ _id: objectId(owner.user.id) }, { $set: { status: 'suspended' } });
    await assert.rejects(network.getProfile(outsider.user, owner.user.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(network.follow(viewer.user, owner.user.id), fails(404, 'NOT_FOUND'));
    await assert.rejects(posts.getImage(outsider.user, privateMoment.asset.id), fails(404, 'NOT_FOUND'));
    assert.equal((await network.searchUsers(viewer.user, { q: 'private_', match: 'username' })).items.length, 0);
    await assert.rejects(network.follow(owner.user, viewer.user.id), (error) => error.status === 403);
  });
});
