import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import RealPostCard from './RealPostCard.jsx';
import PostComments from './PostComments.jsx';
import { observeEngagement } from './post-engagement.js';

export default function PostDetail({ postId, user, onBack, backToSaved = false, onChanged, onOpenProfile, revision }) {
  const [post, setPost] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const headingRef = useRef(null);
  const engagementDuringLoadRef = useRef(null);

  useEffect(() => observeEngagement(user.id, (id, summary) => {
    if (id !== postId || summary.unavailable) return;
    if (engagementDuringLoadRef.current) Object.assign(engagementDuringLoadRef.current, summary);
    setPost((current) => current ? { ...current, ...summary } : null);
  }), [postId, user.id]);

  useEffect(() => {
    const controller = new AbortController();
    const engagementDuringLoad = {};
    engagementDuringLoadRef.current = engagementDuringLoad;
    setPending(true); setError('');
    apiRequest(`posts/${postId}`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) {
        setPost({ ...response.data, ...engagementDuringLoad });
        setRefreshKey((current) => current + 1);
      }
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      if (failure.status === 404) setPost(null);
      setError(failure.status === 404 ? 'This post is unavailable. It may have been removed, or you may not have access.' : describeError(failure));
    }).finally(() => {
      if (!controller.signal.aborted) {
        engagementDuringLoadRef.current = null;
        setPending(false);
      }
    });
    return () => controller.abort();
  }, [postId, user.id, attempt, revision]);

  useEffect(() => { headingRef.current?.focus(); }, [postId, user.id]);

  function changed(result) {
    onChanged();
    if (result?.deletedId === postId) onBack(); else setAttempt((value) => value + 1);
  }
  function accessLost() {
    setPost(null);
    changed();
  }
  return <main className="post-detail-page"><header className="post-detail-header"><button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={17} />{backToSaved ? 'Back to saved posts' : 'Back to feed'}</button><h1 ref={headingRef} tabIndex={-1}>A Gather moment</h1></header>
    {pending && <p className="feed-loading" role="status">Gathering this moment…</p>}{error && <div className="empty-state" role="alert"><span className="empty-mark"><Icon name="leaf" size={28} /></span><h2>This moment isn’t here.</h2><p>{error}</p><button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {post && <div hidden={pending || Boolean(error)}>
      <RealPostCard post={post} user={user} detail onChanged={changed} onAccessLost={accessLost} onOpenPost={() => {}} onOpenProfile={onOpenProfile} />
      <PostComments post={post} user={user} refreshKey={refreshKey} onAccessLost={accessLost} onOpenProfile={onOpenProfile} />
    </div>}
  </main>;
}
