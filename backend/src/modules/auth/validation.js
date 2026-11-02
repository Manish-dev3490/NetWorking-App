import { HttpError } from '../../shared/http-error.js';

const reservedUsernames = new Set([
  'admin', 'administrator', 'api', 'auth', 'gather', 'help', 'login', 'logout',
  'me', 'moderator', 'register', 'root', 'security', 'settings', 'signup', 'support',
]);
const length = (value) => [...value].length;

function invalid(fields) {
  const error = new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted fields.');
  error.fields = fields;
  throw error;
}

function checkObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    invalid([{ path: 'body', code: 'INVALID_TYPE' }]);
  }
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) invalid(unknown.map((path) => ({ path, code: 'UNKNOWN_FIELD' })));
}

function text(input, field, errors, { min = 0, max, trim = true } = {}) {
  if (typeof input[field] !== 'string') {
    errors.push({ path: field, code: 'REQUIRED' });
    return '';
  }
  const value = trim ? input[field].trim().normalize('NFC') : input[field];
  if (length(value) < min) errors.push({ path: field, code: 'TOO_SHORT' });
  if (max !== undefined && length(value) > max) errors.push({ path: field, code: 'TOO_LONG' });
  return value;
}

function emailField(input, errors) {
  const email = text(input, 'email', errors, { min: 1, max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ path: 'email', code: 'INVALID_FORMAT' });
  return email;
}

function usernameField(input, errors) {
  const username = text(input, 'username', errors, { min: 3, max: 30 }).toLowerCase();
  if (username && !/^[a-z0-9_]+$/.test(username)) errors.push({ path: 'username', code: 'INVALID_FORMAT' });
  if (reservedUsernames.has(username)) errors.push({ path: 'username', code: 'RESERVED' });
  return username;
}

function displayNameField(input, errors) {
  const value = text(input, 'displayName', errors, { min: 1, max: 60 });
  // A mark-only name has no searchable value and fails the required model field.
  if (value && !displayNameSearch(value).trim()) errors.push({ path: 'displayName', code: 'INVALID_FORMAT' });
  return value;
}

function passwordField(input, errors, registering) {
  const password = text(input, 'password', errors, { min: registering ? 15 : 1, max: 128, trim: false });
  if (Buffer.byteLength(password, 'utf8') > 512) errors.push({ path: 'password', code: 'TOO_LONG' });
  return password;
}

export function validateRegistration(input) {
  checkObject(input, ['email', 'username', 'displayName', 'password']);
  const errors = [];
  const value = {
    email: emailField(input, errors), username: usernameField(input, errors),
    displayName: displayNameField(input, errors),
    password: passwordField(input, errors, true),
  };
  if (errors.length) invalid(errors);
  return value;
}

export function validateLogin(input) {
  checkObject(input, ['email', 'password']);
  const errors = [];
  const value = { email: emailField(input, errors), password: passwordField(input, errors, false) };
  if (errors.length) invalid(errors);
  return value;
}

export function validateProfile(input) {
  checkObject(input, ['username', 'displayName', 'bio', 'visibility', 'avatarAssetId']);
  if (!Object.keys(input).length) invalid([{ path: 'body', code: 'EMPTY_UPDATE' }]);
  const errors = [];
  const value = {};
  if (Object.hasOwn(input, 'username')) value.usernameNormalized = usernameField(input, errors);
  if (Object.hasOwn(input, 'displayName')) value.displayName = displayNameField(input, errors);
  if (Object.hasOwn(input, 'bio')) value.bio = text(input, 'bio', errors, { max: 160 });
  if (Object.hasOwn(input, 'visibility')) {
    if (!['public', 'private'].includes(input.visibility)) errors.push({ path: 'visibility', code: 'INVALID_FORMAT' });
    else value.visibility = input.visibility;
  }
  if (Object.hasOwn(input, 'avatarAssetId')) {
    if (input.avatarAssetId !== null && (typeof input.avatarAssetId !== 'string' || !/^[a-f0-9]{24}$/i.test(input.avatarAssetId))) {
      errors.push({ path: 'avatarAssetId', code: 'INVALID_FORMAT' });
    } else value.avatarAssetId = input.avatarAssetId === null ? null : input.avatarAssetId.toLowerCase();
  }
  if (errors.length) invalid(errors);
  return value;
}

export function displayNameSearch(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
