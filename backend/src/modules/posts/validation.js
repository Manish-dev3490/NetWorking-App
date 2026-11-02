import mongoose from 'mongoose';
import { HttpError } from '../../shared/http-error.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_PER_POST = 10;
export const MAX_READY_UPLOADS = 20;
export const MAX_MEMBER_IMAGES = 100;
export const MAX_MEMBER_BYTES = 50 * 1024 * 1024;

export function mediaPurpose(value = 'post') {
  if (!['post', 'avatar'].includes(value)) invalid('purpose');
  return value;
}

function invalid(path, code = 'INVALID_FORMAT') {
  const error = new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted post fields.');
  error.fields = [{ path, code }];
  throw error;
}

export function strictObject(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid('body', 'INVALID_TYPE');
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown !== undefined) invalid(unknown, 'UNKNOWN_FIELD');
}

export function objectId(value, path = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) invalid(path);
  return new mongoose.Types.ObjectId(value);
}

export function requestKey(value, path = 'Idempotency-Key') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid(path);
  return value.toLowerCase();
}

function text(value, path, max, defaultValue) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== 'string') invalid(path, 'INVALID_TYPE');
  const normalized = value.trim().normalize('NFC');
  if ([...normalized].length > max) invalid(path, 'TOO_LONG');
  return normalized;
}

function hashtags(input = []) {
  if (!Array.isArray(input)) invalid('hashtags', 'INVALID_TYPE');
  const values = [...new Set(input.map((value, index) => {
    const tag = text(value, `hashtags.${index}`, 51).replace(/^#/, '').toLowerCase();
    if (!tag || [...tag].length > 50 || !/^[\p{L}\p{N}\p{M}_]+$/u.test(tag)) invalid(`hashtags.${index}`);
    return tag;
  }))];
  if (values.length > 20) invalid('hashtags', 'TOO_MANY');
  return values;
}

function boolean(value, path, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') invalid(path, 'INVALID_TYPE');
  return value;
}

export function validatePublish(input) {
  strictObject(input, ['caption', 'hashtags', 'media', 'commentsEnabled']);
  if (!Array.isArray(input.media) || input.media.length < 1 || input.media.length > MAX_MEDIA_PER_POST) invalid('media', 'INVALID_COUNT');
  const media = input.media.map((item, index) => {
    strictObject(item, ['assetId', 'altText']);
    return {
      assetId: objectId(item.assetId, `media.${index}.assetId`),
      altText: text(item.altText, `media.${index}.altText`, 500, ''),
    };
  });
  if (new Set(media.map((item) => item.assetId.toHexString())).size !== media.length) invalid('media', 'DUPLICATE_ASSET');
  return {
    caption: text(input.caption, 'caption', 2200, ''), hashtags: hashtags(input.hashtags), media,
    commentsEnabled: boolean(input.commentsEnabled, 'commentsEnabled', true),
  };
}

export function validateEdit(input) {
  strictObject(input, ['expectedVersion', 'caption', 'hashtags', 'commentsEnabled', 'mediaAltText']);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) invalid('expectedVersion');
  const fields = {};
  if (Object.hasOwn(input, 'caption')) fields.caption = text(input.caption, 'caption', 2200);
  if (Object.hasOwn(input, 'hashtags')) fields.hashtags = hashtags(input.hashtags);
  if (Object.hasOwn(input, 'commentsEnabled')) {
    if (typeof input.commentsEnabled !== 'boolean') invalid('commentsEnabled', 'INVALID_TYPE');
    fields.commentsEnabled = input.commentsEnabled;
  }
  let mediaAltText;
  if (Object.hasOwn(input, 'mediaAltText')) {
    if (!Array.isArray(input.mediaAltText) || !input.mediaAltText.length || input.mediaAltText.length > MAX_MEDIA_PER_POST) invalid('mediaAltText', 'INVALID_COUNT');
    mediaAltText = input.mediaAltText.map((item, index) => {
      strictObject(item, ['assetId', 'altText']);
      return { assetId: objectId(item.assetId, `mediaAltText.${index}.assetId`), altText: text(item.altText, `mediaAltText.${index}.altText`, 500) };
    });
    if (new Set(mediaAltText.map((item) => item.assetId.toHexString())).size !== mediaAltText.length) invalid('mediaAltText', 'DUPLICATE_ASSET');
  }
  if (!Object.keys(fields).length && !mediaAltText) invalid('body', 'EMPTY_UPDATE');
  return { expectedVersion: input.expectedVersion, fields, mediaAltText };
}

export function validateProcessedImage(input) {
  if (!input || !Buffer.isBuffer(input.data) || !input.data.length || input.data.length > MAX_IMAGE_BYTES
    || input.contentType !== 'image/webp' || !Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height)
    || input.width < 1 || input.height < 1 || input.width > 2048 || input.height > 2048) {
    throw new HttpError(422, 'INVALID_IMAGE', 'Choose a supported photo within the image limits.');
  }
  return { ...input, purpose: mediaPurpose(input.purpose), uploadKey: requestKey(input.uploadKey, 'X-Upload-Key') };
}
