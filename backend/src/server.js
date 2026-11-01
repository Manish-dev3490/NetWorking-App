import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase } from './config/database.js';
import { loadConfig } from './config/env.js';
import { createAuthService } from './modules/auth/service.js';
import { assertAuthMigration } from './migrations/001-auth.js';

const database = createDatabase();
let server;
let stopping = false;
let shutdownTask;
let stage = 'configuration';

function shutdown(exitCode = 0) {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
  if (shutdownTask) {
    return shutdownTask;
  }
  stopping = true;
  process.exitCode ??= exitCode;

  shutdownTask = (async () => {
    const deadline = setTimeout(() => {
      console.error('Shutdown timed out; forcing process exit.');
      process.exit(1);
    }, 10_000);
    deadline.unref();

    try {
      // Finish pending connect/listen operations before closing their resources.
      // start() checks stopping before opening HTTP and before logging success.
      await startupTask.catch(() => {});
      if (server?.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } catch {
      console.error('HTTP cleanup failed during shutdown.');
      process.exitCode = 1;
    } finally {
      try {
        await database.close();
      } catch {
        console.error('Database cleanup failed during shutdown.');
        process.exitCode = 1;
      }
      clearTimeout(deadline);
    }
  })();

  return shutdownTask;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.info(`Received ${signal}; shutting down.`);
    void shutdown();
  });
}

async function start() {
  const config = loadConfig();
  stage = 'database';
  await database.connect(config.mongoUri);
  if (!stopping) {
    stage = 'authentication';
    await assertAuthMigration(database.connection);
    const authService = createAuthService({ connection: database.connection });
    stage = 'http';
    server = createServer(createApp({ database, authService, config }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', () => {
      console.error('HTTP server failed.');
      void shutdown(1);
    });
    if (!stopping) {
      console.info(`Backend listening on http://${config.host}:${config.port}`);
    }
  }
}

const startupTask = start();

try {
  await startupTask;
} catch (error) {
  const messages = {
    configuration: error.message,
    database: 'MongoDB connection failed. Check MONGODB_URI, database availability, credentials, and network access.',
    authentication: 'Authentication initialization failed. Check the auth database migration.',
    http: 'HTTP startup failed. Check HOST, PORT, and whether the port is already in use.',
  };
  console.error(`Startup failed: ${messages[stage]}`);
  await shutdown(1);
}
