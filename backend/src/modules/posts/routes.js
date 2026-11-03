import express, { Router } from 'express';
import { HttpError } from '../../shared/http-error.js';
import { sessionToken } from '../../shared/session-token.js';
import { imageContentType, MAX_IMAGE_BYTES, processImage } from '../media/process-image.js';
import { mediaPurpose } from './validation.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activeUploads = 0;

function key(req) {
  const value = req.get('Idempotency-Key');
  if (!value || !uuid.test(value)) {
    const error = new HttpError(422, 'VALIDATION_ERROR', 'This request needs a valid retry key.');
    error.fields = [{ path: 'idempotencyKey', code: 'INVALID_FORMAT' }];
    throw error;
  }
  return value.toLowerCase();
}

function emptyBody(req) {
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object'
    || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'This request does not accept any fields.');
  }
}

function requireAccount(req) {
  const account = req.get('X-Account-Id');
  if (!account || account.toLowerCase() !== req.viewer.id) {
    throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account has changed. Please review it before continuing.');
  }
}

function pageOptions(req) {
  for (const name of Object.keys(req.query)) {
    if (!['limit', 'cursor'].includes(name)) throw new HttpError(422, 'VALIDATION_ERROR', 'Unsupported feed filter.');
  }
  const limit = req.query.limit ?? '10';
  if (typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 20) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Page size must be between 1 and 20.');
  }
  if (req.query.cursor !== undefined && (typeof req.query.cursor !== 'string' || req.query.cursor.length > 1500)) {
    throw new HttpError(400, 'INVALID_CURSOR', 'This page link is invalid. Refresh the feed.');
  }
  return { limit: Number(limit), cursor: req.query.cursor };
}

