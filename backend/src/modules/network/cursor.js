import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../shared/http-error.js';

const invalid = () => new HttpError(400, 'INVALID_CURSOR', 'This page link is invalid or expired. Refresh the list.');

export function createNetworkCursors(secret, now) {
  const key = secret ?? randomBytes(32);
  const sign = (value) => createHmac('sha256', key).update(value).digest('hex');
  const scopeHash = (scope) => createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return {
    encode(viewerId, scope, position) {
      const value = Buffer.from(JSON.stringify({ v: 1, viewerId, scope: scopeHash(scope), position,
        expires: now().getTime() + 24 * 60 * 60 * 1000 })).toString('base64url');
      return `${value}.${sign(value)}`;
    },
    decode(token, viewerId, scope, kind) {
      if (token === undefined || token === null || token === '') return null;
      if (typeof token !== 'string' || token.length > 8192) throw invalid();
      const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
      if (!match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(sign(match[1])))) throw invalid();
      let value;
      try { value = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { throw invalid(); }
      const position = value?.position;
      if (value?.v !== 1 || value.viewerId !== viewerId || value.scope !== scopeHash(scope)
        || !Number.isFinite(value.expires) || value.expires <= now().getTime()
        || !position || typeof position.id !== 'string' || !/^[a-f0-9]{24}$/.test(position.id)) throw invalid();
      if (kind === 'date') {
        if (typeof position.date !== 'string' || !Number.isFinite(new Date(position.date).getTime())) throw invalid();
        return { id: position.id, date: new Date(position.date) };
      }
      if (typeof position.key !== 'string' || position.key.length > 4096) throw invalid();
      return position;
    },
  };
}
