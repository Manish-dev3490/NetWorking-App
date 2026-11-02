import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';
import { createAuthRepository } from './repository.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { displayNameSearch, validateLogin, validateProfile, validateRegistration } from './validation.js';

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const validToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
// A public dummy verifier makes unknown emails use the normal scrypt path, too.
const dummyPasswordHash = `scrypt$131072$8$1$${'A'.repeat(22)}$${'A'.repeat(86)}`;
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function selfUser(user) {
  return {
    id: user._id.toString(), email: user.emailNormalized, username: user.usernameNormalized,
    displayName: user.displayName, bio: user.bio ?? '', visibility: user.visibility,
    avatarUrl: user.avatarAssetId ? `/api/v1/media/${user.avatarAssetId.toString()}/content` : null,
    status: user.status, createdAt: user.createdAt.toISOString(),
  };
}

function identityConflict(error) {
  if (error.code === 11000) throw new HttpError(409, 'IDENTITY_UNAVAILABLE', 'That email or username is unavailable.');
  throw error;
}

function assertAccountMatch(actualId, expectedId) {
  if (typeof expectedId !== 'string' || !/^[0-9a-f]{24}$/i.test(expectedId)
    || actualId.toString() !== expectedId.toLowerCase()) {
    throw new HttpError(409, 'ACCOUNT_CHANGED', 'Your signed-in account has changed. Please review your account before continuing.');
  }
}

export function createAuthService({ connection, now = () => new Date(), repository = createAuthRepository(connection) }) {
  function sessionFor(user, date) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(date.getTime() + SESSION_DURATION_MS);
    return {
      token, expiresAt,
      record: { userId: user._id, tokenHash: hashToken(token), authVersion: user.authVersion, createdAt: date, expiresAt },
    };
  }

  async function resolveRecord(token) {
    if (!validToken(token)) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    const session = await repository.findSession(hashToken(token));
    if (!session || session.revokedAt) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    if (session.expiresAt.getTime() <= now().getTime()) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    const user = await repository.findUser(session.userId);
    if (!user || ['deleting', 'deleted'].includes(user.status) || session.authVersion !== user.authVersion) {
      throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    }
    return { user, session };
  }

  return {
    async register(input) {
      const data = validateRegistration(input);
      const passwordHash = await hashPassword(data.password);
      const date = now();
      const user = {
        _id: new mongoose.Types.ObjectId(), emailNormalized: data.email,
        usernameNormalized: data.username, passwordHash, displayName: data.displayName,
        displayNameSearch: displayNameSearch(data.displayName), bio: '', visibility: 'public',
        status: 'active', authVersion: 0, policyVersion: 0, avatarAssetId: null, createdAt: date, updatedAt: date,
      };
      const session = sessionFor(user, date);
      try {
        await repository.transaction((transaction) => repository.createAccount(user, session.record, {
          ownerId: user._id, name: 'Saved', nameNormalized: 'saved', isDefault: true, createdAt: date,
        }, transaction));
      } catch (error) { identityConflict(error); }
      return { user: selfUser(user), token: session.token, expiresAt: session.expiresAt };
    },

    async login(input) {
      const data = validateLogin(input);
      const user = await repository.findByEmail(data.email);
      // Missing identities still pay the same expensive verification cost.
      const matches = await verifyPassword(data.password, user?.passwordHash ?? dummyPasswordHash);
      if (!user || !matches || ['deleting', 'deleted'].includes(user.status)) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      }
      const session = sessionFor(user, now());
      await repository.createSession(session.record);
      return { user: selfUser(user), token: session.token, expiresAt: session.expiresAt };
    },

    async resolveSession(token) {
      const { user, session } = await resolveRecord(token);
      return { user: selfUser(user), sessionId: session._id.toString() };
    },

    async logout(token, expectedAccountId) {
      if (!validToken(token)) return;
      const tokenHash = hashToken(token);
      if (expectedAccountId !== undefined) {
        const session = await repository.findSession(tokenHash);
        if (session) assertAccountMatch(session.userId, expectedAccountId);
      }
      await repository.deleteSession(tokenHash);
    },

    async updateProfile(token, input, expectedAccountId) {
      const { user } = await resolveRecord(token);
      assertAccountMatch(user._id, expectedAccountId);
      if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot edit its profile.');
      const fields = validateProfile(input);
      if (fields.displayName !== undefined) fields.displayNameSearch = displayNameSearch(fields.displayName);
      let updated;
      try { updated = await repository.updateProfile(user._id, user.authVersion, fields, now()); }
      catch (error) { identityConflict(error); }
      if (!updated) throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'This account cannot edit its profile.');
      return selfUser(updated);
    },
  };
}
