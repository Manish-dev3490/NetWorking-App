const migrationId = '006-notifications';
const collectionName = 'notifications';

export async function assertNotificationsMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Notifications schema is not ready. Run the database migrations before starting the backend.');
  }
}

export async function migrateNotifications(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };

  const objectId = { bsonType: 'objectId' };
  const validator = { $and: [{ $jsonSchema: {
    bsonType: 'object', required: ['recipientId', 'actorId', 'type', 'createdAt', 'readAt'],
    additionalProperties: false,
    properties: {
      _id: objectId, recipientId: objectId, actorId: objectId, postId: objectId, commentId: objectId, relationshipId: objectId,
      type: { enum: ['follow', 'follow_request', 'follow_approved', 'post_like', 'post_comment'] },
      createdAt: { bsonType: 'date' }, readAt: { bsonType: ['date', 'null'] },
    },
  } }, { $expr: { $ne: ['$actorId', '$recipientId'] } }, { $or: [
    { type: { $in: ['follow', 'follow_request', 'follow_approved'] }, relationshipId: { $exists: true }, postId: { $exists: false }, commentId: { $exists: false } },
    { type: 'post_like', relationshipId: { $exists: false }, postId: { $exists: true }, commentId: { $exists: false } },
    { type: 'post_comment', relationshipId: { $exists: false }, postId: { $exists: true }, commentId: { $exists: true } },
  ] }] };
  const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
  if (exists) await db.command({ collMod: collectionName, validator, validationLevel: 'strict', validationAction: 'error' });
  else await db.createCollection(collectionName, { validator, validationLevel: 'strict', validationAction: 'error' });

  await db.collection(collectionName).createIndexes([
    { key: { recipientId: 1, type: 1, actorId: 1, postId: 1, commentId: 1 }, name: 'notifications_event_unique', unique: true },
    { key: { recipientId: 1, createdAt: -1, _id: -1 }, name: 'notifications_page' },
    { key: { recipientId: 1, readAt: 1 }, name: 'notifications_unread' },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
