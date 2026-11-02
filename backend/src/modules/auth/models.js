import mongoose from 'mongoose';

const options = { autoCreate: false, autoIndex: false, versionKey: false, strict: 'throw' };

export function createAuthModels(connection) {
  const userSchema = new mongoose.Schema({
    emailNormalized: { type: String, required: true, maxlength: 254 },
    usernameNormalized: { type: String, required: true, match: /^[a-z0-9_]{3,30}$/ },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true },
    displayNameSearch: { type: String, required: true },
    bio: { type: String, default: '' },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    avatarAssetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    policyVersion: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['active', 'suspended', 'deleting', 'deleted'], default: 'active' },
    authVersion: { type: Number, required: true, default: 0, min: 0 },
  }, { ...options, timestamps: true, collection: 'users' });
  const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    authVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    createdAt: { type: Date, required: true },
  }, { ...options, collection: 'sessions' });
  const collectionSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    nameNormalized: { type: String, required: true },
    isDefault: { type: Boolean, required: true },
    createdAt: { type: Date, required: true },
  }, { ...options, collection: 'saved_collections' });

  return {
    User: connection.models.AuthUser ?? connection.model('AuthUser', userSchema),
    Session: connection.models.AuthSession ?? connection.model('AuthSession', sessionSchema),
    SavedCollection: connection.models.AuthSavedCollection ?? connection.model('AuthSavedCollection', collectionSchema),
  };
}
