import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { createPostCursors } from '../posts/cursor.js';
import { objectId } from '../posts/validation.js';

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Notification not found.');
const restricted = () => new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access notifications.');

function visibleTo(viewerId) {
  return [
    { $lookup: { from: 'users', localField: 'actorId', foreignField: '_id', pipeline: [
      { $match: { status: 'active' } },
      { $project: { usernameNormalized: 1, displayName: 1, avatarAssetId: 1 } },
    ], as: 'actor' } },
    { $unwind: '$actor' },
    { $lookup: { from: 'follows', localField: 'relationshipId', foreignField: '_id', let: {
      follower: { $cond: [{ $eq: ['$type', 'follow_approved'] }, viewerId, '$actorId'] },
      following: { $cond: [{ $eq: ['$type', 'follow_approved'] }, '$actorId', viewerId] },
    }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$followerId', '$$follower'] }, { $eq: ['$followingId', '$$following'] }] } } },
      { $project: { status: 1 } },
    ], as: 'relationship' } },
    { $lookup: { from: 'posts', localField: 'postId', foreignField: '_id', pipeline: [
      { $match: { status: 'published' } },
      { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', pipeline: [
        { $match: { status: 'active' } }, { $project: { visibility: 1 } },
      ], as: 'author' } },
      { $unwind: '$author' },
      { $lookup: { from: 'follows', localField: 'authorId', foreignField: 'followingId', pipeline: [
        { $match: { followerId: viewerId, status: 'accepted' } }, { $project: { _id: 1 } },
      ], as: 'acceptedFollow' } },
      { $match: { $or: [{ authorId: viewerId }, { 'author.visibility': 'public' }, { 'acceptedFollow.0': { $exists: true } }] } },
      { $project: { _id: 1 } },
    ], as: 'post' } },
    { $lookup: { from: 'post_likes', localField: 'postId', foreignField: 'postId', let: { actorId: '$actorId' }, pipeline: [
      { $match: { $expr: { $eq: ['$memberId', '$$actorId'] } } }, { $project: { _id: 1 } },
    ], as: 'like' } },
    { $lookup: { from: 'post_comments', localField: 'commentId', foreignField: '_id', let: { actorId: '$actorId', postId: '$postId' }, pipeline: [
      { $match: { status: 'visible', $expr: { $and: [{ $eq: ['$authorId', '$$actorId'] }, { $eq: ['$postId', '$$postId'] }] } } },
      { $project: { _id: 1 } },
    ], as: 'comment' } },
    { $match: { $or: [
      { type: 'follow_request', 'relationship.status': 'pending' },
      { type: { $in: ['follow', 'follow_approved'] }, 'relationship.status': 'accepted' },
      { type: 'post_like', 'post.0': { $exists: true }, 'like.0': { $exists: true } },
      { type: 'post_comment', 'post.0': { $exists: true }, 'comment.0': { $exists: true } },
    ] } },
  ];
}

function notificationDto(row) {
  return {
    id: row._id.toHexString(), type: row.type,
    actor: {
      id: row.actor._id.toHexString(), username: row.actor.usernameNormalized, displayName: row.actor.displayName,
      avatarUrl: row.actor.avatarAssetId ? `/api/v1/media/${row.actor.avatarAssetId.toHexString()}/content` : null,
    },
    postId: row.postId?.toHexString() ?? null,
    createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null,
  };
}

export function createNotificationService({ connection, now = () => new Date(), cursorSecret }) {
  const { db } = connection;
  if (!db) throw new Error('Connect to MongoDB before creating the notification service.');
  const users = db.collection('users');
  const notifications = db.collection('notifications');
  const cursors = createPostCursors(cursorSecret, now);

  function transaction(viewer, work) {
    if (viewer?.status !== 'active') throw restricted();
    const viewerId = objectId(viewer.id, 'accountId');
    return connection.transaction(async (session) => {
      if (!await users.findOne({ _id: viewerId, status: 'active' }, { session, projection: { _id: 1 } })) throw restricted();
      return work(viewerId, session);
    }, { readConcern: { level: 'snapshot' } });
  }

  async function unreadCount(recipientId, session) {
    const [row] = await notifications.aggregate([
      { $match: { recipientId, readAt: null } }, ...visibleTo(recipientId), { $count: 'unreadCount' },
    ], { session }).toArray();
    return { unreadCount: row?.unreadCount ?? 0 };
  }

  return {
    list(viewer, { limit = 10, cursor } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Page size must be between 1 and 20.');
      }
      return transaction(viewer, async (recipientId, session) => {
        const viewerId = recipientId.toHexString();
        const position = cursors.decode(cursor, viewerId, 'notifications');
        const match = { recipientId };
        if (position) match.$or = [
          { createdAt: { $lt: position.date } },
          { createdAt: position.date, _id: { $lt: new mongoose.Types.ObjectId(position.id) } },
        ];
        const rows = await notifications.aggregate([
          { $match: match }, { $sort: { createdAt: -1, _id: -1 } }, ...visibleTo(recipientId), { $limit: limit + 1 },
        ], { session }).toArray();
        const page = rows.slice(0, limit);
        const hasMore = rows.length > limit;
        return {
          items: page.map(notificationDto), hasMore,
          nextCursor: hasMore ? cursors.encode(viewerId, 'notifications', page.at(-1)) : null,
          ...await unreadCount(recipientId, session),
        };
      });
    },

    unreadCount(viewer) {
      return transaction(viewer, unreadCount);
    },

    markRead(viewer, notificationId) {
      const id = objectId(notificationId, 'notificationId');
      return transaction(viewer, async (recipientId, session) => {
        const [notification] = await notifications.aggregate([
          { $match: { _id: id, recipientId } }, ...visibleTo(recipientId), { $project: { _id: 1 } },
        ], { session }).toArray();
        if (!notification) throw notFound();
        await notifications.updateOne({ _id: id, recipientId, readAt: null }, { $set: { readAt: now() } }, { session });
        return unreadCount(recipientId, session);
      });
    },

    markAllRead(viewer) {
      return transaction(viewer, async (recipientId, session) => {
        await notifications.updateMany({ recipientId, readAt: null }, { $set: { readAt: now() } }, { session });
        return { unreadCount: 0 };
      });
    },
  };
}
