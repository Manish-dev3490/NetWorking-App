import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES, processImage } from '../src/modules/media/process-image.js';

const pixels = { create: { width: 80, height: 50, channels: 3, background: '#496657' } };

test('allowed photos become bounded WebP images with original metadata removed', async () => {
  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const input = await sharp(pixels)[format]().withMetadata().toBuffer();
    const result = await processImage(input, mime);
    assert.ok(Buffer.isBuffer(result.data));
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.width, 80);
    assert.equal(result.height, 50);
    const metadata = await sharp(result.data).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(result.data.length <= MAX_IMAGE_BYTES);
  }
});

test('EXIF orientation is applied and larger valid photos are resized', async () => {
  const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#eaf0eb' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await processImage(input, 'image/jpeg');
  assert.equal(result.width, 1024);
  assert.equal(result.height, 2048);
  assert.equal((await sharp(result.data).metadata()).orientation, undefined);
});

test('corrupt, disguised and unsupported image payloads are rejected', async () => {
  const png = await sharp(pixels).png().toBuffer();
  for (const [input, mime] of [
    [Buffer.from('not an image'), 'image/jpeg'],
    [png, 'image/jpeg'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'), 'image/png'],
    [png.subarray(0, 32), 'image/png'],
  ]) {
    await assert.rejects(processImage(input, mime), (error) => error.status === 422 && error.code === 'INVALID_IMAGE');
  }
});

test('byte and decoded-dimension caps apply before a photo can be stored', async () => {
  await assert.rejects(processImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'),
    (error) => error.status === 413 && error.code === 'PAYLOAD_TOO_LARGE');
  const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#496657' } }).png().toBuffer();
  await assert.rejects(processImage(wide, 'image/png'),
    (error) => error.status === 422 && error.code === 'IMAGE_DIMENSIONS_EXCEEDED');
  const tooManyPixels = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#496657' } }).png().toBuffer();
  assert.ok(tooManyPixels.length < MAX_IMAGE_BYTES);
  await assert.rejects(processImage(tooManyPixels, 'image/png'),
    (error) => error.status === 422 && error.code === 'IMAGE_DIMENSIONS_EXCEEDED');
});
