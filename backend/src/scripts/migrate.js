import { loadConfig } from '../config/env.js';
import { createDatabase } from '../config/database.js';
import { migrateAuth } from '../migrations/001-auth.js';
import { migratePosts } from '../migrations/002-posts.js';
import { migrateNetwork } from '../migrations/003-network.js';
import { migrateEngagement } from '../migrations/004-engagement.js';
import { migrateSavedPosts } from '../migrations/005-saved-posts.js';
import { migrateNotifications } from '../migrations/006-notifications.js';

const database = createDatabase();
try {
  const config = loadConfig();
  await database.connect(config.mongoUri);
  const result = await migrateAuth(database.connection);
  console.info(result.applied ? 'Applied authentication migration 001-auth.' : 'Authentication migration 001-auth is already applied.');
  const posts = await migratePosts(database.connection);
  console.info(posts.applied ? 'Applied posts migration 002-posts.' : 'Posts migration 002-posts is already applied.');
  const network = await migrateNetwork(database.connection);
  console.info(network.applied ? 'Applied member network migration 003-network.' : 'Member network migration 003-network is already applied.');
  const engagement = await migrateEngagement(database.connection);
  console.info(engagement.applied ? 'Applied post engagement migration 004-engagement.' : 'Post engagement migration 004-engagement is already applied.');
  const saved = await migrateSavedPosts(database.connection);
  console.info(saved.applied ? 'Applied Saved posts migration 005-saved-posts.' : 'Saved posts migration 005-saved-posts is already applied.');
  const notifications = await migrateNotifications(database.connection);
  console.info(notifications.applied ? 'Applied notifications migration 006-notifications.' : 'Notifications migration 006-notifications is already applied.');
} catch {
  console.error('Database migration failed. Check database access, permissions, duplicate identities and existing indexes. No records were deleted.');
  process.exitCode = 1;
} finally {
  await database.close();
}
