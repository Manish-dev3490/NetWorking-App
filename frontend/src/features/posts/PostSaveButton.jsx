import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import { notifyEngagement, pendingSaves } from './post-engagement.js';

export default function PostSaveButton({ post, user, onAccessLost }) {
  const key = `${user.id}:${post.id}`;
  const saved = Boolean(post.savedByMe);
  const [pending, setPending] = useState(pendingSaves.has(key));
  const [error, setError] = useState('');
  const activeKeyRef = useRef(null);

  useEffect(() => {
    activeKeyRef.current = key;
    const updatePending = () => setPending(pendingSaves.has(key));
    const stop = pendingSaves.observe(key, updatePending);
    updatePending();
    return () => { activeKeyRef.current = null; stop(); };
  }, [key]);

  async function toggleSaved() {
    if (pendingSaves.has(key)) return;
    pendingSaves.set(key, true);
    setError('');
    try {
      const { data } = await apiRequest(`posts/${post.id}/save`, { method: saved ? 'DELETE' : 'PUT', accountId: user.id });
      notifyEngagement(user.id, post.id, data);
    } catch (failure) {
      if (failure.status === 404) {
        notifyEngagement(user.id, post.id, { unavailable: true });
        if (activeKeyRef.current === key) onAccessLost();
      } else if (activeKeyRef.current === key) setError(describeError(failure));
    } finally {
      pendingSaves.set(key, false);
    }
  }

  return <div className="post-save">
    <button type="button" className="post-reaction post-save-button" aria-label="Save post" aria-pressed={saved}
      disabled={pending} onClick={toggleSaved}><Icon name="bookmark" size={19} />{saved ? 'Saved' : 'Save'}</button>
    {error && <p className="post-inline-error" role="alert">{error}</p>}
  </div>;
}
