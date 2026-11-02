import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import { discardImage } from '../posts/post-api.js';
import { MAX_IMAGE_BYTES } from '../posts/post-utils.js';

export default function AvatarEditor({ user, onSaved, disabled = false, onBusyChange }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const requestRef = useRef(null);
  const previewRef = useRef('');
  const assetRef = useRef(null);
  const keyRef = useRef(null);
  const bodyRef = useRef(null);
  useEffect(() => () => {
    requestRef.current?.abort();
    onBusyChange(false);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    if (assetRef.current) void discardImage(assetRef.current.id, user.id).catch(() => {});
  }, []);
  function clear() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ''; setPreview(''); setFile(null); keyRef.current = null; bodyRef.current = null;
    if (assetRef.current) void discardImage(assetRef.current.id, user.id).catch(() => {});
    assetRef.current = null; setError(''); setUncertain(false);
  }
  function select(event) {
    const selected = event.target.files[0]; event.target.value = '';
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || !selected.size || selected.size > MAX_IMAGE_BYTES) {
      setError('Choose a JPEG, PNG or WebP photo no larger than 5 MiB.'); return;
    }
    clear(); keyRef.current = crypto.randomUUID(); setFile(selected);
    previewRef.current = URL.createObjectURL(selected); setPreview(previewRef.current);
  }
  async function save(remove = false) {
    if (disabled || requestRef.current || (!remove && !file && !uncertain)) return;
    const controller = new AbortController(); requestRef.current = controller; setPending(true); onBusyChange(true); setError('');
    let attaching = false;
    try {
      if (!uncertain) {
        if (remove) bodyRef.current = { avatarAssetId: null };
        else {
          if (!assetRef.current) {
            const response = await apiRequest('media/uploads', { method: 'POST', accountId: user.id, rawBody: file, signal: controller.signal,
              headers: { 'Content-Type': file.type, 'Idempotency-Key': keyRef.current, 'X-Media-Purpose': 'avatar' } });
            if (controller.signal.aborted) return;
            assetRef.current = response.data;
          }
          bodyRef.current = { avatarAssetId: assetRef.current.id };
        }
      }
      attaching = true;
      const response = await apiRequest('me/profile', { method: 'PATCH', accountId: user.id, body: bodyRef.current, signal: controller.signal });
      if (controller.signal.aborted) return;
      assetRef.current = null;
      clear(); onSaved(response.data);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (attaching && (failure instanceof TypeError || failure.name === 'TimeoutError' || failure.code === 'INVALID_RESPONSE' || failure.status >= 500)) {
        setUncertain(true); setError('The photo update could not be confirmed. Retry to check the same update.');
      } else {
        if (failure.code === 'ASSET_NOT_READY') {
          if (assetRef.current) void discardImage(assetRef.current.id, user.id).catch(() => {});
          assetRef.current = null; bodyRef.current = null;
          keyRef.current = crypto.randomUUID(); setUncertain(false);
        }
        setError(describeError(failure));
      }
    } finally { if (requestRef.current === controller) requestRef.current = null; if (!controller.signal.aborted) { setPending(false); onBusyChange(false); } }
  }
  return <section className="avatar-editor" aria-label="Profile photo" aria-busy={pending}><Avatar src={preview || user.avatarUrl} name={user.displayName} size={60} /><div className="avatar-editor-controls">
    <label className="button button-secondary compact-button avatar-file-label">Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={select} disabled={disabled || pending || uncertain} aria-label="Choose profile photo" /></label>
    {(file || uncertain) && <button type="button" className="button button-primary compact-button" disabled={disabled || pending} onClick={() => save()}>{pending ? 'Saving…' : uncertain ? 'Retry photo update' : 'Save photo'}</button>}
    {file && !uncertain && <button type="button" className="text-button" onClick={clear} disabled={disabled || pending}>Cancel photo</button>}
    {user.avatarUrl && !file && !uncertain && <button type="button" className="text-button" disabled={disabled || pending} onClick={() => save(true)}>{pending ? 'Removing…' : 'Remove photo'}</button>}
    <p>JPEG, PNG or WebP · up to 5 MiB. Your photo is visible to signed-in members.</p>{error && <p className="network-error" role="alert">{error}</p>}
  </div></section>;
}
