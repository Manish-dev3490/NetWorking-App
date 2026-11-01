const migrationId = '001-auth';

export async function assertAuthMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Authentication schema is not ready. Run the authentication migration before starting the backend.');
  }
}

const validators = {
  users: {
    $jsonSchema: { bsonType: 'object', required: ['emailNormalized', 'usernameNormalized', 'passwordHash', 'displayName', 'displayNameSearch', 'status', 'authVersion', 'createdAt', 'updatedAt'],
      properties: {
        emailNormalized: { bsonType: 'string', maxLength: 254 },
        usernameNormalized: { bsonType: 'string', pattern: '^[a-z0-9_]{3,30}$' },
        passwordHash: { bsonType: 'string' }, displayName: { bsonType: 'string', minLength: 1, maxLength: 60 },
        displayNameSearch: { bsonType: 'string' }, bio: { bsonType: 'string', maxLength: 160 },
        status: { enum: ['active', 'suspended', 'deleting', 'deleted'] },
        visibility: { enum: ['public', 'private'] }, authVersion: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
      } },
  },
  sessions: {
    $jsonSchema: { bsonType: 'object', required: ['userId', 'tokenHash', 'authVersion', 'expiresAt', 'createdAt'], properties: {
      userId: { bsonType: 'objectId' }, tokenHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      authVersion: { bsonType: ['int', 'long', 'double'], minimum: 0 }, expiresAt: { bsonType: 'date' },
      revokedAt: { bsonType: 'date' }, createdAt: { bsonType: 'date' },
    } },
  },
  saved_collections: {
    $jsonSchema: { bsonType: 'object', required: ['ownerId', 'name', 'nameNormalized', 'isDefault', 'createdAt'], properties: {
      ownerId: { bsonType: 'objectId' }, name: { bsonType: 'string', minLength: 1, maxLength: 60 },
      nameNormalized: { bsonType: 'string' }, isDefault: { bsonType: 'bool' }, createdAt: { bsonType: 'date' },
    } },
  },
};

// Run explicitly before serving authentication. No data is dropped or rewritten.
export async function migrateAuth(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };

  for (const [name, validator] of Object.entries(validators)) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  }

  // MongoDB refuses unique indexes if existing identities conflict; do not silently repair data.
  await db.collection('users').createIndexes([
    { key: { emailNormalized: 1 }, name: 'users_email_unique', unique: true },
    { key: { usernameNormalized: 1 }, name: 'users_username_unique', unique: true },
  ]);
  await db.collection('sessions').createIndexes([
    { key: { tokenHash: 1 }, name: 'sessions_token_unique', unique: true },
    { key: { userId: 1 }, name: 'sessions_user' },
    { key: { expiresAt: 1 }, name: 'sessions_expiry', expireAfterSeconds: 0 },
  ]);
  await db.collection('saved_collections').createIndexes([
    { key: { ownerId: 1, nameNormalized: 1 }, name: 'collections_owner_name_unique', unique: true },
    { key: { ownerId: 1 }, name: 'collections_default_unique', unique: true, partialFilterExpression: { isDefault: true } },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
