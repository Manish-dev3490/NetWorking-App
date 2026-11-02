import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import RealPostCard from './RealPostCard.jsx';

export default function PostDetail({ postId, user, onBack, onChanged, onOpenProfile, revision }) {
  const [post, setPost] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setPost(null); setPending(true); setError('');
    apiRequest(`posts/${postId}`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setPost(response.data);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.status === 404 ? 'This post is unavailable. It may have been removed, or you may not have access.' : describeError(failure));
    }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    headingRef.current?.focus();
    return () => controller.abort();
  }, [postId, user.id, attempt, revision]);
  function changed(result) {
    onChanged();
    if (result?.deletedId === postId) onBack(); else setAttempt((value) => value + 1);
  }
  return <main className="post-detail-page"><header className="post-detail-header"><button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={17} />Back to feed</button><h1 ref={headingRef} tabIndex={-1}>A Gather moment</h1></header>
    {pending && <p className="feed-loading" role="status">Gathering this moment…</p>}{error && <div className="empty-state" role="alert"><span className="empty-mark"><Icon name="leaf" size={28} /></span><h2>This moment isn’t here.</h2><p>{error}</p><button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}{post && <RealPostCard post={post} user={user} detail onChanged={changed} onOpenPost={() => {}} onOpenProfile={onOpenProfile} />}
  </main>;
}
