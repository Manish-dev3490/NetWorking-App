import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { describeError } from '../auth/form-utils.js';
import PostFeed from '../posts/PostFeed.jsx';
import MemberList from './MemberList.jsx';
import NetworkPage from './NetworkPage.jsx';

export default function MemberProfile({ user, memberId, revision, onBack, backLabel, onFind, onRequests, onOpenProfile, onEdit, onOpenPost, onCreate, onChanged }) {
  const [profile, setProfile] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [changing, setChanging] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState('posts');
  const mutationRef = useRef(null);
  function accessLost() {
    setProfile(null); setPending(true); setSection('posts');
    setAttempt((value) => value + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    mutationRef.current = null; setChanging(false);
    setProfile(null); setPending(true); setError(''); setMutationError('');
    apiRequest(`users/${memberId}`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setProfile(response.data);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.status === 404 ? 'This member is unavailable.' : describeError(failure)); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => { controller.abort(); mutationRef.current?.abort(); };
  }, [memberId, user.id, revision, attempt]);
  async function changeFollow() {
    if (mutationRef.current || !profile) return;
    const controller = new AbortController(); mutationRef.current = controller;
    setChanging(true); setMutationError('');
    try {
      await apiRequest(`me/following/${memberId}`, { method: profile.relationship.followingStatus === 'none' ? 'PUT' : 'DELETE', accountId: user.id, signal: controller.signal });
      if (!controller.signal.aborted) { setProfile(null); onChanged(); setAttempt((value) => value + 1); }
    } catch (failure) { if (!controller.signal.aborted) setMutationError(describeError(failure)); }
    finally { if (mutationRef.current === controller) mutationRef.current = null; if (!controller.signal.aborted) setChanging(false); }
  }
  const status = profile?.relationship.followingStatus;
  return <NetworkPage title={profile ? profile.displayName : 'A Gather profile'} description={profile ? `@${profile.username}` : undefined} onBack={onBack} backLabel={backLabel} onFind={onFind} onRequests={onRequests}>
    {pending && <p className="feed-loading" role="status">Getting to know this member…</p>}
    {error && <div className="empty-state" role="alert"><h2>This profile isn’t available.</h2><p>{error}</p><button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {profile && <><section className="network-card member-profile-card" aria-label={`${profile.displayName}'s profile`}><div className="member-profile-top"><Avatar src={profile.avatarUrl} name={profile.displayName} size={88} /><div><span className="privacy-label"><Icon name={profile.visibility === 'private' ? 'lock' : 'globe'} size={14} />{profile.visibility === 'private' ? 'Private account' : 'Public account'}</span>{profile.relationship.followedBy && !profile.isSelf && <span className="follows-you">Follows you</span>}</div>{profile.isSelf ? <button type="button" className="button button-secondary" onClick={onEdit}>Edit profile</button> : <button type="button" className={`button ${status === 'none' ? 'button-primary' : 'button-secondary'}`} disabled={changing} onClick={changeFollow}>{changing ? 'Updating…' : status === 'accepted' ? 'Unfollow' : status === 'pending' ? 'Cancel request' : profile.visibility === 'private' ? 'Request to follow' : 'Follow'}</button>}</div>
      {mutationError && <p className="network-error" role="alert">{mutationError}</p>}
      {status === 'pending' && !profile.isSelf && <p className="member-relationship-note" role="status">Your follow request is pending approval.</p>}
      {profile.canViewContent && <>{profile.bio && <p className="member-profile-bio">{profile.bio}</p>}<div className="member-counts"><button type="button" onClick={() => setSection('posts')} aria-pressed={section === 'posts'}><strong>{profile.counts.posts}</strong><span>Posts</span></button><button type="button" onClick={() => setSection('followers')} aria-pressed={section === 'followers'}><strong>{profile.counts.followers}</strong><span>Followers</span></button><button type="button" onClick={() => setSection('following')} aria-pressed={section === 'following'}><strong>{profile.counts.following}</strong><span>Following</span></button></div></>}
    </section>
    {!profile.canViewContent ? <div className="private-profile-gate"><span className="empty-mark"><Icon name="lock" size={27} /></span><h2>A little privacy for their everyday.</h2><p>Follow this private account to request access to their posts and connections.</p></div> : section === 'posts' ? <section className="member-profile-posts" aria-label={`${profile.displayName}'s posts`}><h2>{profile.isSelf ? 'Your moments' : `${profile.displayName}’s moments`}</h2><PostFeed key={memberId} user={user} scope="profile" memberId={memberId} revision={revision} onChanged={onChanged} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onCreate={onCreate} onAccessLost={accessLost} /></section> : <section className="network-card" aria-label={section === 'followers' ? 'Followers' : 'Following'}><h2>{section === 'followers' ? 'Followers' : 'Following'}</h2><MemberList key={`${memberId}:${section}`} path={`users/${memberId}/${section}`} user={user} revision={revision} onOpenProfile={onOpenProfile} removable={profile.isSelf && section === 'followers'} onChanged={() => { onChanged(); setAttempt((value) => value + 1); }} onAccessLost={accessLost} empty={section === 'followers' ? 'No followers yet.' : 'No followed members yet.'} /></section>}</>}
  </NetworkPage>;
}
