import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { createPostCursors } from './cursor.js';
import {
  MAX_MEMBER_BYTES, MAX_MEMBER_IMAGES, MAX_READY_UPLOADS, mediaPurpose, objectId, requestKey,
  validateEdit, validateProcessedImage, validatePublish,
} from './validation.js';

const DAY = 24 * 60 * 60 * 1000;
const authorProjection = { _id: 1, usernameNormalized: 1, displayName: 1, avatarAssetId: 1, status: 1, visibility: 1 };
const unavailable = () => new HttpError(404, 'NOT_FOUND', 'Post or photo not found.');
const quotaError = () => new HttpError(409, 'MEDIA_QUOTA_EXCEEDED', 'Your photo storage limit has been reached. Remove unused uploads or delete a post before adding more.');
const assetNotReady = () => new HttpError(409, 'ASSET_NOT_READY', 'A selected photo is unavailable or has already been used. Choose the photo again.');

function mediaDto(asset) {
  return {
    id: asset._id.toHexString(), status: asset.state, purpose: asset.purpose, contentUrl: `/api/v1/media/${asset._id.toHexString()}/content`,
    width: asset.width, height: asset.height, sizeBytes: asset.sizeBytes,
  };
}

function canRead(post, author, viewerId, accepted = false) {
  return post?.status === 'published' && author?.status === 'active'
    && (post.authorId.equals(viewerId) || author.visibility === 'public' || accepted);
}

function postDto(post, author, viewerId) {
  return {
    id: post._id.toHexString(),
    author: { id: author._id.toHexString(), username: author.usernameNormalized, displayName: author.displayName,
      avatarUrl: author.avatarAssetId ? `/api/v1/media/${author.avatarAssetId.toHexString()}/content` : null },
    caption: post.caption, hashtags: post.hashtags,
    media: post.media.map((item) => ({
      assetId: item.assetId.toHexString(), altText: item.altText, width: item.width, height: item.height,
      contentUrl: `/api/v1/media/${item.assetId.toHexString()}/content`,
    })),
    createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString(),
    version: post.editVersion, canManage: post.authorId.equals(viewerId), commentsEnabled: post.commentsEnabled,
  };
}

function canonicalHash(input) {
  return createHash('sha256').update(JSON.stringify({
    caption: input.caption, hashtags: [...input.hashtags].sort(), commentsEnabled: input.commentsEnabled,
    media: input.media.map((item) => ({ assetId: item.assetId.toHexString(), altText: item.altText })),
  })).digest('hex');
}

