import { apiRequest } from '../../services/api.js';

export function uploadImage(file, accountId, uploadKey, signal) {
  return apiRequest('media/uploads', {
    method: 'POST', accountId, rawBody: file, signal,
    headers: { 'Content-Type': file.type, 'Idempotency-Key': uploadKey },
  });
}

export function discardImage(assetId, accountId) {
  return apiRequest(`media/${assetId}`, { method: 'DELETE', accountId });
}

export function publishPost(body, accountId, publishKey, signal) {
  return apiRequest('posts', {
    method: 'POST', accountId, body, signal, headers: { 'Idempotency-Key': publishKey },
  });
}