export function createPostRouter({ authService, postService }) {
  const router = Router();
  const respond = (req, res, data, status = 200, meta = {}) => res.status(status).json({
    data, meta: { requestId: req.requestId, ...meta },
  });

  router.use(async (req, res, next) => {
    // Only claimed post/media routes resolve a member; leave unrelated API routes alone.
    if (!/^\/(?:posts(?:\/|$)|media(?:\/|$)|me\/(?:posts|saved-posts)\/?$|users\/[^/]+\/posts\/?$)/i.test(req.path)) return next('router');
    const { user } = await authService.resolveSession(sessionToken(req));
    if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot access posts.');
    req.viewer = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireAccount(req);
    return next();
  });

  router.post('/media/uploads', async (req, res) => {
    const uploadKey = key(req);
    const contentType = imageContentType(req);
    const purpose = mediaPurpose(req.get('X-Media-Purpose') ?? 'post');
    if (activeUploads >= 2) {
      res.set('Retry-After', '3');
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Photo uploads are busy. Please try again shortly.');
    }
    activeUploads += 1;
    // Limit outstanding request bodies as well as image decoding work.
    const deadline = setTimeout(() => req.destroy(), 30_000);
    deadline.unref();
    try {
      await postService.assertCanUpload(req.viewer, uploadKey, purpose);
      const parser = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES, inflate: false });
      try {
        await new Promise((resolve, reject) => parser(req, res, (error) => error ? reject(error) : resolve()));
      } catch (error) {
        if (error.type === 'entity.too.large') throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Each photo must be 5 MiB or smaller.');
        if (error.status === 415) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload uncompressed JPEG, PNG or WebP bytes.');
        throw new HttpError(400, 'BAD_REQUEST', 'The photo upload was interrupted or malformed.');
      }
      const processed = await processImage(req.body, contentType);
      const media = await postService.uploadImage(req.viewer, { ...processed, uploadKey, purpose });
      res.location(`/api/v1/media/${media.id}/content`);
      respond(req, res, media, 201);
    } finally {
      clearTimeout(deadline);
      activeUploads -= 1;
    }
  });

  router.get('/media/:assetId/content', async (req, res) => {
    const image = await postService.getImage(req.viewer, req.params.assetId);
    res.set({
      'Content-Type': image.contentType, 'Content-Length': String(image.data.length),
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(image.data);
  });
  router.delete('/media/:assetId', async (req, res) => {
    emptyBody(req);
    await postService.removeUpload(req.viewer, req.params.assetId);
    res.status(204).end();
  });
  router.get('/posts/recent', async (req, res) => {
    const page = await postService.listRecent(req.viewer, pageOptions(req));
    respond(req, res, page.items, 200, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
  router.get('/posts/following', async (req, res) => {
    const page = await postService.listFollowing(req.viewer, pageOptions(req));
    respond(req, res, page.items, 200, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
  router.get('/me/posts', async (req, res) => {
    const page = await postService.listOwn(req.viewer, pageOptions(req));
    respond(req, res, page.items, 200, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
  router.get('/me/saved-posts', async (req, res) => {
    requireAccount(req);
    const page = await postService.listSaved(req.viewer, pageOptions(req));
    respond(req, res, page.items, 200, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
  router.get('/users/:userId/posts', async (req, res) => {
    const page = await postService.listUser(req.viewer, req.params.userId, pageOptions(req));
    respond(req, res, page.items, 200, { nextCursor: page.nextCursor, hasMore: page.hasMore });
  });
  router.post('/posts', async (req, res) => {
    const result = await postService.publish(req.viewer, req.body, key(req));
    res.location(`/api/v1/posts/${result.post.id}`);
    if (result.replayed) res.set('Idempotency-Replayed', 'true');
    respond(req, res, result.post, result.replayed ? 200 : 201);
  });
  router.get('/posts/:postId', async (req, res) => respond(req, res, await postService.getPost(req.viewer, req.params.postId)));
  router.put('/posts/:postId/save', async (req, res) => {
    emptyBody(req);
    respond(req, res, await postService.setSaved(req.viewer, req.params.postId, true));
  });
  router.delete('/posts/:postId/save', async (req, res) => {
    emptyBody(req);
    respond(req, res, await postService.setSaved(req.viewer, req.params.postId, false));
  });
  router.put('/posts/:postId/like', async (req, res) => {
    emptyBody(req);
    respond(req, res, await postService.setLike(req.viewer, req.params.postId, true));
  });
  router.delete('/posts/:postId/like', async (req, res) => {
    emptyBody(req);
    respond(req, res, await postService.setLike(req.viewer, req.params.postId, false));
  });
  router.get('/posts/:postId/comments', async (req, res) => {
    const { items, nextCursor, hasMore, commentCount } = await postService.listComments(req.viewer, req.params.postId, pageOptions(req));
    respond(req, res, items, 200, { nextCursor, hasMore, commentCount });
  });
  router.post('/posts/:postId/comments', async (req, res) => {
    const { comment, commentCount, replayed } = await postService.createComment(req.viewer, req.params.postId, req.body, key(req));
    if (replayed) res.set('Idempotency-Replayed', 'true');
    respond(req, res, comment, replayed ? 200 : 201, { commentCount });
  });
  router.patch('/posts/:postId/comments/:commentId', async (req, res) => {
    const { comment, commentCount } = await postService.updateComment(req.viewer, req.params.postId, req.params.commentId, req.body);
    respond(req, res, comment, 200, { commentCount });
  });
  router.delete('/posts/:postId/comments/:commentId', async (req, res) => {
    emptyBody(req);
    respond(req, res, await postService.deleteComment(req.viewer, req.params.postId, req.params.commentId));
  });
  router.patch('/posts/:postId', async (req, res) => respond(req, res, await postService.updatePost(req.viewer, req.params.postId, req.body)));
  router.delete('/posts/:postId', async (req, res) => {
    emptyBody(req);
    await postService.deletePost(req.viewer, req.params.postId);
    res.status(204).end();
  });
  return router;
}
