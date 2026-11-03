import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { createNotificationWriter } from '../notifications/writer.js';
import { objectId, requestKey, validateComment } from './validation.js';

const missingComment = () => new HttpError(404, 'COMMENT_NOT_FOUND', 'Comment not found.');

function commentDto(comment, author, viewerId) {
  return {
    id: comment._id.toHexString(), author: {
      id: comment.authorId.toHexString(), username: author?.usernameNormalized ?? '',
      displayName: author?.displayName ?? 'Former member',
      avatarUrl: author?.avatarAssetId ? `/api/v1/media/${author.avatarAssetId.toHexString()}/content` : null,
    },
    text: comment.text, createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString(),
    version: comment.editVersion, canManage: comment.authorId.equals(viewerId),
  };
}

function assertCommentAuthor(comment, member) {
  if (!comment.authorId.equals(member._id)) throw new HttpError(403, 'FORBIDDEN', 'Only the author can change this comment.');
}

export function createEngagement({ db, now, cursors, withVisiblePost }) {
  const likes = db.collection('post_likes');
  const comments = db.collection('post_comments');
  const posts = db.collection('posts');
  const notify = createNotificationWriter(db);

  async function changeCount(postId, field, amount, session) {
    const post = await posts.findOneAndUpdate({ _id: postId, status: 'published' }, { $inc: { [field]: amount } }, {
      session, returnDocument: 'after', projection: { [field]: 1 },
    });
    return post[field];
  }

  return {
    async hasLike(postId, memberId, session) {
      return Boolean(await likes.findOne({ postId, memberId }, { session, projection: { _id: 1 } }));
    },

    async removePostEngagement(postId, session) {
      await likes.deleteMany({ postId }, { session });
      await comments.deleteMany({ postId }, { session });
    },

    setLike(viewer, postId, likedByMe) {
      return withVisiblePost(viewer, postId, true, async (post, member, session) => {
        const pair = { postId: post._id, memberId: member._id };
        const date = now();
        const changed = likedByMe
          ? (await likes.updateOne(pair, { $setOnInsert: { ...pair, createdAt: date } }, { session, upsert: true })).upsertedCount
          : (await likes.deleteOne(pair, { session })).deletedCount;
        const likeCount = changed
          ? await changeCount(post._id, 'likeCount', likedByMe ? 1 : -1, session)
          : post.likeCount ?? 0;
        if (likedByMe && changed) await notify({
          type: 'post_like', actorId: member._id, recipientId: post.authorId, postId: post._id, createdAt: date,
        }, session);
        return { likedByMe, likeCount };
      });
    },

    listComments(viewer, postId, query = {}) {
      const limit = query.limit ?? 10;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Choose a page size between 1 and 20.');
      }
      return withVisiblePost(viewer, postId, false, async (post, member, session) => {
        const scope = `comments:${post._id.toHexString()}`;
        const viewerId = member._id.toHexString();
        const position = cursors.decode(query.cursor, viewerId, scope);
        const match = { postId: post._id, status: 'visible' };
        if (position) match.$or = [
          { createdAt: { $lt: position.date } },
          { createdAt: position.date, _id: { $lt: new mongoose.Types.ObjectId(position.id) } },
        ];
        const page = await comments.aggregate([
          { $match: match }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: limit + 1 },
          { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', pipeline: [
            { $match: { status: 'active' } }, { $project: { usernameNormalized: 1, displayName: 1, avatarAssetId: 1 } },
          ], as: 'author' } },
        ], { session }).toArray();
        const rows = page.slice(0, limit);
        const hasMore = page.length > limit;
        return {
          items: rows.map((row) => commentDto(row, row.author[0], member._id)), hasMore,
          nextCursor: hasMore ? cursors.encode(viewerId, scope, rows.at(-1)) : null,
          commentCount: post.commentCount ?? 0,
        };
      });
    },

    createComment(viewer, postId, input, idempotencyKey) {
      const { text } = validateComment(input);
      const key = requestKey(idempotencyKey);
      const requestHash = createHash('sha256').update(text).digest('hex');
      return withVisiblePost(viewer, postId, true, async (post, member, session) => {
        const match = { postId: post._id, authorId: member._id, requestKey: key };
        const existing = await comments.findOne(match, { session });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This comment request was already used for different text.');
          if (existing.status === 'deleted') throw new HttpError(409, 'RESOURCE_DELETED', 'This comment was deleted. Start a new comment to post again.');
          return { comment: commentDto(existing, member, member._id), commentCount: post.commentCount ?? 0, replayed: true };
        }
        if (!post.commentsEnabled) throw new HttpError(409, 'COMMENTS_DISABLED', 'New comments are disabled for this post.');
        const date = now();
        const comment = { _id: new mongoose.Types.ObjectId(), ...match, text, requestHash,
          status: 'visible', editVersion: 0, createdAt: date, updatedAt: date };
        await comments.insertOne(comment, { session });
        const commentCount = await changeCount(post._id, 'commentCount', 1, session);
        await notify({
          type: 'post_comment', actorId: member._id, recipientId: post.authorId,
          postId: post._id, commentId: comment._id, createdAt: date,
        }, session);
        return { comment: commentDto(comment, member, member._id), commentCount, replayed: false };
      });
    },

    updateComment(viewer, postId, commentId, input) {
      const id = objectId(commentId, 'commentId');
      const { text, expectedVersion } = validateComment(input, true);
      return withVisiblePost(viewer, postId, true, async (post, member, session) => {
        const match = { _id: id, postId: post._id, status: 'visible' };
        const comment = await comments.findOne(match, { session });
        if (!comment) throw missingComment();
        assertCommentAuthor(comment, member);
        if (comment.editVersion !== expectedVersion) throw new HttpError(409, 'VERSION_CONFLICT', 'This comment changed elsewhere. Reload it before editing again.');
        const updated = await comments.findOneAndUpdate(match, {
          $set: { text, updatedAt: now() }, $inc: { editVersion: 1 },
        }, { session, returnDocument: 'after' });
        return { comment: commentDto(updated, member, member._id), commentCount: post.commentCount ?? 0 };
      });
    },

    deleteComment(viewer, postId, commentId) {
      const id = objectId(commentId, 'commentId');
      return withVisiblePost(viewer, postId, true, async (post, member, session) => {
        const match = { _id: id, postId: post._id, status: 'visible' };
        const comment = await comments.findOne(match, { session });
        if (!comment) return { commentCount: post.commentCount ?? 0 };
        assertCommentAuthor(comment, member);
        await comments.updateOne(match, {
          $set: { status: 'deleted', updatedAt: now() }, $unset: { text: '' },
        }, { session });
        return { commentCount: await changeCount(post._id, 'commentCount', -1, session) };
      });
    },
  };
}
