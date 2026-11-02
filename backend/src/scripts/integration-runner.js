import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';

// Auth/post tests create and remove only their own randomly named test databases.
// The configured application database is used solely for the existing ping test.
try {
  const config = loadConfig();
  const child = spawn(process.execPath, ['--test', 'test/auth-integration.test.js', 'test/posts-integration.test.js', 'test/network-integration.test.js', 'test/database.test.js'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    stdio: 'inherit',
    env: { ...process.env, TEST_MONGODB_URI: process.env.TEST_MONGODB_URI || config.mongoUri },
  });
  child.once('error', () => {
    console.error('Could not start the database integration tests.');
    process.exitCode = 1;
  });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
} catch {
  console.error('Database integration tests need valid local backend configuration.');
  process.exitCode = 1;
}
