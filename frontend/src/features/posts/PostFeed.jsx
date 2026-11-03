import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import RealPostCard from './RealPostCard.jsx';
import { observeEngagement } from './post-engagement.js';
import './posts.css';

export default function PostFeed({ user, scope = 'recent', memberId, revision = 0, onChanged, onOpenPost, onOpenProfile, onCreate, onFindMembers, onAccessLost, query = '' }) {
  const [posts, setPosts] = useState([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const requestRef = useRef(null);
  const busyRef = useRef(false);
  const failedRequestRef = useRef(null);
  const engagementDuringLoadRef = useRef(new Map());
  const savedPagesRef = useRef(0);
  const saved = scope === 'saved';

  async function load(cursor, replace = false) {
    if (busyRef.current && !replace) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const engagementDuringLoad = new Map();
    engagementDuringLoadRef.current = engagementDuringLoad;
    failedRequestRef.current = null;
    busyRef.current = true; setPending(true); setError('');
    // Saved pagination rechecks the visible prefix. A continuation alone cannot
    // tell us whether a post from an earlier page has lost access or was deleted.
    const reload = replace || saved;
    const pageLimit = saved && !replace ? savedPagesRef.current + 1 : 1;
    if (reload) { setPosts([]); setHasMore(false); setNextCursor(null); }
    try {
      const path = scope === 'profile' ? `users/${memberId}/posts` : scope === 'own' ? 'me/posts'
        : saved ? 'me/saved-posts' : scope === 'following' ? 'posts/following' : 'posts/recent';
      const options = saved ? { accountId: user.id, signal: controller.signal } : { signal: controller.signal };
      const rows = [];
      let continuation = reload ? null : cursor;
      let pages = 0;
      do {
        const params = new URLSearchParams({ limit: '10' });
        if (continuation) params.set('cursor', continuation);
        const response = await apiRequest(`${path}?${params}`, options);
        if (controller.signal.aborted) return;
        rows.push(...response.data);
        pages += 1;
        continuation = response.meta?.hasMore ? response.meta.nextCursor : null;
      } while (continuation && pages < pageLimit);
      const entries = rows.map((post) => ({ ...post, ...engagementDuringLoad.get(post.id) }))
        .filter((post) => !saved || (post.savedByMe && !post.unavailable));
      setPosts((previous) => {
        const combined = reload ? entries : [...previous, ...entries];
        return [...new Map(combined.map((post) => [post.id, post])).values()];
      });
      if (saved) savedPagesRef.current = pages;
      setNextCursor(continuation ?? null);
      setHasMore(Boolean(continuation));
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (scope === 'profile' && failure.status === 404 && onAccessLost) {
          setPosts([]); setHasMore(false); setNextCursor(null);
          onAccessLost(); return;
        }
        failedRequestRef.current = { cursor, replace };
        setError(describeError(failure));
      }
    } finally {
      if (!controller.signal.aborted) {
        engagementDuringLoad.clear();
        setPending(false); busyRef.current = false;
      }
    }
  }

  function retry() {
    const failed = failedRequestRef.current;
    if (failed) return load(failed.cursor, failed.replace);
  }

  useEffect(() => {
    void load(null, true);
    return () => requestRef.current?.abort();
  }, [scope, memberId, user.id, revision]);

  useEffect(() => observeEngagement(user.id, (postId, summary) => {
    if (summary.unavailable && !saved) return;
    if (saved && summary.savedByMe === true) {
      // The post may not have been in this page when the read started.
      void load(null, true);
      return;
    }
    if (busyRef.current) {
      const pending = engagementDuringLoadRef.current;
      pending.set(postId, { ...pending.get(postId), ...summary });
    }
    setPosts((current) => saved && (summary.savedByMe === false || summary.unavailable)
      ? current.filter((post) => post.id !== postId)
      : current.map((post) => post.id === postId ? { ...post, ...summary } : post));
  }), [user.id, scope]);

  const normalizedQuery = query.trim().toLowerCase().replace(/^#/, '');
  const visiblePosts = posts.filter((post) => !normalizedQuery || [post.caption, post.author.displayName, post.author.username, ...post.hashtags]
    .some((value) => value.toLowerCase().includes(normalizedQuery)));

  return <section className="real-post-feed" aria-label={scope === 'saved' ? 'Saved posts' : scope === 'own' ? 'Your published posts' : scope === 'following' ? 'Following posts' : scope === 'profile' ? 'Member posts' : 'Recent posts'} aria-busy={pending}>
    {visiblePosts.map((post) => <RealPostCard key={post.id} post={post} user={user} onChanged={onChanged} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} />)}
    {!pending && !error && visiblePosts.length === 0 && <div className="empty-state">
      <span className="empty-mark"><Icon name={normalizedQuery ? 'search' : scope === 'saved' ? 'bookmark' : 'leaf'} size={28} /></span>
      <h2>{normalizedQuery ? 'No matches in these posts.' : hasMore ? 'There’s more to explore.' : scope === 'saved' ? 'No saved posts to show.' : scope === 'following' ? 'Make room for good company.' : scope === 'profile' && memberId !== user.id ? 'No moments here yet.' : scope === 'own' ? 'Your first moment starts here.' : 'A little room for your first moment.'}</h2>
      <p>{normalizedQuery ? 'Try another word, or load more posts below.' : hasMore ? 'No available moments in this batch. Load more to keep exploring older posts.' : scope === 'saved' ? 'Use the bookmark button on a post to find it here later.' : scope === 'following' ? 'Follow members to see their latest posts alongside your own moments.' : scope === 'profile' && memberId !== user.id ? 'This member hasn’t shared a post yet.' : scope === 'own' ? 'Publish a photo and it will find a home here.' : 'There are no recent posts yet. Share a photo to get the good company started.'}</p>
      {!normalizedQuery && !hasMore && scope === 'following' && <button type="button" className="button button-primary" onClick={onFindMembers}><Icon name="search" size={17} />Find members</button>}
      {!normalizedQuery && !hasMore && scope !== 'following' && scope !== 'saved' && (scope !== 'profile' || memberId === user.id) && <button type="button" className="button button-primary" onClick={onCreate}><Icon name="plus" size={17} />Create a post</button>}
    </div>}
    {error && <div className="feed-feedback" role="alert"><Icon name="leaf" size={22} /><p>{error}</p><button type="button" className="button button-secondary" onClick={retry}>Try again</button></div>}
    {pending && <p className="feed-loading" role="status"><span className="loading-dot" />{scope === 'saved' ? 'Loading saved posts…' : posts.length ? 'Finding a few more moments…' : 'Gathering the latest moments…'}</p>}
    {!pending && !error && hasMore && <button type="button" className="button button-secondary load-posts" onClick={() => load(nextCursor)}>Load more posts<Icon name="chevron-down" size={16} /></button>}
    {!pending && !error && posts.length > 0 && !hasMore && <div className="feed-end"><Icon name="leaf" size={22} /><p>A good place to pause.</p><span>You’re all caught up.</span></div>}
  </section>;
}
