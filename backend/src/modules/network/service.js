import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { createNetworkCursors } from './cursor.js';
import { invalid, memberId, pageQuery } from './validation.js';

const projection = { _id: 1, usernameNormalized: 1, displayName: 1, displayNameSearch: 1,
  bio: 1, avatarAssetId: 1, visibility: 1, status: 1 };
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Member or follow request not found.');
const restricted = () => new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access members.');

export function memberSummary(user) {
  return { id: user._id.toHexString(), username: user.usernameNormalized, displayName: user.displayName,
    avatarUrl: user.avatarAssetId ? `/api/v1/media/${user.avatarAssetId.toHexString()}/content` : null,
    visibility: user.visibility };
}

export function createNetworkService({ connection, now = () => new Date(), cursorSecret }) {
  if (!connection.db) throw new Error('Connect to MongoDB before creating the network service.');
  const users = connection.db.collection('users');
  const follows = connection.db.collection('follows');
  const posts = connection.db.collection('posts');
  const cursors = createNetworkCursors(cursorSecret, now);

  async function active(viewer, session) {
    if (!viewer || viewer.status !== 'active') throw restricted();
    const id = memberId(viewer.id);
    const member = await users.findOne({ _id: id, status: 'active' }, { session, projection });
    if (!member) throw restricted();
    return member;
  }

  async function targetUser(id, session) {
    const target = await users.findOne({ _id: id, status: 'active' }, { session, projection });
    if (!target) throw notFound();
    return target;
  }

  async function accessible(viewerId, target, session) {
    return target._id.equals(viewerId) || target.visibility === 'public'
      || Boolean(await follows.findOne({ followerId: viewerId, followingId: target._id, status: 'accepted' }, { session, projection: { _id: 1 } }));
  }

  async function lockPair(viewer, targetId, session) {
    if (!viewer || viewer.status !== 'active') throw restricted();
    const actorId = memberId(viewer.id);
    if (actorId.equals(targetId)) invalid('userId', 'SELF_FOLLOW');
    const ids = [actorId, targetId].sort((a, b) => a.toHexString().localeCompare(b.toHexString()));
    const members = new Map();
    // All graph and privacy mutations write these shared guards in stable ID
    // order, so transaction retries re-read the current account/privacy state.
    for (const id of ids) {
      const member = await users.findOneAndUpdate({ _id: id, status: 'active' }, { $inc: { policyVersion: 1 } },
        { session, returnDocument: 'after', projection });
      if (!member) throw id.equals(actorId) ? restricted() : notFound();
      members.set(id.toHexString(), member);
    }
    return { actor: members.get(actorId.toHexString()), target: members.get(targetId.toHexString()) };
  }

  async function graphChange(viewer, targetId, work) {
    const id = memberId(targetId);
    let result;
    const execute = () => connection.transaction(async (session) => {
      const pair = await lockPair(viewer, id, session);
      result = await work(pair, session);
    });
    try { await execute(); } catch (error) {
      // The unique pair is authoritative if an overlapping insert commits.
      if (error.code !== 11000) throw error;
      await execute();
    }
    return result;
  }

  async function acceptedCount(targetId, direction) {
    const ownerField = direction === 'followers' ? 'followingId' : 'followerId';
    const otherField = direction === 'followers' ? 'followerId' : 'followingId';
    const [result] = await follows.aggregate([
      { $match: { [ownerField]: targetId, status: 'accepted' } },
      { $lookup: { from: 'users', localField: otherField, foreignField: '_id',
        pipeline: [{ $match: { status: 'active' } }, { $project: { _id: 1 } }], as: 'member' } },
      { $match: { 'member.0': { $exists: true } } }, { $count: 'count' },
    ]).toArray();
    return result?.count ?? 0;
  }

  async function relationList(viewer, targetId, query, direction) {
    const member = await active(viewer);
    const target = direction === 'requests' ? member : await targetUser(memberId(targetId));
    if (direction !== 'requests' && !await accessible(member._id, target)) throw notFound();
    const options = pageQuery(query);
    const scope = { route: direction, target: target._id.toHexString() };
    let position = cursors.decode(options.cursor, member._id.toHexString(), scope, 'date');
    const ownerField = direction === 'following' ? 'followerId' : 'followingId';
    const otherField = direction === 'following' ? 'followingId' : 'followerId';
    const status = direction === 'requests' ? 'pending' : 'accepted';
    const items = [];
    let scanned = 0;
    let hasMore = false;
    let last;
    while (items.length < options.limit && scanned < 200) {
      const match = { [ownerField]: target._id, status };
      if (position) match.$or = [{ createdAt: { $lt: position.date } },
        { createdAt: position.date, _id: { $lt: new mongoose.Types.ObjectId(position.id) } }];
      const batchLimit = Math.min(50, 200 - scanned);
      const batch = await follows.aggregate([
        { $match: match }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: batchLimit },
        { $lookup: { from: 'users', localField: otherField, foreignField: '_id',
          pipeline: [{ $match: { status: 'active' } }, { $project: projection }], as: 'member' } },
      ]).toArray();
      if (!batch.length) { hasMore = false; break; }
      for (let index = 0; index < batch.length; index += 1) {
        last = batch[index]; scanned += 1;
        if (last.member[0]) {
          const summary = memberSummary(last.member[0]);
          items.push(direction === 'requests' ? { id: last._id.toHexString(), follower: summary, createdAt: last.createdAt.toISOString() } : summary);
        }
        hasMore = index < batch.length - 1 || batch.length === batchLimit;
        if (items.length === options.limit) break;
      }
      if (items.length === options.limit || batch.length < batchLimit) break;
      position = { id: last._id.toHexString(), date: last.createdAt };
    }
    return { items, hasMore, nextCursor: hasMore && last ? cursors.encode(member._id.toHexString(), scope,
      { id: last._id.toHexString(), date: last.createdAt.toISOString() }) : null };
  }

  return {
    async getProfile(viewer, targetId) {
      const member = await active(viewer);
      const target = await targetUser(memberId(targetId));
      const [outgoing, incoming] = await Promise.all([
        follows.findOne({ followerId: member._id, followingId: target._id }, { projection: { status: 1 } }),
        follows.findOne({ followerId: target._id, followingId: member._id, status: 'accepted' }, { projection: { _id: 1 } }),
      ]);
      const isSelf = target._id.equals(member._id);
      const canViewContent = isSelf || target.visibility === 'public' || outgoing?.status === 'accepted';
      const result = { ...memberSummary(target), isSelf, canViewContent,
        relationship: { followingStatus: outgoing?.status ?? 'none', followedBy: Boolean(incoming) } };
      if (canViewContent) {
        const [postCount, followers, following] = await Promise.all([
          posts.countDocuments({ authorId: target._id, status: 'published' }),
          acceptedCount(target._id, 'followers'), acceptedCount(target._id, 'following'),
        ]);
        result.bio = target.bio ?? '';
        result.counts = { posts: postCount, followers, following };
      }
      return result;
    },

    async searchUsers(viewer, query = {}) {
      const member = await active(viewer);
      const options = pageQuery(query, true);
      const field = options.match === 'displayName' ? 'displayNameSearch' : 'usernameNormalized';
      const scope = { route: 'search', match: options.match, prefix: options.prefix };
      const position = cursors.decode(options.cursor, member._id.toHexString(), scope, 'key');
      const escaped = options.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const filter = { status: 'active', [field]: { $regex: `^${escaped}` } };
      if (position) filter.$or = [{ [field]: { $gt: position.key } },
        { [field]: position.key, _id: { $gt: new mongoose.Types.ObjectId(position.id) } }];
      const batch = await users.find(filter, { projection }).sort({ [field]: 1, _id: 1 }).limit(options.limit + 1).toArray();
      const hasMore = batch.length > options.limit;
      const rows = batch.slice(0, options.limit);
      const last = rows.at(-1);
      return { items: rows.map(memberSummary), hasMore, nextCursor: hasMore && last ? cursors.encode(member._id.toHexString(), scope,
        { id: last._id.toHexString(), key: last[field] }) : null };
    },

    listFollowers(viewer, targetId, query) { return relationList(viewer, targetId, query, 'followers'); },
    listFollowing(viewer, targetId, query) { return relationList(viewer, targetId, query, 'following'); },
    listRequests(viewer, query) { return relationList(viewer, null, query, 'requests'); },

    follow(viewer, targetId) {
      return graphChange(viewer, targetId, async ({ actor, target }, session) => {
        const pair = { followerId: actor._id, followingId: target._id };
        const existing = await follows.findOne(pair, { session });
        if (existing) return { userId: target._id.toHexString(), status: existing.status };
        const date = now();
        const status = target.visibility === 'private' ? 'pending' : 'accepted';
        await follows.insertOne({ ...pair, status, createdAt: date, ...(status === 'accepted' ? { acceptedAt: date } : {}) }, { session });
        return { userId: target._id.toHexString(), status };
      });
    },

    unfollow(viewer, targetId) {
      return graphChange(viewer, targetId, async ({ actor, target }, session) => {
        await follows.deleteOne({ followerId: actor._id, followingId: target._id }, { session });
      });
    },

    acceptRequest(viewer, requesterId) {
      return graphChange(viewer, requesterId, async ({ actor, target }, session) => {
        const pair = { followerId: target._id, followingId: actor._id };
        const request = await follows.findOne(pair, { session });
        if (!request) throw notFound();
        if (request.status === 'pending') await follows.updateOne({ ...pair, status: 'pending' },
          { $set: { status: 'accepted', acceptedAt: now() } }, { session });
        return { userId: target._id.toHexString(), status: 'accepted' };
      });
    },

    rejectRequest(viewer, requesterId) {
      return graphChange(viewer, requesterId, async ({ actor, target }, session) => {
        const pair = { followerId: target._id, followingId: actor._id };
        const request = await follows.findOne(pair, { session, projection: { status: 1 } });
        if (request?.status === 'accepted') {
          throw new HttpError(409, 'REQUEST_ALREADY_APPROVED', 'This member is already an approved follower. Remove them from Followers to revoke private-content access.');
        }
        await follows.deleteOne({ ...pair, status: 'pending' }, { session });
      });
    },

    removeFollower(viewer, followerId) {
      return graphChange(viewer, followerId, async ({ actor, target }, session) => {
        await follows.deleteOne({ followerId: target._id, followingId: actor._id, status: 'accepted' }, { session });
      });
    },
  };
}