export function createPostService({ connection, now = () => new Date(), cursorSecret }) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before creating the post service.');
  const users = db.collection('users');
  const posts = db.collection('posts');
  const assets = db.collection('media_assets');
  const images = db.collection('media_images');
  const follows = db.collection('follows');
  const cursors = createPostCursors(cursorSecret, now);

  async function activeViewer(viewer, session, write = false) {
    if (!viewer || viewer.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access posts.');
    const id = objectId(viewer.id, 'accountId');
    // All media/post mutations lock the same user document, making concurrent
    // quota checks and active-account checks part of their transaction.
    const member = write
      ? await users.findOneAndUpdate({ _id: id, status: 'active' }, { $inc: { contentVersion: 1 } }, {
        session, returnDocument: 'after', projection: authorProjection,
      })
      : await users.findOne({ _id: id, status: 'active' }, { session, projection: authorProjection });
    if (!member) throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access posts.');
    return member;
  }

  async function checkQuota(ownerId, date, session, incomingBytes = 0) {
    const [totals] = await assets.aggregate([
      { $match: { ownerId, state: { $in: ['ready', 'attached'] } } },
      { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$sizeBytes' }, ready: {
        $sum: { $cond: [{ $and: [{ $eq: ['$state', 'ready'] }, { $gt: ['$expiresAt', date] }] }, 1, 0] },
      } } },
    ], { session }).toArray();
    if ((totals?.count ?? 0) >= MAX_MEMBER_IMAGES || (totals?.bytes ?? 0) + incomingBytes > MAX_MEMBER_BYTES
      || (incomingBytes === 0 && (totals?.bytes ?? 0) >= MAX_MEMBER_BYTES)
      || (totals?.ready ?? 0) >= MAX_READY_UPLOADS) throw quotaError();
  }

  async function authorFor(post, session) {
    return users.findOne({ _id: post.authorId }, { session, projection: authorProjection });
  }

  async function canViewAuthor(viewerId, author, session) {
    if (author?.status !== 'active') return false;
    if (author._id.equals(viewerId) || author.visibility === 'public') return true;
    return Boolean(await follows.findOne({ followerId: viewerId, followingId: author._id, status: 'accepted' }, {
      session, projection: { _id: 1 },
    }));
  }

  async function reclaimExpired(ownerId, date, session) {
    const stale = await assets.find({ ownerId, state: 'ready', expiresAt: { $lte: date } }, {
      session, projection: { _id: 1 },
    }).limit(20).toArray();
    if (!stale.length) return;
    const ids = stale.map((asset) => asset._id);
    await images.deleteMany({ _id: { $in: ids } }, { session });
    await assets.deleteMany({ _id: { $in: ids }, ownerId, state: 'ready', expiresAt: { $lte: date } }, { session });
  }

  async function visiblePost(viewerId, id, session) {
    const post = await posts.findOne({ _id: id, status: 'published' }, { session });
    if (!post) throw unavailable();
    const author = await authorFor(post, session);
    if (!await canViewAuthor(viewerId, author, session)) throw unavailable();
    return { post, author };
  }

  async function replay(viewerId, publishKey, requestHash, session) {
    const existing = await posts.findOne({ authorId: viewerId, publishKey }, { session });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This publish request was already used for different content.');
    if (existing.status === 'deleted') throw new HttpError(409, 'RESOURCE_DELETED', 'This post was deleted. Start a new post to publish new content.');
    const author = await authorFor(existing, session);
    if (!canRead(existing, author, viewerId)) throw unavailable();
    return { post: postDto(existing, author, viewerId), replayed: true };
  }

  async function list(viewer, query, scope, targetId) {
    const member = await activeViewer(viewer);
    const limit = query.limit === undefined ? 10 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Choose a page size between 1 and 20.');
    }
    const target = scope === 'user' ? objectId(targetId, 'userId') : null;
    if (target && !await canViewAuthor(member._id, await users.findOne({ _id: target }, { projection: authorProjection }))) throw unavailable();
    const cursorScope = target ? `user:${target.toHexString()}` : scope;
    let followingIds;
    if (scope === 'following') {
      followingIds = await follows.distinct('followingId', { followerId: member._id, status: 'accepted' });
      followingIds.push(member._id);
    }
    let position = cursors.decode(query.cursor, member._id.toHexString(), cursorScope);
    let lastExamined;
    const items = [];
    let scanned = 0;
    let hasMore = false;
    while (scanned < 200 && items.length < limit) {
      const match = { status: 'published' };
      if (scope === 'own') match.authorId = member._id;
      if (target) match.authorId = target;
      if (followingIds) match.authorId = { $in: followingIds };
      if (position) match.$or = [
        { createdAt: { $lt: position.date } },
        { createdAt: position.date, _id: { $lt: new mongoose.Types.ObjectId(position.id) } },
      ];
      const batchLimit = Math.min(50, 200 - scanned);
      const batch = await posts.aggregate([
        { $match: match }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: batchLimit },
        { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', pipeline: [{ $project: authorProjection }], as: 'author' } },
      ]).toArray();
      if (!batch.length) { hasMore = false; break; }
      // Refresh accepted relationships for this bounded batch. A pending
      // request never grants private content or Following-feed membership.
      const accepted = scope === 'following' || scope === 'user'
        ? await follows.find({ followerId: member._id, followingId: { $in: batch.map((post) => post.authorId) }, status: 'accepted' }, {
          projection: { followingId: 1 },
        }).toArray() : [];
      const acceptedIds = new Set(accepted.map((follow) => follow.followingId.toHexString()));
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        scanned += 1;
        lastExamined = candidate;
        const author = candidate.author[0];
        const acceptedAuthor = acceptedIds.has(candidate.authorId.toHexString());
        if (canRead(candidate, author, member._id, acceptedAuthor)
          && (scope !== 'recent' || author.visibility === 'public')
          && (scope !== 'following' || candidate.authorId.equals(member._id) || acceptedAuthor)) {
          items.push(postDto(candidate, author, member._id));
        }
        hasMore = index < batch.length - 1 || batch.length === batchLimit;
        if (items.length === limit) break;
      }
      if (items.length === limit || batch.length < batchLimit) break;
      position = { date: lastExamined.createdAt, id: lastExamined._id.toHexString() };
    }
    return {
      items, hasMore,
      nextCursor: hasMore && lastExamined ? cursors.encode(member._id.toHexString(), cursorScope, lastExamined) : null,
    };
  }

  return {
    async assertCanUpload(viewer, uploadKey, purpose = 'post') {
      const key = requestKey(uploadKey, 'X-Upload-Key');
      const intendedPurpose = mediaPurpose(purpose);
      await connection.transaction(async (session) => {
        const member = await activeViewer(viewer, session, true);
        const date = now();
        const existing = await assets.findOne({ ownerId: member._id, uploadKey: key }, { session });
        if (existing) {
          if (existing.purpose !== intendedPurpose) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This upload request was already used for another purpose.');
          if (existing.state === 'ready' && existing.expiresAt <= date) throw assetNotReady();
          return;
        }
        // Reclaim a bounded batch of this member's expired drafts before their
        // quota check; cleanup keeps metadata and binary bytes atomic.
        await reclaimExpired(member._id, date, session);
        await checkQuota(member._id, date, session);
      });
    },

    async uploadImage(viewer, input) {
      const data = validateProcessedImage(input);
      const hash = createHash('sha256').update(data.data).digest('hex');
      let result;
      try {
        await connection.transaction(async (session) => {
          const member = await activeViewer(viewer, session, true);
          const date = now();
          const existing = await assets.findOne({ ownerId: member._id, uploadKey: data.uploadKey }, { session });
          if (existing) {
            if (existing.contentHash !== hash || existing.purpose !== data.purpose) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This upload request was already used for another photo or purpose.');
            if (existing.state === 'ready' && existing.expiresAt <= date) throw assetNotReady();
            result = mediaDto(existing);
            return;
          }
          await reclaimExpired(member._id, date, session);
          await checkQuota(member._id, date, session, data.data.length);
          const asset = {
            _id: new mongoose.Types.ObjectId(), ownerId: member._id, state: 'ready', purpose: data.purpose,
            contentType: data.contentType, width: data.width, height: data.height, sizeBytes: data.data.length,
            uploadKey: data.uploadKey, contentHash: hash, createdAt: date, expiresAt: new Date(date.getTime() + DAY),
          };
          await images.insertOne({ _id: asset._id, data: new mongoose.mongo.Binary(data.data) }, { session });
          await assets.insertOne(asset, { session });
          result = mediaDto(asset);
        });
      } catch (error) {
        // A concurrent retry can commit the same unique upload key first.
        if (error.code !== 11000) throw error;
        const member = await activeViewer(viewer);
        const existing = await assets.findOne({ ownerId: member._id, uploadKey: data.uploadKey });
        if (!existing || existing.contentHash !== hash || existing.purpose !== data.purpose) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This upload request conflicts with another photo or purpose.');
        if (existing.state === 'ready' && existing.expiresAt <= now()) throw assetNotReady();
        result = mediaDto(existing);
      }
      return result;
    },

    async removeUpload(viewer, assetId) {
      const id = objectId(assetId, 'assetId');
      await connection.transaction(async (session) => {
        const member = await activeViewer(viewer, session, true);
        const asset = await assets.findOne({ _id: id }, { session });
        if (!asset) return;
        if (!asset.ownerId.equals(member._id)) throw unavailable();
        if (asset.state !== 'ready') throw new HttpError(409, 'ASSET_IN_USE', 'This photo is in use. Remove it from its post or profile first.');
        await images.deleteOne({ _id: id }, { session });
        await assets.deleteOne({ _id: id }, { session });
      });
    },

    async getImage(viewer, assetId) {
      const member = await activeViewer(viewer);
      const id = objectId(assetId, 'assetId');
      const asset = await assets.findOne({ _id: id });
      if (!asset) throw unavailable();
      if (asset.state === 'ready') {
        if (!asset.ownerId.equals(member._id) || asset.expiresAt <= now()) throw unavailable();
      } else if (asset.state === 'attached' && asset.purpose === 'avatar') {
        const owner = await users.findOne({ _id: asset.ownerId, status: 'active', avatarAssetId: id }, { projection: { _id: 1 } });
        if (!owner) throw unavailable();
      } else if (asset.state === 'attached' && asset.purpose === 'post' && asset.postId) {
        const { post } = await visiblePost(member._id, asset.postId);
        if (!post.media.some((item) => item.assetId.equals(id))) throw unavailable();
      } else throw unavailable();
      // Fetch BSON bytes only after current authorization has succeeded.
      const image = await images.findOne({ _id: id });
      if (!image) throw unavailable();
      const data = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data.value());
      return { data, contentType: asset.contentType, sizeBytes: data.length };
    },

    async publish(viewer, input, idempotencyKey) {
      const validated = validatePublish(input);
      const publishKey = requestKey(idempotencyKey);
      const requestHash = canonicalHash(validated);
      let result;
      try {
        await connection.transaction(async (session) => {
          const member = await activeViewer(viewer, session, true);
          const previous = await replay(member._id, publishKey, requestHash, session);
          if (previous) { result = previous; return; }
          const date = now();
          const ids = validated.media.map((item) => item.assetId);
          const selected = await assets.find({ _id: { $in: ids }, ownerId: member._id, purpose: 'post', state: 'ready', expiresAt: { $gt: date } }, { session }).toArray();
          if (selected.length !== ids.length) throw assetNotReady();
          const byId = new Map(selected.map((asset) => [asset._id.toHexString(), asset]));
          const post = {
            _id: new mongoose.Types.ObjectId(), authorId: member._id, caption: validated.caption,
            hashtags: validated.hashtags, commentsEnabled: validated.commentsEnabled,
            media: validated.media.map((item) => {
              const asset = byId.get(item.assetId.toHexString());
              return { ...item, width: asset.width, height: asset.height };
            }),
            status: 'published', editVersion: 0, publishKey, requestHash, createdAt: date, updatedAt: date,
          };
          const claimed = await assets.updateMany({ _id: { $in: ids }, ownerId: member._id, purpose: 'post', state: 'ready', expiresAt: { $gt: date } }, {
            $set: { state: 'attached', postId: post._id }, $unset: { expiresAt: '' },
          }, { session });
          if (claimed.modifiedCount !== ids.length) throw assetNotReady();
          await posts.insertOne(post, { session });
          result = { post: postDto(post, member, member._id), replayed: false };
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const member = await activeViewer(viewer);
        result = await replay(member._id, publishKey, requestHash);
        if (!result) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This publish request conflicts with another post.');
      }
      return result;
    },

    async getPost(viewer, postId) {
      const member = await activeViewer(viewer);
      const { post, author } = await visiblePost(member._id, objectId(postId, 'postId'));
      return postDto(post, author, member._id);
    },

    listRecent(viewer, query = {}) { return list(viewer, query, 'recent'); },
    listOwn(viewer, query = {}) { return list(viewer, query, 'own'); },
    listFollowing(viewer, query = {}) { return list(viewer, query, 'following'); },
    listUser(viewer, targetId, query = {}) { return list(viewer, query, 'user', targetId); },

    async updatePost(viewer, postId, input) {
      const id = objectId(postId, 'postId');
      const validated = validateEdit(input);
      let result;
      await connection.transaction(async (session) => {
        const member = await activeViewer(viewer, session, true);
        const { post, author } = await visiblePost(member._id, id, session);
        if (!post.authorId.equals(member._id)) throw new HttpError(403, 'FORBIDDEN', 'Only the author can edit this post.');
        if (post.editVersion !== validated.expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'This post changed elsewhere. Reload it before editing again.');
        const fields = { ...validated.fields, updatedAt: now() };
        if (validated.mediaAltText) {
          const byId = new Map(validated.mediaAltText.map((item) => [item.assetId.toHexString(), item.altText]));
          if ([...byId.keys()].some((assetId) => !post.media.some((item) => item.assetId.toHexString() === assetId))) throw assetNotReady();
          fields.media = post.media.map((item) => byId.has(item.assetId.toHexString()) ? { ...item, altText: byId.get(item.assetId.toHexString()) } : item);
        }
        const updated = await posts.findOneAndUpdate({ _id: id, authorId: member._id, status: 'published', editVersion: validated.expectedVersion }, {
          $set: fields, $inc: { editVersion: 1 },
        }, { session, returnDocument: 'after' });
        if (!updated) throw new HttpError(409, 'VERSION_CONFLICT', 'This post changed elsewhere. Reload it before editing again.');
        result = postDto(updated, author, member._id);
      });
      return result;
    },

    async deletePost(viewer, postId) {
      const id = objectId(postId, 'postId');
      await connection.transaction(async (session) => {
        const member = await activeViewer(viewer, session, true);
        const post = await posts.findOne({ _id: id }, { session });
        if (!post) return;
        if (!post.authorId.equals(member._id)) {
          const author = await authorFor(post, session);
          if (!canRead(post, author, member._id, await canViewAuthor(member._id, author, session))) throw unavailable();
          throw new HttpError(403, 'FORBIDDEN', 'Only the author can delete this post.');
        }
        if (post.status === 'deleted') return;
        const ids = post.media.map((item) => item.assetId);
        await posts.updateOne({ _id: id, status: 'published' }, { $set: { status: 'deleted', deletedAt: now(), updatedAt: now() } }, { session });
        await images.deleteMany({ _id: { $in: ids } }, { session });
        await assets.deleteMany({ _id: { $in: ids }, ownerId: member._id, postId: id }, { session });
      });
    },

    async cleanupOrphans() {
      const expired = await assets.find({ state: 'ready', expiresAt: { $lte: now() } }, { projection: { _id: 1 } }).limit(20).toArray();
      let removed = 0;
      for (const candidate of expired) {
        let removedInTransaction = 0;
        await connection.transaction(async (session) => {
          removedInTransaction = 0;
          const current = await assets.findOne({ _id: candidate._id, state: 'ready', expiresAt: { $lte: now() } }, { session });
          if (!current) return;
          await images.deleteOne({ _id: current._id }, { session });
          const result = await assets.deleteOne({ _id: current._id, state: 'ready' }, { session });
          removedInTransaction = result.deletedCount;
        });
        removed += removedInTransaction;
      }
      return { removed };
    },
  };
}
