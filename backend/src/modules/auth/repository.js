import { createAuthModels } from './models.js';
import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';

export function createAuthRepository(connection) {
  const { User, Session, SavedCollection } = createAuthModels(connection);
  return {
    transaction: (work) => connection.transaction(work),
    findByEmail: (email) => User.findOne({ emailNormalized: email }).select('+passwordHash').lean(),
    async createAccount(user, session, savedCollection, transaction) {
      await User.create([user], { session: transaction });
      await Session.create([session], { session: transaction });
      await SavedCollection.create([savedCollection], { session: transaction });
    },
    createSession: (session) => Session.create(session),
    findSession: (tokenHash) => Session.findOne({ tokenHash }).lean(),
    findUser: (id) => User.findById(id).lean(),
    deleteSession: (tokenHash) => Session.deleteOne({ tokenHash }),
    async updateProfile(id, authVersion, fields, date = new Date()) {
      const users = connection.db.collection('users');
      const assets = connection.db.collection('media_assets');
      const images = connection.db.collection('media_images');
      let result;
      await connection.transaction(async (session) => {
        // Privacy shares the same user guard as graph changes. A racing follow
        // retries its transaction and chooses status from current visibility.
        const current = await users.findOneAndUpdate({ _id: id, status: 'active', authVersion },
          { $inc: { policyVersion: 1 } }, { session, returnDocument: 'after' });
        if (!current) { result = null; return; }
        const next = { ...fields, updatedAt: date };
        if (Object.hasOwn(fields, 'avatarAssetId')) {
          const avatarId = fields.avatarAssetId === null ? null : new mongoose.Types.ObjectId(fields.avatarAssetId);
          next.avatarAssetId = avatarId;
          const unchanged = avatarId && current.avatarAssetId?.equals(avatarId);
          if (avatarId && !unchanged) {
            const claimed = await assets.updateOne({ _id: avatarId, ownerId: id, purpose: 'avatar', state: 'ready', expiresAt: { $gt: date } },
              { $set: { state: 'attached' }, $unset: { expiresAt: '', postId: '' } }, { session });
            if (claimed.modifiedCount !== 1) throw new HttpError(409, 'ASSET_NOT_READY', 'Choose an available profile photo uploaded by this account.');
          }
          if (current.avatarAssetId && !unchanged) {
            const oldAvatar = await assets.findOne({ _id: current.avatarAssetId, ownerId: id, purpose: 'avatar', state: 'attached' }, { session, projection: { _id: 1 } });
            if (oldAvatar) {
              await images.deleteOne({ _id: oldAvatar._id }, { session });
              await assets.deleteOne({ _id: oldAvatar._id, ownerId: id, purpose: 'avatar' }, { session });
            }
          }
        }
        result = await users.findOneAndUpdate({ _id: id, status: 'active', authVersion }, { $set: next },
          { session, returnDocument: 'after', projection: { passwordHash: 0 } });
      });
      return result;
    },
  };
}
