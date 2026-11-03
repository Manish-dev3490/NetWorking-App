import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { characterCount, describeError } from '../auth/form-utils.js';
import { notifyEngagement } from './post-engagement.js';
import { formatPostDate } from './post-utils.js';

const commentLimit = 1000;

export default function PostComments({ post, user, refreshKey, onAccessLost, onOpenProfile }) {
  const [comments, setComments] = useState([]);
  const [verifiedPageKey, setVerifiedPageKey] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const listRequestRef = useRef(null);
  const mutationRef = useRef(null);
  const createKeyRef = useRef(null);
  const failedCursorRef = useRef(null);
  const inputRef = useRef(null);
  const path = `posts/${post.id}/comments`;
  const pageKey = `${user.id}:${post.id}:${refreshKey}`;
  const commentsVerified = verifiedPageKey === pageKey;
  const commentsEnabled = post.commentsEnabled !== false;
  const text = (editing?.draft ?? draft).trim().normalize('NFC');
  const length = characterCount(text);

  function updateCount(count) {
    if (Number.isInteger(count)) notifyEngagement(user.id, post.id, { commentCount: count });
  }

  async function load(cursor = null) {
    listRequestRef.current?.abort();
    const controller = new AbortController();
    listRequestRef.current = controller;
    // A first-page request rechecks visibility. Pagination can keep verified rows on screen.
    if (!cursor) setVerifiedPageKey(null);
    setLoading(true);
    setListError('');
    const query = new URLSearchParams({ limit: '15' });
    if (cursor) query.set('cursor', cursor);
    try {
      const { data, meta } = await apiRequest(`${path}?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setComments((current) => cursor ? [...new Map([...current, ...data].map((comment) => [comment.id, comment])).values()] : data);
      setNextCursor(meta?.hasMore ? meta.nextCursor : null);
      if (!cursor) setVerifiedPageKey(pageKey);
      updateCount(meta?.commentCount);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.status === 404) {
        setVerifiedPageKey(null);
        onAccessLost();
      } else {
        failedCursorRef.current = cursor;
        setListError(describeError(failure));
      }
    } finally {
      if (!controller.signal.aborted) {
        listRequestRef.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
    return () => listRequestRef.current?.abort();
  }, [path, user.id, refreshKey]);
  useEffect(() => () => mutationRef.current?.abort(), []);

  function startEdit(comment) {
    setEditing({ id: comment.id, draft: comment.text, version: comment.version, stale: false });
    setConfirmDelete(null);
    setError('');
    setNotice('');
    inputRef.current?.focus();
  }

  function changeDraft(value) {
    if (editing) setEditing({ ...editing, draft: value });
    else setDraft(value);
    if (!editing?.stale) setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!length || length > commentLimit || editing?.stale || (!editing && !commentsEnabled)) return;
    if (editing) {
      await mutate('PATCH', editing.id, { text, expectedVersion: editing.version });
    } else {
      if (createKeyRef.current?.text !== text) createKeyRef.current = { text, key: crypto.randomUUID() };
      await mutate('POST', null, { text }, { 'Idempotency-Key': createKeyRef.current.key });
    }
  }

  async function mutate(method, commentId, body, headers) {
    if (mutationRef.current || loading || !commentsVerified) return;
    const controller = new AbortController();
    mutationRef.current = controller;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const endpoint = commentId ? `${path}/${commentId}` : path;
      const { data, meta } = await apiRequest(endpoint, { method, body, headers, accountId: user.id, signal: controller.signal });
      if (controller.signal.aborted) return;
      // A focus refresh may have started before the write was committed.
      const needsRefresh = Boolean(listRequestRef.current);
      if (method === 'POST') {
        createKeyRef.current = null;
        setDraft('');
        setComments((current) => [data, ...current.filter((comment) => comment.id !== data.id)]);
        setNotice('Comment posted.');
      } else if (method === 'PATCH') {
        setEditing(null);
        setComments((current) => current.map((comment) => comment.id === data.id ? data : comment));
        setNotice('Comment updated.');
      } else {
        setConfirmDelete(null);
        if (editing?.id === commentId) setEditing(null);
        setComments((current) => current.filter((comment) => comment.id !== commentId));
        setNotice('Comment deleted.');
      }
      updateCount(meta?.commentCount ?? data?.commentCount);
      if (needsRefresh) void load();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.status === 404 && failure.code !== 'COMMENT_NOT_FOUND') onAccessLost();
      else if (method === 'PATCH' && ['VERSION_CONFLICT', 'COMMENT_NOT_FOUND'].includes(failure.code)) {
        setEditing((current) => ({ ...current, stale: true }));
        setError(failure.code === 'VERSION_CONFLICT'
          ? 'This comment changed in another tab. Cancel to edit the latest version.'
          : 'This comment is no longer available.');
        void load();
      } else {
        if (method === 'POST' && failure.code === 'RESOURCE_DELETED') createKeyRef.current = null;
        setError(describeError(failure));
      }
    } finally {
      if (!controller.signal.aborted) {
        mutationRef.current = null;
        setSaving(false);
      }
    }
  }

  const busy = loading || saving;
  const showForm = commentsVerified && (commentsEnabled || Boolean(editing));

  return <section className="post-comments" aria-labelledby="post-comments-heading">
    <h2 id="post-comments-heading" tabIndex={-1}>Comments</h2>
    {!commentsEnabled && <p className="comment-hint">New comments are closed for this post.</p>}
    {showForm && <form className="comment-form" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="post-comment-text">{editing ? 'Edit your comment' : 'Add a comment'}</label>
        <textarea ref={inputRef} id="post-comment-text" value={editing?.draft ?? draft} rows={3} maxLength={commentLimit * 2}
          aria-describedby="post-comment-length" onChange={(event) => changeDraft(event.target.value)} disabled={saving} />
        <p className="field-hint" id="post-comment-length">{length.toLocaleString()} / {commentLimit.toLocaleString()} characters</p>
      </div>
      <div className="comment-actions">
        {editing && <button type="button" className="button button-secondary" disabled={saving} onClick={() => { setEditing(null); setError(''); }}>Cancel edit</button>}
        <button type="submit" className="button button-primary" disabled={busy || !length || length > commentLimit || editing?.stale}>
          {saving ? 'Saving…' : editing ? 'Save comment' : 'Post comment'}
        </button>
      </div>
    </form>}
    {error && <p className="post-inline-error" role="alert">{error}</p>}
    {notice && <p className="post-inline-notice" role="status">{notice}</p>}
    {commentsVerified && !loading && !listError && comments.length === 0 && <p className="comment-hint">No comments yet.</p>}
    {commentsVerified && comments.length > 0 && <ul className="comment-list">
      {comments.map((comment) => <li key={comment.id} className="comment-item">
        <Avatar src={comment.author.avatarUrl} name={comment.author.displayName} size={32} />
        <div className="comment-content">
          <header><button type="button" className="post-author-name" onClick={() => onOpenProfile(comment.author.id)}>{comment.author.displayName}</button>
            <span>{comment.author.username && `@${comment.author.username} · `}<time dateTime={comment.createdAt}>{formatPostDate(comment.createdAt)}</time>{comment.updatedAt !== comment.createdAt && ' · Edited'}</span>
          </header>
          <p>{comment.text}</p>
          {comment.canManage && comment.author.id === user.id && <div className="comment-actions">
            <button type="button" className="text-button" disabled={saving} onClick={() => startEdit(comment)}>Edit</button>
            <button type="button" className="text-button" disabled={saving} onClick={() => { setConfirmDelete(comment.id); setError(''); setNotice(''); }}>Delete</button>
          </div>}
          {confirmDelete === comment.id && <div className="delete-post-confirm" role="group" aria-label="Confirm comment deletion">
            <strong>Delete this comment?</strong>
            <div>
              <button type="button" className="button button-secondary" disabled={saving} onClick={() => setConfirmDelete(null)}>Keep comment</button>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => mutate('DELETE', comment.id)}>Delete comment</button>
            </div>
          </div>}
        </div>
      </li>)}
    </ul>}
    {loading && <p className="comment-hint" role="status">Loading comments…</p>}
    {listError && <div className="comment-actions" role="alert"><p>{listError}</p>
      <button type="button" className="button button-secondary" disabled={saving} onClick={() => load(failedCursorRef.current)}>Try again</button>
    </div>}
    {commentsVerified && !loading && !listError && nextCursor && <button type="button" className="button button-secondary" disabled={saving} onClick={() => load(nextCursor)}>
      Load more comments<Icon name="chevron-down" size={16} />
    </button>}
  </section>;
}
