import { MAX_COMMENT_LENGTH } from '../modules/posts/validation.js';
import { postValidators } from './002-posts.js';

const migrationId = '004-engagement';
const nonnegative = { bsonType: ['int', 'long', 'double'], minimum: 0 };

export async function assertEngagementMigration(connection) {
  if (!connection.db || !await connection.db.collection('schema_migrations').findOne({ _id: migrationId })) {
    throw new Error('Post engagement schema is not ready. Run the database migrations before starting the backend.');
  }
}

export async function migrateEngagement(connection) {
  const db = connection.db;
  if (!db) throw new Error('Connect to MongoDB before running migrations.');
  const migrations = db.collection('schema_migrations');
  if (await migrations.findOne({ _id: migrationId })) return { applied: false, version: migrationId };

  const posts = structuredClone(postValidators.posts);
  Object.assign(posts.$jsonSchema.properties, { likeCount: nonnegative, commentCount: nonnegative });
  const likes = { $jsonSchema: {
    bsonType: 'object', required: ['postId', 'memberId', 'createdAt'],
    properties: { postId: { bsonType: 'objectId' }, memberId: { bsonType: 'objectId' }, createdAt: { bsonType: 'date' } },
  } };
  const comments = { $and: [{ $jsonSchema: {
    bsonType: 'object', required: ['postId', 'authorId', 'status', 'requestKey', 'requestHash', 'editVersion', 'createdAt', 'updatedAt'],
    properties: {
      postId: { bsonType: 'objectId' }, authorId: { bsonType: 'objectId' }, status: { enum: ['visible', 'deleted'] },
      text: { bsonType: 'string', minLength: 1, maxLength: MAX_COMMENT_LENGTH },
      requestKey: { bsonType: 'string' }, requestHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      editVersion: nonnegative, createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
    },
  } }, { $or: [
    { status: 'visible', text: { $exists: true } }, { status: 'deleted', text: { $exists: false } },
  ] }] };

  for (const [name, validator] of [['posts', posts], ['post_likes', likes], ['post_comments', comments]]) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (exists) await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
  }
  await db.collection('post_likes').createIndex({ postId: 1, memberId: 1 }, { name: 'post_likes_member_unique', unique: true });
  await db.collection('post_comments').createIndexes([
    { key: { postId: 1, authorId: 1, requestKey: 1 }, name: 'post_comments_request_unique', unique: true },
    { key: { postId: 1, status: 1, createdAt: -1, _id: -1 }, name: 'post_comments_page' },
  ]);
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  return { applied: true, version: migrationId };
}
