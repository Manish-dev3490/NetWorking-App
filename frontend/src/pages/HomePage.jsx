import { useEffect, useRef, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import Dialog from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import PostFeed from '../features/posts/PostFeed.jsx';
import '../features/posts/posts.css';

const navigation = [
  { name: 'Home', icon: 'home' }, { name: 'Your posts', icon: 'note' },
  { name: 'Find members', icon: 'search' }, { name: 'Follow requests', icon: 'user-check' },
  { name: 'Saved', icon: 'bookmark' }, { name: 'Profile', icon: 'user' },
];
const upcoming = {
  Notifications: ['A quiet place to catch up', 'Notifications will arrive as follows, likes and comments become available.'],
  Privacy: ['Your space, thoughtfully protected', 'Public accounts can be viewed by signed-in members. Private accounts share posts and connections with approved followers. Manage account privacy in Edit profile.'],
  Terms: ['The little details matter', 'Gather’s terms will be available before launch.'],
  Safety: ['A community built on care', 'Reporting, blocking and community safety tools are coming in a later step.'],
  Help: ['A helping hand', 'Create a post to share up to ten photos. You can edit the caption or delete your own posts from their options menu.'],
};

function Brand({ onClick }) {
  return <button type="button" className="brand" onClick={onClick} aria-label="Gather home"><span className="brand-mark"><Icon name="leaf" size={23} /></span><span className="brand-copy"><strong>Gather</strong><span>Everyday moments</span></span></button>;
}

export default function HomePage({ user, onEditProfile, onLogout, loggingOut = false, onCreate, onOpenPost, onOpenProfile, onOpenSaved, onFindMembers, onRequests, postRevision, onPostChanged }) {
  const [tab, setTab] = useState('following');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const searchRef = useRef(null);
  const searchToggleRef = useRef(null);
  const tabRefs = useRef({});
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  function home() { setTab('following'); setQuery(''); setSearchOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function showUpcoming(name) { const [title, description] = upcoming[name]; setDialog({ title, description }); }
  function navigate(name) {
    if (name === 'Home') home();
    else if (name === 'Your posts') { setTab('own'); setQuery(''); setSearchOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
    else if (name === 'Find members') onFindMembers();
    else if (name === 'Follow requests') onRequests();
    else if (name === 'Saved') onOpenSaved();
    else if (name === 'Profile') onOpenProfile(user.id);
    else showUpcoming(name);
  }
  function closeSearch() { setSearchOpen(false); setQuery(''); searchToggleRef.current?.focus(); }
  function tabKey(event) {
    let next;
    const tabs = ['following', 'recent', 'own'];
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    if (event.key === 'Home') next = 'following';
    if (event.key === 'End') next = 'own';
    if (next) { event.preventDefault(); setTab(next); tabRefs.current[next]?.focus(); }
  }

  return <div className="gather-app">
    <a className="skip-link" href="#main-feed">Skip to feed</a>
    <aside className="side-nav"><div><Brand onClick={home} /><nav className="main-navigation" aria-label="Main navigation">{navigation.map((item) => <button key={item.name} type="button" className={`nav-link ${(item.name === 'Home' && tab === 'following') || (item.name === 'Your posts' && tab === 'own') ? 'is-active' : ''}`} title={item.name} aria-label={item.name} onClick={() => navigate(item.name)}><Icon name={item.icon} size={21} /><span className="nav-label">{item.name}</span></button>)}</nav><button type="button" className="button button-primary create-button" aria-label="Create post" onClick={onCreate}><Icon name="plus" size={19} /><span>Create post</span></button></div>
      <div className="sidebar-bottom"><button type="button" className="account-button" onClick={() => onOpenProfile(user.id)} title="Your profile"><Avatar src={user.avatarUrl} name={user.displayName} size={38} /><span className="account-copy"><strong>{user.displayName}</strong><span>@{user.username}</span></span><Icon name="more" size={18} /></button><button type="button" className="nav-link settings-link" onClick={onEditProfile} title="Edit profile"><Icon name="settings" size={20} /><span className="nav-label">Edit profile</span></button><button type="button" className="nav-link" title="Log out" aria-label={loggingOut ? 'Logging out' : 'Log out'} disabled={loggingOut} onClick={onLogout}><Icon name="logout" size={20} /><span className="nav-label">{loggingOut ? 'Logging out…' : 'Log out'}</span></button></div>
    </aside>
    <header className="mobile-header"><Brand onClick={home} /><div className="mobile-header-actions"><button type="button" className="icon-button" aria-label="Find members" onClick={onFindMembers}><Icon name="search" /></button><button type="button" className="avatar-button" aria-label="Your profile" onClick={() => onOpenProfile(user.id)}><Avatar src={user.avatarUrl} name={user.displayName} size={30} /></button><button type="button" className="icon-button" title="Log out" aria-label={loggingOut ? 'Logging out' : 'Log out'} disabled={loggingOut} onClick={onLogout}><Icon name="logout" size={19} /></button></div></header>
    <div className="workspace"><div className="home-layout"><main id="main-feed" className="feed-column" tabIndex={-1}>
      <header className="feed-toolbar"><div className="feed-tabs" role="tablist" aria-label="Feed view">{[['following', 'Following'], ['recent', 'Recent'], ['own', 'Your posts']].map(([name, label]) => <button key={name} type="button" ref={(node) => { tabRefs.current[name] = node; }} role="tab" id={`tab-${name}`} className={`feed-tab ${tab === name ? 'is-selected' : ''}`} aria-selected={tab === name} aria-controls="feed-panel" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={tabKey}>{label}</button>)}</div><button type="button" className={`icon-button ${searchOpen ? 'is-active' : ''}`} ref={searchToggleRef} aria-label="Filter loaded posts" aria-expanded={searchOpen} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><Icon name="search" size={19} /></button></header>
      {searchOpen && <div className="feed-search-section"><div className="feed-search"><Icon name="search" size={18} /><label className="sr-only" htmlFor="loaded-post-query">Search loaded posts</label><input id="loaded-post-query" ref={searchRef} type="search" placeholder="Find a name, caption or hashtag…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }} /><button type="button" className="icon-button" aria-label="Close search" onClick={closeSearch}><Icon name="close" size={16} /></button></div><p className="field-hint loaded-search-hint">Searches the posts loaded in this view. Load more to include older posts.</p></div>}
      <button type="button" className="feed-composer-prompt" onClick={onCreate}><Avatar src={user.avatarUrl} name={user.displayName} size={38} /><span>What’s your everyday moment?</span><span className="prompt-plus"><Icon name="plus" size={21} /></span></button>
      <div className="real-feed-label"><span className="preview-dot" />{tab === 'own' ? 'Your published moments, all in one place.' : tab === 'following' ? 'Your moments and the members you follow, newest first.' : 'The latest public moments from the Gather community.'}</div>
      <div id="feed-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}><PostFeed user={user} scope={tab} revision={postRevision} onChanged={onPostChanged} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onCreate={onCreate} onFindMembers={onFindMembers} query={query} /></div>
    </main><aside className="context-rail" aria-label="Your profile and community"><section className="context-card profile-card" aria-label="Your profile"><button type="button" className="profile-summary" onClick={() => onOpenProfile(user.id)}><Avatar src={user.avatarUrl} name={user.displayName} size={43} /><span><strong>{user.displayName}</strong><span>@{user.username}</span></span></button><p className="member-bio">{user.bio || 'Make yourself at home. Add a few words about you.'}</p><button type="button" className="button button-secondary member-edit" onClick={() => onOpenProfile(user.id)}>Your profile & connections</button></section>
      <section className="context-card writing-card"><span className="writing-card-mark"><Icon name="leaf" size={27} /></span><h2>Room for the everyday.</h2><p>A work in progress. A favorite corner. Something that made you pause.</p><button type="button" className="button button-primary" onClick={onCreate}>Share a moment<Icon name="plus" size={16} /></button></section>
      <section className="context-card community-card"><h2>A little good company</h2><p>Find a familiar face or a new perspective. Follow members to gather their moments in your Following feed.</p><button type="button" className="text-button" onClick={onFindMembers}>Find members<Icon name="chevron-right" size={14} /></button></section>
      <footer className="rail-footer"><div>{['Privacy', 'Terms', 'Safety', 'Help'].map((name) => <button key={name} type="button" onClick={() => showUpcoming(name)}>{name}</button>)}</div><p>© 2026 Gather. Room for the everyday.</p></footer>
    </aside></div></div>
    <nav className="bottom-nav" aria-label="Mobile navigation"><button type="button" className={tab === 'following' ? 'is-active' : ''} onClick={home}><span><Icon name="home" size={21} /></span><span>Home</span></button><button type="button" onClick={onFindMembers}><span><Icon name="search" size={21} /></span><span>Members</span></button><button type="button" className="bottom-create" aria-label="Create post" onClick={onCreate}><span><Icon name="plus" size={21} /></span><span>Create</span></button><button type="button" onClick={onRequests}><span><Icon name="user-check" size={21} /></span><span>Requests</span></button><button type="button" onClick={onOpenSaved}><span><Icon name="bookmark" size={21} /></span><span>Saved</span></button><button type="button" onClick={() => onOpenProfile(user.id)}><span><Icon name="user" size={21} /></span><span>Profile</span></button></nav>
    {dialog && <Dialog title={dialog.title} description={dialog.description} onClose={() => setDialog(null)} />}
  </div>;
}
