import { useEffect, useRef, useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import AuthPage from './features/auth/AuthPage.jsx';
import ProfilePage from './features/auth/ProfilePage.jsx';
import Icon from './components/Icon.jsx';
import { apiRequest, clearCsrfToken } from './services/api.js';
import { describeError } from './features/auth/form-utils.js';
import PostComposer from './features/posts/PostComposer.jsx';
import PostDetail from './features/posts/PostDetail.jsx';
import MemberSearch from './features/network/MemberSearch.jsx';
import MemberProfile from './features/network/MemberProfile.jsx';
import FollowRequests from './features/network/FollowRequests.jsx';
import { EditPost } from './features/posts/RealPostCard.jsx';
import { PostEditorContext } from './features/posts/PostEditorContext.js';

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [accountError, setAccountError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [composerAccountId, setComposerAccountId] = useState(null);
  const [postRevision, setPostRevision] = useState(0);
  const [postEditor, setPostEditor] = useState(null);
  const returnToRef = useRef(['/profile', '/members', '/requests'].includes(window.location.pathname) || /^\/(?:p|u)\/[0-9a-f]{24}$/i.test(window.location.pathname) ? window.location.pathname : '/');
  const userRef = useRef(user);
  const accountEpochRef = useRef(0);
  const profileVersionRef = useRef(0);
  const refreshRef = useRef(null);
  const channelRef = useRef(null);
  const loadingRef = useRef(loading);
  const loggingOutRef = useRef(loggingOut);
  userRef.current = user;
  loadingRef.current = loading;
  loggingOutRef.current = loggingOut;

  function updateAccount(account) {
    userRef.current = account;
    setUser(account);
  }

  function invalidateRefresh() {
    accountEpochRef.current += 1;
    refreshRef.current?.abort();
  }

  async function reconcileAccount({ initial = false, announced = false } = {}) {
    invalidateRefresh();
    const epoch = accountEpochRef.current;
    const profileVersion = profileVersionRef.current;
    const controller = new AbortController();
    refreshRef.current = controller;
    if (initial) { setLoading(true); setRestoreError(''); }
    if (announced) clearCsrfToken();
    try {
      const response = await apiRequest('me', { signal: controller.signal });
      if (controller.signal.aborted || epoch !== accountEpochRef.current) return;
      setRestoreError('');
      const previousId = userRef.current?.id;
      const changed = previousId !== response.data.id;
      // A GET started before a successful save must not restore old fields.
      // Identity changes still apply so an in-flight tab switch is not hidden.
      if (!changed && profileVersion !== profileVersionRef.current) return;
      if (changed) {
        clearCsrfToken();
        if (!initial) {
          setAccountError('Your signed-in account changed in another tab. Review this account before saving any changes.');
        }
      }
      updateAccount(response.data);
      if (!['/profile', '/members', '/requests'].includes(window.location.pathname) && !/^\/(?:p|u)\/[0-9a-f]{24}$/i.test(window.location.pathname) && (initial || changed)) {
        window.history.replaceState({}, '', `/${window.location.hash}`); setPath('/');
      }
    } catch (failure) {
      if (controller.signal.aborted || epoch !== accountEpochRef.current) return;
      if (failure.status === 401) {
        setRestoreError('');
        updateAccount(null);
        const next = window.location.pathname === '/signup' ? '/signup' : '/login';
        window.history.replaceState({}, '', `${next}${window.location.hash}`); setPath(next);
      } else if (initial) setRestoreError(describeError(failure));
      else setAccountError(describeError(failure));
    } finally {
      if (epoch === accountEpochRef.current) setLoading(false);
    }
  }

  function navigate(next, { replace = false, keepHash = true } = {}) {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `${next}${keepHash ? window.location.hash : ''}`);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (next === '/') window.requestAnimationFrame(() => document.getElementById('main-feed')?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    const pageName = user ? (path === '/profile' ? 'Your profile' : path.startsWith('/u/') ? 'Member profile' : path === '/members' ? 'Find members' : path === '/requests' ? 'Follow requests' : path.startsWith('/p/') ? 'A Gather moment' : 'Everyday moments') : (path === '/signup' ? 'Create account' : 'Log in');
    document.title = `${pageName} — Gather`;
  }, [path, user]);

  useEffect(() => {
    function readPath() { setPath(window.location.pathname); }
    window.addEventListener('popstate', readPath);
    function sessionEnded(event) {
      if (event.detail?.accountId && event.detail.accountId !== userRef.current?.id) return;
      if (!userRef.current) return;
      invalidateRefresh();
      updateAccount(null); setLoading(false); setNotice('Your session has ended. Please log in again.'); setAccountError('');
      returnToRef.current = ['/profile', '/members', '/requests'].includes(window.location.pathname) || /^\/(?:p|u)\/[0-9a-f]{24}$/i.test(window.location.pathname) ? window.location.pathname : '/';
      window.history.replaceState({}, '', `/login${window.location.hash}`); setPath('/login');
    }
    function accountChanged() { void reconcileAccount({ initial: loadingRef.current, announced: true }); }
    function focused() {
      if (!loadingRef.current && !loggingOutRef.current && document.visibilityState === 'visible') {
        void reconcileAccount();
        setPostRevision((value) => value + 1);
      }
    }
    try {
      channelRef.current = typeof BroadcastChannel === 'function' ? new BroadcastChannel('gather:auth') : null;
      if (channelRef.current) channelRef.current.onmessage = (event) => {
        if (event.data?.type === 'account-changed') accountChanged();
      };
    } catch { channelRef.current = null; }
    window.addEventListener('gather:session-ended', sessionEnded);
    window.addEventListener('gather:account-changed', accountChanged);
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      window.removeEventListener('popstate', readPath);
      window.removeEventListener('gather:session-ended', sessionEnded);
      window.removeEventListener('gather:account-changed', accountChanged);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    void reconcileAccount({ initial: true });
    return invalidateRefresh;
  }, [restoreAttempt]);

  useEffect(() => { setComposerAccountId(null); setPostEditor(null); }, [user?.id]);

  function openPostEditor(post) {
    const accountId = userRef.current?.id;
    if (!accountId || post.author.id !== accountId || !post.canManage) return;
    // Retain the original post/version for this edit session. Background reads
    // can refresh cards without changing its draft or optimistic-lock version.
    setPostEditor({ accountId, post });
  }

  function authenticated(account) {
    invalidateRefresh();
    updateAccount(account); setLoading(false); setNotice(''); setAccountError('');
    channelRef.current?.postMessage({ type: 'account-changed' });
    navigate(returnToRef.current, { replace: true });
  }

  function profileSaved(account) {
    // A completed request from an old account must not replace the new identity.
    if (userRef.current?.id === account.id) {
      profileVersionRef.current += 1;
      updateAccount(account);
      setPostRevision((value) => value + 1);
    }
  }

  async function logout() {
    if (loggingOut) return;
    const accountId = userRef.current?.id;
    invalidateRefresh();
    const epoch = accountEpochRef.current;
    setLoggingOut(true); setAccountError('');
    try {
      await apiRequest('auth/logout', { method: 'POST', accountId });
      if (epoch !== accountEpochRef.current) { void reconcileAccount({ announced: true }); return; }
      clearCsrfToken(); updateAccount(null); setNotice('You’ve logged out. See you soon.'); returnToRef.current = '/';
      channelRef.current?.postMessage({ type: 'account-changed' });
      navigate('/login', { replace: true, keepHash: false });
    } catch (failure) { if (epoch === accountEpochRef.current) setAccountError(describeError(failure)); }
    finally { setLoggingOut(false); }
  }

  if (loading || restoreError) return <main className="session-screen" aria-busy={loading}>
    <span className={`session-mark ${loading ? 'is-loading' : ''}`}><Icon name="leaf" size={32} /></span>
    <h1>{loading ? 'Making yourself at home…' : 'Let’s try that again.'}</h1>
    <p role={restoreError ? 'alert' : 'status'}>{restoreError || 'Getting your Gather account ready.'}</p>
    {restoreError && <button className="button button-primary" type="button" onClick={() => setRestoreAttempt((attempt) => attempt + 1)}>Try again</button>}
  </main>;

  if (!user) return <AuthPage key={path === '/signup' ? 'signup' : 'login'} mode={path === '/signup' ? 'signup' : 'login'} onNavigate={navigate} onAuthenticated={authenticated} notice={notice} />;

  if (user.status !== 'active') return <main className="session-screen">
    <span className="session-mark"><Icon name="user" size={30} /></span><h1>Your account is restricted.</h1>
    <p>Your account currently has limited access. You can log out and return when access is restored.</p>
    {accountError && <p role="alert">{accountError}</p>}
    <button type="button" className="button button-primary" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
  </main>;

  const postMatch = /^\/p\/([0-9a-f]{24})$/i.exec(path);
  const memberMatch = /^\/u\/([0-9a-f]{24})$/i.exec(path);
  const openPost = (id) => navigate(`/p/${id}`, { keepHash: false });
  const openProfile = (id) => navigate(`/u/${id}`, { keepHash: false });
  const findMembers = () => navigate('/members', { keepHash: false });
  const followRequests = () => navigate('/requests', { keepHash: false });
  const createPost = () => setComposerAccountId(user.id);
  const postsChanged = () => setPostRevision((value) => value + 1);
  const networkProps = { user, revision: postRevision, onBack: () => navigate('/'), onFind: findMembers, onRequests: followRequests, onOpenProfile: openProfile, onChanged: postsChanged };

  return <PostEditorContext.Provider value={openPostEditor}>
    {accountError && <div className="account-feedback" role="alert"><span>{accountError}</span><button className="icon-button" type="button" aria-label="Dismiss account message" onClick={() => setAccountError('')}><Icon name="close" size={17} /></button></div>}
    <div hidden={['/profile', '/members', '/requests'].includes(path) || Boolean(postMatch) || Boolean(memberMatch)}><HomePage key={user.id} user={user} onEditProfile={() => navigate('/profile', { keepHash: false })} onLogout={logout} loggingOut={loggingOut} onCreate={createPost} onOpenPost={openPost} onOpenProfile={openProfile} onFindMembers={findMembers} onRequests={followRequests} postRevision={postRevision} onPostChanged={postsChanged} /></div>
    {path === '/profile' && <ProfilePage key={user.id} user={user} onSaved={profileSaved} onBack={() => navigate('/')} onLogout={logout} loggingOut={loggingOut} onCreate={createPost} onOpenPost={openPost} onOpenProfile={openProfile} onRequests={followRequests} postRevision={postRevision} onPostChanged={postsChanged} />}
    {path === '/members' && <MemberSearch key={user.id} {...networkProps} />}
    {path === '/requests' && <FollowRequests key={user.id} {...networkProps} />}
    {memberMatch && <MemberProfile key={`${user.id}:${memberMatch[1]}`} {...networkProps} memberId={memberMatch[1]} onEdit={() => navigate('/profile', { keepHash: false })} onOpenPost={openPost} onCreate={createPost} />}
    {postMatch && <PostDetail key={`${user.id}:${postMatch[1]}`} postId={postMatch[1]} user={user} onBack={() => navigate('/', { keepHash: false })} onChanged={postsChanged} onOpenProfile={openProfile} revision={postRevision} />}
    {composerAccountId === user.id && <PostComposer key={user.id} user={user} onClose={() => { setComposerAccountId(null); postsChanged(); }} onPublished={(post) => { setComposerAccountId(null); postsChanged(); openPost(post.id); }} />}
    {postEditor?.accountId === user.id && <EditPost key={`${postEditor.accountId}:${postEditor.post.id}`} post={postEditor.post} user={user} onClose={() => setPostEditor(null)} onChanged={postsChanged} />}
  </PostEditorContext.Provider>;
}
