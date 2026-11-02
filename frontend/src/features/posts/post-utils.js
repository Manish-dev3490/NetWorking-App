export const MAX_PHOTOS = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_POST_PAYLOAD_BYTES = 32 * 1024;
export const countCharacters = (text) => [...text].length;

export function normalizedTags(text) {
  return [...new Set(text.split(/[\s,]+/u).map((tag) => tag.replace(/^#+/, '').normalize('NFC').toLowerCase()).filter(Boolean))];
}

export function validatePostFields(caption, tags) {
  if (countCharacters(caption.trim().normalize('NFC')) > 2200) return 'Keep your caption to 2,200 characters.';
  if (tags.length > 20 || tags.some((tag) => countCharacters(tag) > 50)) return 'Use up to 20 hashtags, with no more than 50 characters each.';
  if (tags.some((tag) => !/^[\p{L}\p{N}\p{M}_]+$/u.test(tag))) return 'Hashtags can contain letters, numbers and underscores.';
  return '';
}

export function validatePostPayload(body) {
  // Match the JSON API's byte limit, including UTF-8 and JSON escaping.
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_POST_PAYLOAD_BYTES) {
    return 'This post has too much text overall. Shorten the caption, hashtags or photo descriptions before publishing.';
  }
  return '';
}

export function formatPostDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
