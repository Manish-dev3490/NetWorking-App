import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import MemberList from './MemberList.jsx';
import NetworkPage from './NetworkPage.jsx';

export default function MemberSearch({ user, onBack, onFind, onRequests, onOpenProfile, revision }) {
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState('username');
  const [search, setSearch] = useState(null);
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const normalized = query.trim().replace(/^@/, '').normalize('NFC');
    if ([...normalized].length < 2 || [...normalized].length > 60) { setError('Enter between 2 and 60 characters to find members.'); return; }
    setError(''); setSearch({ query: normalized, match, attempt: (search?.attempt ?? 0) + 1 });
  }
  return <NetworkPage title="Find your good company." description="Search for a familiar name, discover a new perspective, and make a connection." onBack={onBack} onFind={onFind} onRequests={onRequests}>
    <form className="member-search-form" onSubmit={submit}><div className="form-field"><label htmlFor="member-query">Find members</label><div className="member-query-input"><Icon name="search" size={19} /><input id="member-query" type="search" value={query} maxLength={120} placeholder="Start with a name or username…" autoComplete="off" onChange={(event) => { setQuery(event.target.value); setError(''); }} autoFocus /></div></div><div className="form-field"><label htmlFor="member-match">Search by</label><select id="member-match" value={match} onChange={(event) => setMatch(event.target.value)}><option value="username">Username</option><option value="displayName">Name</option></select></div><button type="submit" className="button button-primary">Find members<Icon name="chevron-right" size={17} /></button></form>
    <p className="network-hint">Matches the beginning of a username or name. Private accounts appear with their basic identity.</p>
    {error && <p className="network-error" role="alert">{error}</p>}
    {search ? <section className="network-card" aria-label="Member search results"><h2>Members matching “{search.query}”</h2><MemberList key={search.attempt} path={`search/users?${new URLSearchParams({ q: search.query, match: search.match })}`} user={user} revision={revision} onOpenProfile={onOpenProfile} empty="No members found. Try another name or username." /></section> : <div className="network-welcome"><span className="empty-mark"><Icon name="search" size={28} /></span><h2>A new connection starts with a name.</h2><p>Enter at least two characters to start exploring Gather.</p></div>}
  </NetworkPage>;
}
