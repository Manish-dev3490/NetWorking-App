import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import { notifyEngagement, pendingLikes } from './post-engagement.js';

export default function PostReactions({ post, user, detail, onOpenPost, onAccessLost }) {
  const key = `${user.id}:${post.id}`;
  const [pending, setPending] = useState(pendingLikes.has(key));
  const [error, setError] = useState('');
  const activeKeyRef = useRef(null);
  const liked = Boolean(post.likedByMe);
  const likeCount = post.likeCount ?? 0;
  const commentCount = post.commentCount ?? 0;
  const likeLabel = `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`;
  const commentLabel = `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`;
  useEffect(() => {
    activeKeyRef.current = key;
    const updatePending = () => setPending(pendingLikes.has(key));
    const stop = pendingLikes.observe(key, updatePending);
    updatePending();
    return () => {
      activeKeyRef.current = null;
      stop();
    };
  }, [key]);

  async function toggleLike() {
    if (pendingLikes.has(key)) return;
    pendingLikes.set(key, true);
    setError('');
    try {
      // A feed refresh or navigation can replace this card while the server
      // commits the write. Publish its result to the other views of the post.
      const { data } = await apiRequest(`posts/${post.id}/like`, {
        method: liked ? 'DELETE' : 'PUT', accountId: user.id,
      });
      notifyEngagement(user.id, post.id, data);
    } catch (failure) {
      if (activeKeyRef.current !== key) return;
      if (failure.status === 404) onAccessLost();
      else setError(describeError(failure));
    } finally {
      pendingLikes.set(key, false);
    }
  }

  return <div className="post-reactions">
    <div className="post-reaction-actions">
      <button type="button" className="post-reaction" aria-label={`Like post (${likeLabel})`} aria-pressed={liked} disabled={pending} onClick={toggleLike}>
        <Icon name="heart" size={19} /><span>{likeLabel}</span>
      </button>
      <button type="button" className="post-reaction" aria-label={`Open comments (${commentLabel})`}
        onClick={detail ? () => document.getElementById('post-comments-heading')?.focus() : () => onOpenPost(post.id)}>
        <Icon name="message" size={19} />{commentLabel}
      </button>
    </div>
    {error && <p className="post-inline-error" role="alert">{error}</p>}
  </div>;
}
