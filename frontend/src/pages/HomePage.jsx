import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import Dialog from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import PostCard from '../features/feed/PostCard.jsx';
import { circle, collections, currentUser, posts, suggestions } from '../features/feed/preview-data.js';

const navigation = [
  { name: 'Home', icon: 'home' }, { name: 'Explore', icon: 'explore' },
  { name: 'Search', icon: 'search' }, { name: 'Notifications', icon: 'bell' },
  { name: 'Saved', icon: 'bookmark' }, { name: 'Profile', icon: 'user' },
];
const upcoming = {
  Explore: ['A little discovery awaits', 'Explore will be a place to find fresh perspectives and people worth following. This page is coming next.'],
  Notifications: ['A quiet place to catch up', 'Your follows, comments and other updates will find a home here. Notifications are coming in a later step.'],
  'Create post': ['Make room for your next moment', 'Photo sharing and caption writing are coming next. For now, take a look around the homepage preview.'],
  Settings: ['Make yourself at home', 'Account, privacy and notification settings will be available here as we build the next parts of Gather.'],
  Privacy: ['Your space, thoughtfully protected', 'Gather’s privacy information will be available here before launch.'],
  Terms: ['The little details matter', 'Gather’s terms will be available here before launch.'],
  Safety: ['A community built on care', 'Reporting, blocking and community safety information will be available here as these features are built.'],
  Help: ['A helping hand', 'Gather’s help center is coming in a later step.'],
};

function Brand({ onClick }) {
  return <button type="button" className="brand" onClick={onClick} aria-label="Gather home">
    <span className="brand-mark"><Icon name="leaf" size={23} /></span>
    <span className="brand-copy"><strong>Gather</strong><span>Everyday moments</span></span>
  </button>;
}

