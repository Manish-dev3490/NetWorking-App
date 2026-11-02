import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { displayNameSearch } from '../auth/validation.js';

export function invalid(path, code = 'INVALID_FORMAT') {
  const error = new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted member fields.');
  error.fields = [{ path, code }];
  throw error;
}

export function memberId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) invalid('userId');
  return new mongoose.Types.ObjectId(value);
}

export function pageQuery(query = {}, search = false) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid('query', 'INVALID_TYPE');
  const allowed = search ? ['limit', 'cursor', 'q', 'match'] : ['limit', 'cursor'];
  const unknown = Object.keys(query).find((key) => !allowed.includes(key));
  if (unknown !== undefined) invalid(unknown, 'UNKNOWN_FIELD');
  const value = query.limit ?? 10;
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))
    || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 20) invalid('limit');
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 8192)) {
    throw new HttpError(400, 'INVALID_CURSOR', 'This page link is invalid. Refresh the list.');
  }
  const result = { limit: Number(value), cursor: query.cursor };
  if (search) {
    if (typeof query.q !== 'string') invalid('q', 'REQUIRED');
    const text = query.q.trim().normalize('NFC');
    if ([...text].length < 2 || [...text].length > 60) invalid('q', 'INVALID_LENGTH');
    const match = query.match ?? 'username';
    if (!['username', 'displayName'].includes(match)) invalid('match');
    const prefix = match === 'displayName' ? displayNameSearch(text) : text.toLowerCase();
    if (!prefix.trim()) invalid('q');
    Object.assign(result, { match, prefix });
  }
  return result;
}

export function noBody(req) {
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object'
    || Array.isArray(req.body) || Object.keys(req.body).length)) invalid('body', 'UNKNOWN_FIELD');
}
