const migrationId = '005-saved-posts';
const collectionName = 'saved_posts';

export async function assertSavedPostsMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Saved posts schema is not ready. Run the database migrations before starting the backend.');
  }
}

export async function migrateSavedPosts(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };

  const validator = { $jsonSchema: {
    bsonType: 'object', required: ['collectionId', 'postId', 'createdAt'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' }, collectionId: { bsonType: 'objectId' },
      postId: { bsonType: 'objectId' }, createdAt: { bsonType: 'date' },
    },
  } };
  const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (exists) await db.command({ collMod: collectionName, validator, validationLevel: 'strict', validationAction: 'error' });
  else await db.createCollection(collectionName, { validator, validationLevel: 'strict', validationAction: 'error' });

  await db.collection(collectionName).createIndexes([
    { key: { postId: 1, collectionId: 1 }, name: 'saved_posts_collection_post_unique', unique: true },
    { key: { collectionId: 1, createdAt: -1, _id: -1 }, name: 'saved_posts_page' },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
