import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function readConfig(env = process.env) {
  const errors = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const portValue = env.PORT ?? '3000';
  const host = env.HOST ?? '127.0.0.1';
  const mongoUri = env.MONGODB_URI?.trim();
  const authSecret = env.AUTH_SECRET?.trim();
  let appOrigin;

  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV must be development, test, or production.');
  }

  if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    errors.push('PORT must be an integer between 1 and 65535.');
  }

  if (!host.trim()) {
    errors.push('HOST must not be empty.');
  }

  if (!mongoUri) {
    errors.push('MONGODB_URI is required. Set it in backend/.env or the process environment.');
  } else if (!/^mongodb(?:\+srv)?:\/\/\S+$/.test(mongoUri)) {
    errors.push('MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string.');
  }

  if (!authSecret || !/^[a-f0-9]{64}$/i.test(authSecret)) {
    errors.push('AUTH_SECRET must contain 64 random hexadecimal characters.');
  }

  try {
    const url = new URL(env.APP_ORIGIN ?? (nodeEnv === 'production' ? '' : 'http://localhost:5173'));
    const localHttp = nodeEnv !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost';
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error();
    appOrigin = url.origin;
  } catch {
    errors.push('APP_ORIGIN must be an HTTPS origin, or http://localhost with a port for development.');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid backend configuration:\n${errors.join('\n')}`);
  }

  return Object.freeze({ nodeEnv, host: host.trim(), port: Number(portValue), mongoUri, authSecret, appOrigin });
}

export function loadConfig() {
  // Resolve from this module so startup works from either the root or backend/.
  const envFile = fileURLToPath(new URL('../../.env', import.meta.url));

  try {
    loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error('Could not read backend/.env. Check its permissions and format.', { cause: error });
    }
  }

  return readConfig();
}
