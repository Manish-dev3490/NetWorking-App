import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { describeError } from '../auth/form-utils.js';
import { discardImage, publishPost, uploadImage } from './post-api.js';
import { countCharacters, MAX_IMAGE_BYTES, MAX_PHOTOS, normalizedTags, validatePostFields, validatePostPayload } from './post-utils.js';
import './posts.css';

export default function PostComposer({ user, onClose, onPublished }) {
  const [photos, setPhotos] = useState([]);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [pending, setPending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const dialogRef = useRef(null);
  const photosRef = useRef(photos);
  const requestRef = useRef(null);
  const uploadedRef = useRef(new Map());
  const publishedRef = useRef(false);
  const publishKeyRef = useRef(crypto.randomUUID());
  const publishBodyRef = useRef(null);
  photosRef.current = photos;

  useEffect(() => {
    dialogRef.current.showModal();
    return () => {
      requestRef.current?.abort();
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.preview);
      if (!publishedRef.current) {
        for (const asset of uploadedRef.current.values()) void discardImage(asset.id, user.id).catch(() => {});
      }
    };
  }, []);

  function edited() { setError(''); publishKeyRef.current = crypto.randomUUID(); }
  function close() {
    if (publishing) return;
    requestRef.current?.abort();
    onClose();
  }
  function selectFiles(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (files.length + photos.length > MAX_PHOTOS) { setError('A post can have up to 10 photos.'); return; }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setError('Choose JPEG, PNG or WebP photos.'); return;
    }
    if (files.some((file) => !file.size || file.size > MAX_IMAGE_BYTES)) {
      setError('Each photo must be nonempty and no larger than 5 MiB.'); return;
    }
    edited();
    setPhotos((previous) => [...previous, ...files.map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), altText: '' }))]);
  }
  function removePhoto(key) {
    const photo = photos.find((entry) => entry.key === key);
    if (!photo) return;
    URL.revokeObjectURL(photo.preview);
    const asset = uploadedRef.current.get(key);
    if (asset) { uploadedRef.current.delete(key); void discardImage(asset.id, user.id).catch(() => {}); }
    setPhotos((previous) => previous.filter((entry) => entry.key !== key)); edited();
  }
  function movePhoto(index, direction) {
    setPhotos((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    }); edited();
  }
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const hashtags = normalizedTags(tags);
    const validation = validatePostFields(caption, hashtags);
    if (!photos.length || validation || photos.some((photo) => countCharacters(photo.altText.trim().normalize('NFC')) > 500)) {
      setError(validation || (!photos.length ? 'Add at least one photo to your post.' : 'Keep each photo description to 500 characters.')); return;
    }
    const body = uncertain ? publishBodyRef.current : {
      caption: caption.trim().normalize('NFC'), hashtags,
      media: photos.map((photo) => ({
        // Real asset IDs are also 24 ASCII hex characters, so this gives the
        // exact final JSON size before any photo needs to be uploaded.
        assetId: uploadedRef.current.get(photo.key)?.id ?? '000000000000000000000000',
        altText: photo.altText.trim().normalize('NFC'),
      })),
    };
    const payloadError = validatePostPayload(body);
    if (payloadError) { setError(payloadError); return; }
    const controller = new AbortController(); requestRef.current = controller;
    setPending(true); setError('');
    let publishStarted = false;
    try {
      if (!uncertain) {
        for (let index = 0; index < photos.length; index += 1) {
          const photo = photos[index];
          let asset = uploadedRef.current.get(photo.key);
          if (!asset) {
            setProgress(`Uploading photo ${index + 1} of ${photos.length}…`);
            const response = await uploadImage(photo.file, user.id, photo.key, controller.signal);
            asset = response.data; uploadedRef.current.set(photo.key, asset);
          }
          body.media[index].assetId = asset.id;
        }
        publishBodyRef.current = body;
      }
      publishStarted = true; setPublishing(true); setProgress('Publishing your moment…');
      const response = await publishPost(publishBodyRef.current, user.id, publishKeyRef.current, controller.signal);
      if (controller.signal.aborted) return;
      publishedRef.current = true;
      onPublished(response.data);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const unknownOutcome = publishStarted && (failure instanceof TypeError || failure.name === 'TimeoutError' || failure.code === 'INVALID_RESPONSE' || failure.status >= 500);
      if (unknownOutcome) {
        setUncertain(true);
        setError('The publish result could not be confirmed. Retry publish to check the same post without creating a duplicate.');
      } else setError(describeError(failure));
    } finally {
      if (!controller.signal.aborted) { setPending(false); setPublishing(false); setProgress(''); }
    }
  }

  return <dialog ref={dialogRef} className="post-dialog composer-dialog" aria-labelledby="composer-heading"
    onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
    <header className="post-dialog-heading"><div><p className="auth-eyebrow">Make room for your next moment</p><h2 id="composer-heading">Create a post</h2></div><button type="button" className="icon-button" aria-label="Close create post" disabled={publishing} onClick={close}><Icon name="close" /></button></header>
    <p className="composer-intro">A photo, a little context, a moment worth sharing.</p>
    {error && <p className="form-error-summary" role="alert">{error}</p>}
    <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending || uncertain} className="composer-fields"><legend className="sr-only">Post details</legend>
        <label className={`photo-picker ${photos.length ? 'has-photos' : ''}`}><Icon name="plus" size={25} /><strong>{photos.length ? 'Add more photos' : 'Choose your photos'}</strong><span>JPEG, PNG or WebP · up to 5 MiB each · 10 photos maximum</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectFiles} disabled={photos.length >= MAX_PHOTOS || pending || uncertain} /></label>
        {photos.length > 0 && <div className="composer-photos">{photos.map((photo, index) => <section key={photo.key} className="composer-photo">
          <img src={photo.preview} alt={`Selected photo ${index + 1}`} /><div className="composer-photo-controls"><span>Photo {index + 1}</span><div><button type="button" className="icon-button" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0} onClick={() => movePhoto(index, -1)}><Icon name="chevron-left" size={16} /></button><button type="button" className="icon-button" aria-label={`Move photo ${index + 1} later`} disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)}><Icon name="chevron-right" size={16} /></button><button type="button" className="icon-button" aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(photo.key)}><Icon name="close" size={16} /></button></div></div>
          <label htmlFor={`alt-${photo.key}`}>Photo description <span className="field-optional">Optional</span></label><input id={`alt-${photo.key}`} value={photo.altText} maxLength={1000} placeholder="Describe what’s in this photo" onChange={(event) => { const value = event.target.value; setPhotos((previous) => previous.map((entry) => entry.key === photo.key ? { ...entry, altText: value } : entry)); edited(); }} />
        </section>)}</div>}
        <div className="form-field"><label htmlFor="post-caption">Caption <span className="field-optional">Optional</span></label><textarea id="post-caption" rows={4} maxLength={4400} value={caption} placeholder="What’s the story behind this moment?" onChange={(event) => { setCaption(event.target.value); edited(); }} /><p className="field-hint">{countCharacters(caption.trim().normalize('NFC'))} / 2,200 characters</p></div>
        <div className="form-field"><label htmlFor="post-tags">Hashtags <span className="field-optional">Optional</span></label><input id="post-tags" value={tags} maxLength={2000} placeholder="slowliving, madebyhand" onChange={(event) => { setTags(event.target.value); edited(); }} /><p className="field-hint">Separate tags with spaces or commas. Up to 20.</p></div>
      </fieldset>
      {progress && <p className="composer-progress" role="status"><span className="loading-dot" />{progress}</p>}
      <footer className="post-dialog-actions"><button type="button" className="button button-secondary" onClick={close} disabled={publishing}>Cancel</button><button type="submit" className="button button-primary" disabled={pending || !photos.length}>{pending ? 'Sharing your moment…' : uncertain ? 'Retry publish' : 'Publish post'}<Icon name="chevron-right" size={17} /></button></footer>
    </form>
  </dialog>;
}
