import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import { formatPostDate } from '../posts/post-utils.js';
import './notifications.css';

const descriptions = {
  follow: 'started following you.',
  follow_request: 'requested to follow you.',
  follow_approved: 'approved your follow request.',
  post_like: 'liked your post.',
  post_comment: 'commented on your post.',
};

export default function NotificationsPage({ user, revision, onBack, onRead, onUnreadCount, onOpenPost, onOpenProfile, onRequests }) {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [saving, setSaving] = useState(false);
  const headingRef = useRef(null);
  const requestRef = useRef(null);
  const mutationRef = useRef(false);
  const activeRef = useRef(false);
  const depthRef = useRef(1);
  const viewKey = `${user.id}:${revision}`;
  const current = page?.key === viewKey ? page : null;

  async function load(depth = depthRef.current) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    depthRef.current = depth;
    setPage(null);
    setLoading(true);
    setError('');
    try {
      const rows = [];
      let pages = 0;
      let nextCursor = null;
      let unreadCount = 0;
      // Recheck previously displayed activity as well as the new page.
      do {
        const params = new URLSearchParams({ limit: '15' });
        if (nextCursor) params.set('cursor', nextCursor);
        const { data, meta } = await apiRequest(`notifications?${params}`, { accountId: user.id, signal: controller.signal });
        if (controller.signal.aborted) return;
        rows.push(...data);
        pages += 1;
        nextCursor = meta?.hasMore ? meta.nextCursor : null;
        unreadCount = meta?.unreadCount ?? 0;
      } while (nextCursor && pages < depth);
      setPage({ key: viewKey, rows: [...new Map(rows.map((entry) => [entry.id, entry])).values()], nextCursor, unreadCount, pages });
      onUnreadCount(user.id, unreadCount);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(describeError(failure));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    activeRef.current = true;
    headingRef.current?.focus();
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    setReadError('');
    void load();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [viewKey]);

  function invalidate() {
    requestRef.current?.abort();
    onRead(user.id);
  }

  async function markRead(entry) {
    if (mutationRef.current || !current) return false;
    mutationRef.current = true;
    setSaving(true);
    setReadError('');
    try {
      const endpoint = entry ? `notifications/${entry.id}/read` : 'notifications/read-all';
      await apiRequest(endpoint, { method: 'PATCH', accountId: user.id });
      // The rows and count must come from one fresh read after the write settles.
      invalidate();
      return activeRef.current;
    } catch (failure) {
      if (failure.status === 404) {
        invalidate();
      } else if (activeRef.current) {
        if (failure.code === 'ACCOUNT_CHANGED' || failure.status === 401 || failure.status === 403) setPage(null);
        setReadError(describeError(failure));
      }
      return false;
    } finally {
      mutationRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  }

  async function open(entry) {
    if (!entry.readAt && !(await markRead(entry))) return;
    if (!activeRef.current) return;
    if (entry.type === 'follow_request') onRequests();
    else if (entry.postId) onOpenPost(entry.postId);
    else onOpenProfile(entry.actor.id);
  }

  return <main className="post-detail-page notifications-page">
    <header className="post-detail-header">
      <button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={17} />Back to feed</button>
      <h1 ref={headingRef} tabIndex={-1}>Notifications</h1>
      <p>Follow activity, likes and comments on your posts.</p>
    </header>
    <section aria-label="Notifications inbox" aria-busy={loading || saving}>
      <div className="notifications-toolbar">
        <p aria-live="polite">{current ? `${current.unreadCount} unread` : ''}</p>
        <button type="button" className="button button-secondary" disabled={!current?.unreadCount || loading || saving} onClick={() => markRead()}>Mark all as read</button>
      </div>
      {current?.rows.length > 0 && <ul className="notifications-list">
        {current.rows.map((entry) => <li key={entry.id} className={`notification-row${entry.readAt ? '' : ' is-unread'}`}>
          <button type="button" className="notification-open" disabled={saving} onClick={() => open(entry)}>
            <Avatar src={entry.actor.avatarUrl} name={entry.actor.displayName} size={40} />
            <span className="notification-copy"><span><strong>{entry.actor.displayName}</strong> {descriptions[entry.type]}</span>
              <time dateTime={entry.createdAt}>{formatPostDate(entry.createdAt)}</time></span>
            {!entry.readAt && <span className="notification-dot"><span className="sr-only">Unread</span></span>}
          </button>
          {!entry.readAt && <button type="button" className="text-button notification-mark" disabled={saving || loading} onClick={() => markRead(entry)}>Mark as read</button>}
        </li>)}
      </ul>}
      {readError && <p className="post-inline-error" role="alert">{readError}</p>}
      {error && <div className="feed-feedback" role="alert"><p>{error}</p><button type="button" className="button button-secondary" onClick={() => load()}>Try again</button></div>}
      {loading && <p className="feed-loading" role="status">Checking your notifications…</p>}
      {!loading && !error && current?.rows.length === 0 && <div className="empty-state"><span className="empty-mark"><Icon name="bell" size={28} /></span><h2>You’re all caught up.</h2><p>New activity will appear here.</p></div>}
      {!loading && !error && current?.nextCursor && <button type="button" className="button button-secondary load-posts" disabled={saving} onClick={() => load(current.pages + 1)}>Load more notifications</button>}
    </section>
  </main>;
}
