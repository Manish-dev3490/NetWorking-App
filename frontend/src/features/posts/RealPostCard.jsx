import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import { countCharacters, formatPostDate, normalizedTags, validatePostFields } from './post-utils.js';
import './posts.css';

function EditPost({ post, user, onClose, onChanged }) {
  const [caption, setCaption] = useState(post.caption);
  const [tags, setTags] = useState(post.hashtags.join(' '));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dialogRef = useRef(null);
  const requestRef = useRef(null);
  useEffect(() => { dialogRef.current.showModal(); return () => requestRef.current?.abort(); }, []);
  async function save(event) {
    event.preventDefault(); if (pending || conflict) return;
    const hashtags = normalizedTags(tags);
    const validation = validatePostFields(caption, hashtags);
    if (validation) { setError(validation); return; }
    const controller = new AbortController(); requestRef.current = controller;
    setPending(true); setError('');
    try {
      await apiRequest(`posts/${post.id}`, { method: 'PATCH', accountId: user.id, signal: controller.signal,
        body: { expectedVersion: post.version, caption: caption.trim().normalize('NFC'), hashtags } });
      if (!controller.signal.aborted) { onChanged(); onClose(); }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'VERSION_CONFLICT') { setConflict(true); setError('This post changed in another tab. Reload the latest version before editing again.'); }
      else setError(describeError(failure));
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <dialog className="post-dialog edit-post-dialog" ref={dialogRef} aria-labelledby={`edit-${post.id}`} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header className="post-dialog-heading"><h2 id={`edit-${post.id}`}>Edit your post</h2><button type="button" className="icon-button" aria-label="Close edit post" disabled={pending} onClick={onClose}><Icon name="close" /></button></header>
    {error && <p className="form-error-summary" role="alert">{error}</p>}
    <form onSubmit={save}><fieldset className="composer-fields" disabled={pending || conflict}><legend className="sr-only">Edit post details</legend>
      <div className="form-field"><label htmlFor={`caption-${post.id}`}>Caption</label><textarea id={`caption-${post.id}`} value={caption} rows={5} maxLength={4400} onChange={(event) => setCaption(event.target.value)} /><p className="field-hint">{countCharacters(caption.trim().normalize('NFC'))} / 2,200 characters</p></div>
      <div className="form-field"><label htmlFor={`tags-${post.id}`}>Hashtags</label><input id={`tags-${post.id}`} value={tags} maxLength={2000} onChange={(event) => setTags(event.target.value)} /></div>
    </fieldset><footer className="post-dialog-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>Cancel</button>{conflict ? <button type="button" className="button button-primary" onClick={() => { onChanged(); onClose(); }}>Reload latest post</button> : <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Saving…' : 'Save post'}</button>}</footer></form>
  </dialog>;
}

export default function RealPostCard({ post, user, onChanged, onOpenPost, detail = false }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const optionsRef = useRef(null);
  const optionsButtonRef = useRef(null);
  const deleteRequestRef = useRef(null);
  const photo = post.media[photoIndex] ?? post.media[0];
  const canManage = post.canManage && post.author.id === user.id;
  useEffect(() => { setFailed(false); }, [photo?.contentUrl]);
  useEffect(() => () => deleteRequestRef.current?.abort(), []);
  useEffect(() => {
    if (!optionsOpen) return;
    const close = (event) => { if (!optionsRef.current?.contains(event.target)) setOptionsOpen(false); };
    const key = (event) => { if (event.key === 'Escape') { setOptionsOpen(false); optionsButtonRef.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [optionsOpen]);

  async function share() {
    setOptionsOpen(false); optionsButtonRef.current?.focus(); setError('');
    try { await navigator.clipboard.writeText(new URL(`/p/${post.id}`, window.location.origin).href); setMessage('Post link copied.'); }
    catch { setError('The link could not be copied. Open the post and copy its address.'); }
  }
  async function remove() {
    if (deleteRequestRef.current && !deleteRequestRef.current.signal.aborted) return;
    const controller = new AbortController();
    deleteRequestRef.current = controller;
    setDeleting(true); setError('');
    try {
      await apiRequest(`posts/${post.id}`, { method: 'DELETE', accountId: user.id, signal: controller.signal });
      if (!controller.signal.aborted) onChanged({ deletedId: post.id });
    } catch (failure) {
      if (!controller.signal.aborted) { setError(describeError(failure)); setDeleting(false); }
    } finally {
      if (deleteRequestRef.current === controller) deleteRequestRef.current = null;
    }
  }
  return <article className="real-post-card" aria-label={`Post by ${post.author.displayName}`}>
    <header className="real-post-header"><div className="real-post-author"><Avatar name={post.author.displayName} size={40} /><div><h2>{post.author.displayName}</h2><span>@{post.author.username} · <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time></span></div></div>
      <div className="post-options" ref={optionsRef}><button type="button" className="icon-button" aria-label={`Options for ${post.author.displayName}'s post`} aria-expanded={optionsOpen} ref={optionsButtonRef} onClick={() => setOptionsOpen((open) => !open)}><Icon name="more" /></button>
        {optionsOpen && <div className="post-options-panel" role="group" aria-label="Post options">{!detail && <button type="button" onClick={() => onOpenPost(post.id)}><Icon name="explore" size={16} />Open post</button>}<button type="button" onClick={share}><Icon name="share" size={16} />Copy link</button>{canManage && <><button type="button" onClick={() => { setEditing(true); setOptionsOpen(false); }}><Icon name="settings" size={16} />Edit caption</button><button type="button" onClick={() => { setConfirmDelete(true); setOptionsOpen(false); }}><Icon name="close" size={16} />Delete post</button></>}</div>}
      </div>
    </header>
    <div className="real-post-image">{!failed && photo ? <img src={photo.contentUrl} alt={photo.altText || `Photo shared by ${post.author.displayName}`} loading="lazy" onError={() => setFailed(true)} /> : <div className="real-image-fallback"><Icon name="leaf" size={35} /><p>This photo is unavailable.</p><button type="button" className="text-button" onClick={() => setFailed(false)}>Try again</button></div>}
      {post.media.length > 1 && <><span className="real-image-count" aria-live="polite">{photoIndex + 1} / {post.media.length}</span><button type="button" className="real-carousel-arrow previous" aria-label="Previous photo" disabled={photoIndex === 0} onClick={() => setPhotoIndex((index) => index - 1)}><Icon name="chevron-left" /></button><button type="button" className="real-carousel-arrow next" aria-label="Next photo" disabled={photoIndex === post.media.length - 1} onClick={() => setPhotoIndex((index) => index + 1)}><Icon name="chevron-right" /></button><div className="real-carousel-dots">{post.media.map((entry, index) => <button type="button" key={entry.assetId} aria-label={`Show photo ${index + 1} of ${post.media.length}`} aria-current={index === photoIndex ? 'true' : undefined} onClick={() => setPhotoIndex(index)}><span /></button>)}</div></>}
    </div>
    <div className="real-post-body">{post.caption && <p className="real-post-caption">{post.caption}</p>}{post.hashtags.length > 0 && <div className="real-post-tags">{post.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}<div className="real-post-footer">{!detail && <button type="button" className="text-button" onClick={() => onOpenPost(post.id)}>Open post<Icon name="chevron-right" size={14} /></button>}<button type="button" className="icon-button" aria-label="Copy post link" onClick={share}><Icon name="share" size={19} /></button></div>
      {message && <p className="post-inline-notice" role="status">{message}</p>}{error && <p className="post-inline-error" role="alert">{error}</p>}
      {confirmDelete && <div className="delete-post-confirm" role="group" aria-label="Confirm post deletion"><strong>Delete this post?</strong><p>Your photos and caption will be removed.</p><div><button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep post</button><button type="button" className="button button-danger" onClick={remove} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete post'}</button></div></div>}
    </div>
    {editing && <EditPost post={post} user={user} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </article>;
}
