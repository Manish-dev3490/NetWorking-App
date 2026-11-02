export const SESSION_COOKIE = '__Host-session';

export function sessionToken(req) {
  const values = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return undefined;
  try { return decodeURIComponent(values[0].slice(SESSION_COOKIE.length + 1)); }
  catch { return undefined; }
}
