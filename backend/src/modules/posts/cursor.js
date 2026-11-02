import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../shared/http-error.js';

const invalidCursor = () => new HttpError(400, 'INVALID_CURSOR', 'This page cursor is invalid or expired. Refresh the list.');

export function createPostCursors(secret, now) {
  const key = secret ?? randomBytes(32);
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('hex');
  return {
    encode(viewerId, scope, post) {
      const value = Buffer.from(JSON.stringify({
        v: 1, viewerId, scope, date: post.createdAt.toISOString(), id: post._id.toHexString(),
        expires: now().getTime() + 24 * 60 * 60 * 1000,
      })).toString('base64url');
      return `${value}.${sign(value)}`;
    },
    decode(token, viewerId, scope) {
      if (token === undefined || token === null || token === '') return null;
      if (typeof token !== 'string' || token.length > 2048) throw invalidCursor();
      const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
      if (!match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(sign(match[1])))) throw invalidCursor();
      let payload;
      try { payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { throw invalidCursor(); }
      if (payload?.v !== 1 || payload.viewerId !== viewerId || payload.scope !== scope
        || !Number.isFinite(payload.expires) || payload.expires <= now().getTime()
        || typeof payload.id !== 'string' || !/^[a-f0-9]{24}$/.test(payload.id)
        || typeof payload.date !== 'string' || !Number.isFinite(new Date(payload.date).getTime())) throw invalidCursor();
      return { date: new Date(payload.date), id: payload.id };
    },
  };
}
