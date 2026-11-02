import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';

export default function MemberList({ path, user, revision = 0, onOpenProfile, onChanged, onAccessLost, removable = false, empty = 'No members here yet.' }) {
  const [members, setMembers] = useState([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [removing, setRemoving] = useState(null);
  const requestRef = useRef(null);
  const mutationRef = useRef(null);
  const busyRef = useRef(false);
  const failedRef = useRef(null);
  async function load(nextCursor, replace = false) {
    if (busyRef.current && !replace) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    busyRef.current = true; failedRef.current = null; setPending(true); setError('');
    if (replace) { setMembers([]); setHasMore(false); setCursor(null); }
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await apiRequest(`${path}${path.includes('?') ? '&' : '?'}${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMembers((previous) => [...new Map((replace ? response.data : [...previous, ...response.data]).map((member) => [member.id, member])).values()]);
      setCursor(response.meta?.nextCursor ?? null); setHasMore(Boolean(response.meta?.hasMore && response.meta?.nextCursor));
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure.status === 404 && onAccessLost) {
          setMembers([]); setHasMore(false); setCursor(null);
          onAccessLost(); return;
        }
        failedRef.current = { nextCursor, replace }; setError(describeError(failure));
      }
    }
    finally { if (!controller.signal.aborted) { busyRef.current = false; setPending(false); } }
  }
  useEffect(() => { mutationRef.current = null; setRemoving(null); void load(null, true); return () => { requestRef.current?.abort(); mutationRef.current?.abort(); }; }, [path, user.id, revision]);
  async function remove(id) {
    if (mutationRef.current) return;
    const controller = new AbortController(); mutationRef.current = controller; setRemoving(id); setError('');
    try {
      await apiRequest(`me/followers/${id}`, { method: 'DELETE', accountId: user.id, signal: controller.signal });
      if (!controller.signal.aborted) { setMembers((previous) => previous.filter((member) => member.id !== id)); onChanged(); }
    } catch (failure) { if (!controller.signal.aborted) setError(describeError(failure)); }
    finally { if (mutationRef.current === controller) mutationRef.current = null; if (!controller.signal.aborted) setRemoving(null); }
  }
  return <div className="member-list" aria-busy={pending}>
    {members.map((member) => <div className="member-row" key={member.id}><button type="button" className="member-identity" onClick={() => onOpenProfile(member.id)}><Avatar src={member.avatarUrl} name={member.displayName} size={44} /><span><strong>{member.displayName}</strong><span>@{member.username}{member.visibility === 'private' ? ' · Private' : ''}</span></span></button>{removable && member.id !== user.id ? <button type="button" className="button button-secondary compact-button" disabled={Boolean(removing)} onClick={() => remove(member.id)}>{removing === member.id ? 'Removing…' : 'Remove follower'}</button> : <button type="button" className="icon-button" aria-label={`View ${member.displayName}'s profile`} onClick={() => onOpenProfile(member.id)}><Icon name="chevron-right" size={18} /></button>}</div>)}
    {!pending && !error && members.length === 0 && <p className="network-empty">{hasMore ? 'No available members in this batch. Load more to keep exploring.' : empty}</p>}
    {error && <div className="network-error" role="alert"><p>{error}</p>{failedRef.current && <button type="button" className="text-button" onClick={() => load(failedRef.current.nextCursor, failedRef.current.replace)}>Try again</button>}</div>}
    {pending && <p className="feed-loading" role="status">Finding good company…</p>}
    {!pending && !error && hasMore && <button type="button" className="button button-secondary network-load-more" onClick={() => load(cursor)}>Load more members</button>}
  </div>;
}
