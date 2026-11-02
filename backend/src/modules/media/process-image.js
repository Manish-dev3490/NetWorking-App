import sharp from 'sharp';
import { HttpError } from '../../shared/http-error.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

sharp.cache({ memory: 32, files: 0, items: 16 });
sharp.concurrency(1);

function animatedPng(input) {
  if (input.length < 8 || !input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  while (offset + 12 <= input.length) {
    const size = input.readUInt32BE(offset);
    if (size > input.length - offset - 12) break;
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IEND') break;
    offset += size + 12;
  }
  return false;
}

export function imageContentType(req) {
  const contentType = req.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (!formats[contentType] || (req.get('Content-Encoding') && req.get('Content-Encoding').toLowerCase() !== 'identity')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload a JPEG, PNG or WebP photo without transport compression.');
  }
  return contentType;
}

export async function processImage(input, contentType) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new HttpError(422, 'INVALID_IMAGE', 'Choose a valid photo to upload.');
  if (input.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Each photo must be 5 MiB or smaller.');
  try {
    const source = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192
      || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new HttpError(422, 'IMAGE_DIMENSIONS_EXCEEDED', 'Photos must be at most 20 megapixels and 8192 pixels on either side.');
    }
    if (!formats[contentType] || metadata.format !== formats[contentType]
      || (metadata.pages ?? 1) > 1 || animatedPng(input)) {
      throw new HttpError(422, 'INVALID_IMAGE', 'Upload a non-animated JPEG, PNG or WebP photo matching its file type.');
    }
    // Re-encoding decodes the image fully and strips EXIF/GPS and other metadata.
    const { data, info } = await source.rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The processed photo must be 5 MiB or smaller.');
    return { data, contentType: 'image/webp', width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (/pixel limit/i.test(error.message ?? '')) {
      throw new HttpError(422, 'IMAGE_DIMENSIONS_EXCEEDED', 'Photos must be at most 20 megapixels.');
    }
    throw new HttpError(422, 'INVALID_IMAGE', 'This photo could not be read. Choose a valid JPEG, PNG or WebP image.');
  }
}
