import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import NetworkPage from './NetworkPage.jsx';

export default function FollowRequests({ user, revision, onBack, backLabel, onFind, onRequests, onOpenProfile, onChanged }) {
  const [requests, setRequests] = useState([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [changing, setChanging] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef(null);
  const mutationRef = useRef(null);
  const busyRef = useRef(false);
  const failedRef = useRef(null);
  async function load(nextCursor, replace = false) {
    if (busyRef.current && !replace) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    busyRef.current = true; failedRef.current = null; setPending(true); setError('');
    if (replace) { setRequests([]); setHasMore(false); setCursor(null); }
    try {
      const params = new URLSearchParams({ limit: '10' }); if (nextCursor) params.set('cursor', nextCursor);
      const response = await apiRequest(`me/follow-requests?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRequests((previous) => [...new Map((replace ? response.data : [...previous, ...response.data]).map((entry) => [entry.id, entry])).values()]);
      setCursor(response.meta?.nextCursor ?? null); setHasMore(Boolean(response.meta?.hasMore && response.meta?.nextCursor));
    } catch (failure) { if (!controller.signal.aborted) { failedRef.current = { nextCursor, replace }; setError(describeError(failure)); } }
    finally { if (!controller.signal.aborted) { busyRef.current = false; setPending(false); } }
  }
  useEffect(() => { mutationRef.current = null; setChanging(null); void load(null, true); return () => { requestRef.current?.abort(); mutationRef.current?.abort(); }; }, [user.id, revision, attempt]);
  async function respond(entry, accept) {
    if (mutationRef.current) return;
    const controller = new AbortController(); mutationRef.current = controller; setChanging(entry.id); setError(''); setMessage('');
    try {
      await apiRequest(`me/follow-requests/${entry.follower.id}`, { method: accept ? 'PUT' : 'DELETE', accountId: user.id, signal: controller.signal });
      if (controller.signal.aborted) return;
      setRequests((previous) => previous.filter((request) => request.id !== entry.id));
      setMessage(accept ? `${entry.follower.displayName} can now see your posts.` : `${entry.follower.displayName} has no pending follow request.`);
      onChanged();
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (!accept && failure.code === 'REQUEST_ALREADY_APPROVED') {
          setRequests((previous) => previous.filter((request) => request.id !== entry.id));
          setMessage(`${entry.follower.displayName} was already approved and can see your private posts. Remove them from Followers to revoke access.`);
          onChanged();
        } else {
          setError(describeError(failure));
          if (failure.status === 404) setAttempt((value) => value + 1);
        }
      }
    }
    finally { if (mutationRef.current === controller) mutationRef.current = null; if (!controller.signal.aborted) setChanging(null); }
  }
  return <NetworkPage title="A little new company." eyebrow="Your follow requests" description="Choose who can see your private moments. You can remove a follower later from your profile." onBack={onBack} backLabel={backLabel} onFind={onFind} onRequests={onRequests}>
    {message && <p className="form-success" role="status"><Icon name="check" size={16} />{message}</p>}
    <section className="network-card request-inbox" aria-label="Incoming follow requests" aria-busy={pending}>
      <h2>Waiting for your approval</h2>
      {requests.map((entry) => <div className="request-row" key={entry.id}><button type="button" className="member-identity" onClick={() => onOpenProfile(entry.follower.id)}><Avatar src={entry.follower.avatarUrl} name={entry.follower.displayName} size={45} /><span><strong>{entry.follower.displayName}</strong><span>@{entry.follower.username}</span></span></button><div className="request-actions"><button type="button" className="button button-secondary compact-button" onClick={() => respond(entry, false)} disabled={Boolean(changing)}>Reject</button><button type="button" className="button button-primary compact-button" onClick={() => respond(entry, true)} disabled={Boolean(changing)}>{changing === entry.id ? 'Updating…' : 'Approve'}</button></div></div>)}
      {error && <div className="network-error" role="alert"><p>{error}</p>{failedRef.current && <button type="button" className="text-button" onClick={() => load(failedRef.current.nextCursor, failedRef.current.replace)}>Try again</button>}</div>}
      {pending && <p className="feed-loading" role="status">Checking your requests…</p>}
      {!pending && !error && requests.length === 0 && <div className="network-welcome"><span className="empty-mark"><Icon name="user-check" size={28} /></span><h2>{hasMore ? 'More requests to explore.' : 'You’re all caught up.'}</h2><p>{hasMore ? 'Load the next batch to see more available requests.' : 'New follow requests will appear here.'}</p></div>}
      {!pending && !error && hasMore && <button type="button" className="button button-secondary network-load-more" onClick={() => load(cursor)}>Load more requests</button>}
    </section>
  </NetworkPage>;
}
