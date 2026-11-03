import { useEffect, useRef } from 'react';
import Icon from '../../components/Icon.jsx';
import PostFeed from './PostFeed.jsx';

export default function SavedPage({ user, revision, onBack, onChanged, onOpenPost, onOpenProfile }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return <main className="post-detail-page">
    <header className="post-detail-header">
      <button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={17} />Back to feed</button>
      <h1 ref={headingRef} tabIndex={-1}>Saved posts</h1>
      <p className="saved-posts-intro">Your private bookmarks, newest saved first.</p>
    </header>
    <PostFeed user={user} scope="saved" revision={revision} onChanged={onChanged} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} />
  </main>;
}
