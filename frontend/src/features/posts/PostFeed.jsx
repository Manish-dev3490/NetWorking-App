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

  async function load(cursor, replace = false) {
    if (busyRef.current && !replace) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const engagementDuringLoad = new Map();
    engagementDuringLoadRef.current = engagementDuringLoad;
    failedRequestRef.current = null;
    busyRef.current = true; setPending(true); setError('');
    if (replace) { setPosts([]); setHasMore(false); setNextCursor(null); }
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (cursor) params.set('cursor', cursor);
      const path = scope === 'profile' ? `users/${memberId}/posts` : scope === 'own' ? 'me/posts' : scope === 'following' ? 'posts/following' : 'posts/recent';
      const response = await apiRequest(`${path}?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const entries = response.data.map((post) => ({ ...post, ...engagementDuringLoad.get(post.id) }));
      setPosts((previous) => {
        const combined = replace ? entries : [...previous, ...entries];
        return [...new Map(combined.map((post) => [post.id, post])).values()];
      });
      setNextCursor(response.meta?.nextCursor ?? null);
      setHasMore(Boolean(response.meta?.hasMore && response.meta?.nextCursor));
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
    if (busyRef.current) {
      const pending = engagementDuringLoadRef.current;
      pending.set(postId, { ...pending.get(postId), ...summary });
    }
    setPosts((current) => current.map((post) => post.id === postId ? { ...post, ...summary } : post));
  }), [user.id]);

  const normalizedQuery = query.trim().toLowerCase().replace(/^#/, '');
  const visiblePosts = posts.filter((post) => !normalizedQuery || [post.caption, post.author.displayName, post.author.username, ...post.hashtags]
    .some((value) => value.toLowerCase().includes(normalizedQuery)));

  return <section className="real-post-feed" aria-label={scope === 'own' ? 'Your published posts' : scope === 'following' ? 'Following posts' : scope === 'profile' ? 'Member posts' : 'Recent posts'} aria-busy={pending}>
    {visiblePosts.map((post) => <RealPostCard key={post.id} post={post} user={user} onChanged={onChanged} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} />)}
    {!pending && !error && visiblePosts.length === 0 && <div className="empty-state">
      <span className="empty-mark"><Icon name={normalizedQuery ? 'search' : 'leaf'} size={28} /></span>
      <h2>{normalizedQuery ? 'No matches in these posts.' : hasMore ? 'There’s more to explore.' : scope === 'following' ? 'Make room for good company.' : scope === 'profile' && memberId !== user.id ? 'No moments here yet.' : scope === 'own' ? 'Your first moment starts here.' : 'A little room for your first moment.'}</h2>
      <p>{normalizedQuery ? 'Try another word, or load more posts below.' : hasMore ? 'No available moments in this batch. Load more to keep exploring older posts.' : scope === 'following' ? 'Follow members to see their latest posts alongside your own moments.' : scope === 'profile' && memberId !== user.id ? 'This member hasn’t shared a post yet.' : scope === 'own' ? 'Publish a photo and it will find a home here.' : 'There are no recent posts yet. Share a photo to get the good company started.'}</p>
      {!normalizedQuery && !hasMore && scope === 'following' && <button type="button" className="button button-primary" onClick={onFindMembers}><Icon name="search" size={17} />Find members</button>}
      {!normalizedQuery && !hasMore && scope !== 'following' && (scope !== 'profile' || memberId === user.id) && <button type="button" className="button button-primary" onClick={onCreate}><Icon name="plus" size={17} />Create a post</button>}
    </div>}
    {error && <div className="feed-feedback" role="alert"><Icon name="leaf" size={22} /><p>{error}</p><button type="button" className="button button-secondary" onClick={retry}>Try again</button></div>}
    {pending && <p className="feed-loading" role="status"><span className="loading-dot" />{posts.length ? 'Finding a few more moments…' : 'Gathering the latest moments…'}</p>}
    {!pending && !error && hasMore && <button type="button" className="button button-secondary load-posts" onClick={() => load(nextCursor)}>Load more posts<Icon name="chevron-down" size={16} /></button>}
    {!pending && !error && posts.length > 0 && !hasMore && <div className="feed-end"><Icon name="leaf" size={22} /><p>A good place to pause.</p><span>You’re all caught up.</span></div>}
  </section>;
}
