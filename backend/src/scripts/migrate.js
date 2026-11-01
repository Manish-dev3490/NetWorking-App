import { loadConfig } from '../config/env.js';
import { createDatabase } from '../config/database.js';
import { migrateAuth } from '../migrations/001-auth.js';

const database = createDatabase();
try {
  const config = loadConfig();
  await database.connect(config.mongoUri);
  const result = await migrateAuth(database.connection);
  console.info(result.applied ? 'Applied authentication migration 001-auth.' : 'Authentication migration 001-auth is already applied.');
} catch {
  console.error('Authentication migration failed. Check database access, permissions, duplicate identities and existing indexes. No records were deleted.');
  process.exitCode = 1;
} finally {
  await database.close();
}
