import { authValidators } from './001-auth.js';
import { postValidators } from './002-posts.js';

const migrationId = '003-network';

export async function assertNetworkMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Member network schema is not ready. Run the database migrations before starting the backend.');
  }
}

export async function migrateNetwork(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };
  const users = structuredClone(authValidators.users);
  Object.assign(users.$jsonSchema.properties, {
    policyVersion: { bsonType: ['int', 'long', 'double'], minimum: 0 },
    avatarAssetId: { bsonType: ['objectId', 'null'] },
  });
  const media = structuredClone(postValidators.media_assets);
  media.$jsonSchema.properties.purpose.enum = ['post', 'avatar'];
  const follows = { $and: [{ $jsonSchema: {
    bsonType: 'object', required: ['followerId', 'followingId', 'status', 'createdAt'],
    properties: { followerId: { bsonType: 'objectId' }, followingId: { bsonType: 'objectId' },
      status: { enum: ['pending', 'accepted'] }, createdAt: { bsonType: 'date' }, acceptedAt: { bsonType: 'date' } },
  } }, { $expr: { $ne: ['$followerId', '$followingId'] } }, { $or: [
    { status: 'pending', acceptedAt: { $exists: false } }, { status: 'accepted', acceptedAt: { $type: 'date' } },
  ] }] };
  for (const [name, validator] of [['users', users], ['media_assets', media], ['follows', follows]]) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (exists) await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
  }
  await db.collection('follows').createIndexes([
    { key: { followerId: 1, followingId: 1 }, name: 'follows_pair_unique', unique: true },
    { key: { followerId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'follows_outgoing_page' },
    { key: { followingId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'follows_incoming_page' },
  ]);
  await db.collection('users').createIndexes([
    { key: { usernameNormalized: 1, _id: 1 }, name: 'users_username_search' },
    { key: { displayNameSearch: 1, _id: 1 }, name: 'users_display_name_search' },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
