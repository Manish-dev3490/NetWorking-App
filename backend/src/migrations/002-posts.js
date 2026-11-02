const migrationId = '002-posts';

export async function assertPostsMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Post schema is not ready. Run the database migrations before starting the backend.');
  }
}

const validators = {
  media_assets: { $jsonSchema: {
    bsonType: 'object', required: ['ownerId', 'state', 'purpose', 'contentType', 'width', 'height', 'sizeBytes', 'uploadKey', 'contentHash', 'createdAt'],
    properties: {
      ownerId: { bsonType: 'objectId' }, state: { enum: ['ready', 'attached'] }, purpose: { enum: ['post'] },
      contentType: { enum: ['image/webp'] }, width: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 2048 },
      height: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 2048 },
      sizeBytes: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 5 * 1024 * 1024 },
      uploadKey: { bsonType: 'string' }, contentHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      postId: { bsonType: 'objectId' }, expiresAt: { bsonType: 'date' }, createdAt: { bsonType: 'date' },
    },
  } },
  media_images: { $jsonSchema: { bsonType: 'object', required: ['data'], properties: { data: { bsonType: 'binData' } } } },
  posts: { $jsonSchema: {
    bsonType: 'object', required: ['authorId', 'caption', 'hashtags', 'media', 'commentsEnabled', 'status', 'editVersion', 'publishKey', 'requestHash', 'createdAt', 'updatedAt'],
    properties: {
      authorId: { bsonType: 'objectId' }, caption: { bsonType: 'string', maxLength: 2200 },
      hashtags: { bsonType: 'array', maxItems: 20, items: { bsonType: 'string', maxLength: 50 } },
      media: { bsonType: 'array', minItems: 1, maxItems: 10, items: { bsonType: 'object', required: ['assetId', 'altText', 'width', 'height'], properties: {
        assetId: { bsonType: 'objectId' }, altText: { bsonType: 'string', maxLength: 500 },
        width: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 2048 }, height: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 2048 },
      } } },
      commentsEnabled: { bsonType: 'bool' }, status: { enum: ['published', 'deleted'] },
      editVersion: { bsonType: ['int', 'long', 'double'], minimum: 0 }, publishKey: { bsonType: 'string' },
      requestHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' }, createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }, deletedAt: { bsonType: 'date' },
    },
  } },
};

export async function migratePosts(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };
  for (const [name, validator] of Object.entries(validators)) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  }
  await db.collection('media_assets').createIndexes([
    { key: { ownerId: 1, uploadKey: 1 }, name: 'media_owner_upload_unique', unique: true },
    { key: { ownerId: 1, state: 1, expiresAt: 1 }, name: 'media_owner_quota' },
    { key: { state: 1, expiresAt: 1 }, name: 'media_orphan_cleanup' },
    { key: { postId: 1 }, name: 'media_post' },
  ]);
  await db.collection('posts').createIndexes([
    { key: { authorId: 1, publishKey: 1 }, name: 'posts_author_publish_unique', unique: true },
    { key: { status: 1, createdAt: -1, _id: -1 }, name: 'posts_recent' },
    { key: { authorId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'posts_own' },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
