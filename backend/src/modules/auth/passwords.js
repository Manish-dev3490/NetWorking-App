import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../../shared/http-error.js';

const derive = promisify(scrypt);
const cost = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let activeWork = 0;

async function derivePassword(password, salt) {
  // Bound expensive password work instead of allowing an unbounded memory queue.
  if (activeWork >= 2) throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Please try again shortly.');
  activeWork += 1;
  try {
    return await derive(password, salt, 64, cost);
  } finally {
    activeWork -= 1;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const key = await derivePassword(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$131072$8$1'
    || !/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[5])) return false;
  const expected = Buffer.from(parts[5], 'base64url');
  const actual = await derivePassword(password, parts[4]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