export default function HomePage() {
  const [view, setView] = useState('Home');
  const [tab, setTab] = useState(() => posts.some((post) => window.location.hash === `#post-${post.id}`) ? 'recent' : 'following');
  const [postPreviewStates, setPostPreviewStates] = useState(() => Object.fromEntries(posts.map((post) => [post.id, {
    liked: Boolean(post.liked), photoIndex: 0, comments: post.comments ?? [], draft: '',
  }])));
  const [savedIds, setSavedIds] = useState(() => new Set(posts.filter((post) => post.saved).map((post) => post.id)));
  const [followed, setFollowed] = useState(() => new Set(posts.slice(0, 2).map((post) => post.author.handle)));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const searchToggleRef = useRef(null);
  const tabRefs = useRef({});
  const updatePostPreview = useCallback((id, updater) => {
    setPostPreviewStates((previous) => ({ ...previous, [id]: updater(previous[id]) }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    let frame;
    function revealSharedPost() {
      const post = posts.find((entry) => window.location.hash === `#post-${entry.id}`);
      if (!post) return;
      setView('Home'); setTab('recent'); setQuery(''); setSearchOpen(false);
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => document.getElementById(`post-${post.id}`)?.scrollIntoView({ block: 'start' }));
    }
    revealSharedPost();
    window.addEventListener('hashchange', revealSharedPost);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('hashchange', revealSharedPost); };
  }, []);

  function notify(message) { setToast({ message }); }
  function showUpcoming(name) {
    const [title, description] = upcoming[name] ?? [name, 'This part of Gather is coming next.'];
    setDialog({ title, description });
  }
  function showPerson(person) { setDialog({ title: person.name, description: person.handle ? `@${person.handle}` : undefined, person }); }
  function closeSearch() { setSearchOpen(false); setQuery(''); searchToggleRef.current?.focus(); }
  function goHome() { setView('Home'); setQuery(''); setSearchOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function navigate(name) {
    if (name === 'Home') goHome();
    else if (name === 'Saved') { setView('Saved'); setQuery(''); setSearchOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
    else if (name === 'Search') setSearchOpen(true);
    else if (name === 'Profile') showPerson(currentUser);
    else showUpcoming(name);
  }
  function toggleSaved(id) {
    const saving = !savedIds.has(id);
    setSavedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    notify(saving ? 'Added to your saved preview posts.' : 'Removed from your saved preview posts.');
  }
  function toggleFollow(person) {
    const following = !followed.has(person.handle);
    setFollowed((previous) => {
      const next = new Set(previous);
      if (next.has(person.handle)) next.delete(person.handle); else next.add(person.handle);
      return next;
    });
    notify(`${following ? 'Following' : 'Unfollowed'} ${person.name} in this preview.`);
  }
  function handleTabKey(event, activeTab) {
    const tabs = ['following', 'recent'];
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = tabs[1 - tabs.indexOf(activeTab)];
    else if (event.key === 'Home') next = tabs[0]; else if (event.key === 'End') next = tabs[1];
    if (next) { event.preventDefault(); setTab(next); tabRefs.current[next]?.focus(); }
  }
  const normalizedQuery = query.trim().toLowerCase().replace(/^#/, '');
  const visiblePosts = posts.filter((post) => {
    if (view === 'Saved' && !savedIds.has(post.id)) return false;
    if (view === 'Home' && tab === 'following' && !followed.has(post.author.handle)) return false;
    return !normalizedQuery || [post.caption, post.author.name, post.author.handle, ...post.tags]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return <div className="gather-app">
    <a className="skip-link" href="#main-feed">Skip to feed</a>
    <aside className="side-nav">
      <div>
        <Brand onClick={goHome} />
        <nav className="main-navigation" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.name} type="button"
            className={`nav-link ${view === item.name ? 'is-active' : ''}`} aria-current={view === item.name ? 'page' : undefined}
            title={item.name} onClick={() => navigate(item.name)}>
            <Icon name={item.icon} size={21} /><span className="nav-label">{item.name}</span>
            {item.name === 'Saved' && savedIds.size > 0 && <span className="nav-count">{savedIds.size}</span>}
          </button>)}
        </nav>
        <button type="button" className="button button-primary create-button" aria-label="Create post" onClick={() => showUpcoming('Create post')}>
          <Icon name="plus" size={19} /><span>Create post</span>
        </button>
      </div>
      <div className="sidebar-bottom">
        <button type="button" className="account-button" onClick={() => showPerson(currentUser)} title="Your profile">
          <Avatar src={currentUser.avatar} name={currentUser.name} size={38} />
          <span className="account-copy"><strong>{currentUser.name}</strong><span>@{currentUser.handle}</span></span><Icon name="more" size={18} />
        </button>
        <button type="button" className="nav-link settings-link" onClick={() => showUpcoming('Settings')} title="Settings">
          <Icon name="settings" size={20} /><span className="nav-label">Settings</span>
        </button>
      </div>
    </aside>

    <header className="mobile-header">
      <Brand onClick={goHome} />
      <div className="mobile-header-actions">
        <button type="button" className="icon-button" aria-label="Search feed" onClick={() => navigate('Search')}><Icon name="search" /></button>
        <button type="button" className="icon-button" aria-label="Saved posts" onClick={() => navigate('Saved')}><Icon name="bookmark" /></button>
        <button type="button" className="avatar-button" aria-label="Your profile" onClick={() => showPerson(currentUser)}><Avatar src={currentUser.avatar} name={currentUser.name} size={30} /></button>
      </div>
    </header>

    <div className="workspace"><div className="home-layout">
      <main id="main-feed" className="feed-column" tabIndex={-1}>
        <header className="feed-toolbar">
          {view === 'Saved' ? <div className="saved-heading">
            <button type="button" className="icon-button" aria-label="Back to home feed" onClick={goHome}><Icon name="arrow-left" /></button>
            <h1>Saved posts</h1><span className="small-count">{savedIds.size}</span>
          </div> : <div className="feed-tabs" role="tablist" aria-label="Feed view">
            {['following', 'recent'].map((name) => <button key={name} ref={(element) => { tabRefs.current[name] = element; }} type="button" role="tab"
              id={`tab-${name}`} aria-selected={tab === name} aria-controls="feed-panel" tabIndex={tab === name ? 0 : -1}
              className={`feed-tab ${tab === name ? 'is-selected' : ''}`} onClick={() => setTab(name)} onKeyDown={(event) => handleTabKey(event, name)}>
              {name === 'following' ? 'Following' : 'Recent'}
            </button>)}
          </div>}
          <button ref={searchToggleRef} type="button" className={`icon-button ${searchOpen ? 'is-active' : ''}`} aria-label="Search this feed" aria-expanded={searchOpen}
            aria-controls="feed-search" onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); setQuery(''); } }}><Icon name="tune" size={19} /></button>
        </header>
        {searchOpen && <div className="feed-search" id="feed-search">
          <Icon name="search" size={18} /><label className="sr-only" htmlFor="feed-query">Search sample posts</label>
          <input id="feed-query" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person, post or hashtag…" type="search"
            onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }} />
          <button type="button" className="icon-button" aria-label="Close search" onClick={closeSearch}><Icon name="close" size={16} /></button>
        </div>}
        <p className="preview-note"><span className="preview-dot" />Design preview <span aria-hidden="true">·</span> Sample content, interactions stay on this page</p>
        {view === 'Home' && !normalizedQuery && <section className="circle-section" aria-labelledby="circle-heading">
          <div className="section-heading"><h1 id="circle-heading">Your circle</h1><span>A little good company</span></div>
          <div className="circle-list">
            {[{ ...currentUser, id: 'you', shortName: 'You' }, ...circle].map((person) => <button key={person.id} type="button" className="circle-person"
              onClick={() => showPerson(person)} aria-label={`View ${person.name}'s profile preview`}>
              <span className="circle-avatar"><Avatar src={person.avatar} name={person.name} size={52} /></span><span>{person.shortName ?? person.name.split(' ')[0]}</span>
            </button>)}
          </div>
        </section>}
        <div id="feed-panel" className="post-list" role={view === 'Home' ? 'tabpanel' : undefined} aria-labelledby={view === 'Home' ? `tab-${tab}` : undefined}>
          {visiblePosts.length === 0 ? <section className="empty-state" aria-live="polite">
            <span className="empty-mark"><Icon name={view === 'Saved' ? 'bookmark' : 'search'} size={30} /></span>
            <h2>{normalizedQuery ? 'Nothing here just yet' : view === 'Saved' ? 'Keep a little inspiration' : 'Good company starts here'}</h2>
            <p>{normalizedQuery ? 'Try another name, word or hashtag in the sample feed.' : view === 'Saved' ? 'Tap the bookmark on a post to find it here. These saved posts stay in this preview.' : 'Find a few people to follow, or discover the latest posts in Recent.'}</p>
            <button type="button" className="button button-secondary" onClick={() => { if (normalizedQuery) setQuery(''); else { goHome(); setTab('recent'); } }}>{normalizedQuery ? 'Clear search' : 'Browse recent posts'}</button>
          </section> : visiblePosts.map((post, index) => <Fragment key={post.id}>
            <PostCard post={{ ...post, viewer: currentUser }} saved={savedIds.has(post.id)} onToggleSave={() => toggleSaved(post.id)} onNotify={notify}
              previewState={postPreviewStates[post.id]} onPreviewStateChange={updatePostPreview} />
            {index === 0 && welcomeVisible && view === 'Home' && !normalizedQuery && <div className="welcome-note">
              <span className="welcome-mark"><Icon name="leaf" size={21} /></span><p>A little inspiration, a familiar face.<br className="welcome-break" /> Make yourself at home.</p>
              <button type="button" className="icon-button" aria-label="Dismiss welcome note" onClick={() => setWelcomeVisible(false)}><Icon name="close" size={16} /></button>
            </div>}
          </Fragment>)}
        </div>
        {visiblePosts.length > 0 && <div className="feed-end"><Icon name="leaf" size={22} /><p>A good place to pause.</p><span>You’re all caught up with this preview.</span>
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}>Back to top <Icon name="arrow-up" size={13} /></button>
        </div>}
      </main>

      <aside className="context-rail" aria-label="Your profile and community">
        <section className="context-card profile-card" aria-label="Your profile preview">
          <button type="button" className="profile-summary" onClick={() => showPerson(currentUser)}><Avatar src={currentUser.avatar} name={currentUser.name} size={43} />
            <span><strong>{currentUser.name}</strong><span>@{currentUser.handle}</span></span>
          </button>
          <div className="profile-stats">{Object.entries(currentUser.stats).map(([name, count]) => <div key={name}><strong>{count}</strong><span>{name[0].toUpperCase() + name.slice(1)}</span></div>)}</div>
        </section>
        <section className="context-card collections-card" aria-labelledby="collections-heading">
          <div className="card-heading"><h2 id="collections-heading">Your collections</h2><button type="button" className="text-button" onClick={() => navigate('Saved')}>View all</button></div>
          <div className="collection-list">{collections.map((collection) => <button key={collection.id} type="button" className="collection-row" onClick={() => {
            navigate('Saved'); notify('Showing all saved preview posts. Collection management is coming next.');
          }}><span className="collection-icon"><Icon name={collection.icon} size={17} /></span><span>{collection.name}</span><span className="collection-count">{collection.count} items</span></button>)}</div>
        </section>
        <section className="context-card creators-card" aria-labelledby="creators-heading">
          <div className="card-heading"><h2 id="creators-heading">Thoughtful creators</h2><span>Suggested</span></div>
          <div className="creator-list">{suggestions.map((person) => <div key={person.id} className="creator-row">
            <button type="button" className="creator-identity" onClick={() => showPerson(person)}><Avatar src={person.avatar} name={person.name} size={35} />
              <span><strong>{person.name}</strong><span>@{person.handle}</span></span>
            </button>
            <button type="button" className={`follow-button ${followed.has(person.handle) ? 'is-following' : ''}`} aria-pressed={followed.has(person.handle)}
              aria-label={`${followed.has(person.handle) ? 'Unfollow' : 'Follow'} ${person.name} in preview`} onClick={() => toggleFollow(person)}>{followed.has(person.handle) ? 'Following' : 'Follow'}</button>
          </div>)}</div>
        </section>
        <footer className="rail-footer"><div>{['Privacy', 'Terms', 'Safety', 'Help'].map((name) => <button key={name} type="button" onClick={() => showUpcoming(name)}>{name}</button>)}</div><p>© 2026 Gather. Room for the everyday.</p></footer>
      </aside>
    </div></div>

    <nav className="bottom-nav" aria-label="Mobile navigation">
      {[navigation[0], navigation[1], { name: 'Create post', icon: 'plus', label: 'Create' }, navigation[3], navigation[5]].map((item) => <button key={item.name} type="button"
        className={`${view === item.name ? 'is-active' : ''} ${item.name === 'Create post' ? 'bottom-create' : ''}`} aria-current={view === item.name ? 'page' : undefined} onClick={() => navigate(item.name)}>
        <span><Icon name={item.icon} size={21} /></span><span>{item.label ?? item.name}</span>
      </button>)}
    </nav>
    {toast && <div className="toast" role="status"><Icon name="check" size={18} /><span>{toast.message}</span><button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
    {dialog && <Dialog title={dialog.title} description={dialog.description} onClose={() => setDialog(null)}>
      {dialog.person && <div className="dialog-profile"><Avatar src={dialog.person.avatar} name={dialog.person.name} size={72} /><p>{dialog.person.bio ?? 'A familiar face in this Gather design preview.'}</p></div>}
    </Dialog>}
  </div>;
}
