export const characterCount = (value) => [...value].length;

export function describeError(error) {
  if (error.name === 'TimeoutError') return 'This is taking longer than expected. Please try again.';
  if (error instanceof TypeError) return 'We couldn’t reach Gather. Check your connection and try again.';
  if (error.code === 'IDENTITY_UNAVAILABLE') return 'That email or username is already in use. Try another, or log in.';
  if (error.status === 429) return 'Too many attempts. Please wait a little before trying again.';
  if (error.code === 'CSRF_REJECTED') return 'Your request couldn’t be confirmed. Refresh the page and try again.';
  if (error.status >= 500) return 'Gather is temporarily unavailable. Please try again in a moment.';
  return error.message || 'Something went wrong. Please try again.';
}

export function validateProfile(values) {
  const errors = {};
  const displayName = values.displayName.trim().normalize('NFC');
  const searchableName = displayName.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!displayName || characterCount(displayName) > 60 || !searchableName) {
    errors.displayName = 'Enter a name between 1 and 60 characters.';
  }
  if (!/^[a-z0-9_]{3,30}$/.test(values.username.trim().normalize('NFC').toLowerCase())) {
    errors.username = 'Use 3–30 letters, numbers or underscores.';
  }
  if (values.bio !== undefined && characterCount(values.bio.trim().normalize('NFC')) > 160) errors.bio = 'Keep your bio to 160 characters.';
  return errors;
}

export function serverFieldErrors(error) {
  if (!Array.isArray(error.fields)) return {};
  return Object.fromEntries(error.fields.filter((field) => typeof field.path === 'string').map((field) => [
    field.path, field.message || 'Check this field and try again.',
  ]));
}
