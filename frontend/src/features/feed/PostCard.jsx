import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import Avatar from '../../components/Avatar.jsx';
import './post-card.css';

export default function PostCard({
  post,
  saved = false,
  onToggleSave,
  onNotify = () => {},
  previewState,
  onPreviewStateChange,
}) {
  const [localPreviewState, setLocalPreviewState] = useState(() => ({
    liked: Boolean(post.liked),
    photoIndex: 0,
    comments: post.comments ?? [],
    draft: '',
  }));
  const { liked, photoIndex, comments, draft } = previewState ?? localPreviewState;
  const [failedPhotos, setFailedPhotos] = useState([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef(null);
  const optionsButtonRef = useRef(null);
  const commentInputRef = useRef(null);
  const commentListId = useId();
  const commentInputId = useId();
  const optionsId = useId();

  const images = post.images ?? [];
  const currentPhoto = images[photoIndex];
  const addedComments = comments.length - (post.comments?.length ?? 0);
  const commentCount = (post.commentCount ?? post.comments?.length ?? 0) + addedComments;
  const likeCount = post.likes + Number(liked) - Number(Boolean(post.liked));
  const visibleComments = commentsExpanded ? comments : comments.slice(0, 2);
  const handle = post.author.handle.replace(/^@/, '');

  function updateField(key, valueOrUpdater) {
    const update = (current) => ({
      ...current,
      [key]: typeof valueOrUpdater === 'function'
        ? valueOrUpdater(current[key])
        : valueOrUpdater,
    });

    if (previewState !== undefined && onPreviewStateChange) {
      onPreviewStateChange(post.id, update);
    } else {
      setLocalPreviewState(update);
    }
  }

  useEffect(() => {
    if (!optionsOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!optionsRef.current?.contains(event.target)) setOptionsOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setOptionsOpen(false);
        optionsButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [optionsOpen]);

  async function copyLink() {
    setOptionsOpen(false);
    const link = new URL(window.location.href);
    link.hash = `post-${post.id}`;
    try {
      await navigator.clipboard.writeText(link.href);
      onNotify('Post link copied. This link opens the sample post on this page.');
    } catch {
      onNotify('The link could not be copied. Check your browser clipboard permissions.');
    }
  }

  function addComment(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || body.length > 2000) return;

    updateField('comments', (current) => [...current, {
      id: `sample-${Date.now()}-${current.length}`,
      author: 'You',
      body,
    }]);
    updateField('draft', '');
    setCommentsExpanded(true);
    onNotify('Sample comment added. It stays here until the page is refreshed.');
  }

  function openComments() {
    setCommentsExpanded(true);
    // Position the input after the expanded comments have been rendered.
    window.requestAnimationFrame(() => {
      const input = commentInputRef.current;
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    });
  }

  return (
    <article className="post-card" id={`post-${post.id}`} aria-label={`Post by ${post.author.name}`}>
      <header className="post-header">
        <div className="post-author">
          <Avatar src={post.author.avatar} name={post.author.name} size={40} />
          <div className="post-author-details">
            <div className="post-author-line">
              <h2 className="post-author-name">{post.author.name}</h2>
              <span className="post-meta-dot" aria-hidden="true">·</span>
              <time className="post-time">{post.time}</time>
            </div>
            <span className="post-handle">@{handle}</span>
          </div>
        </div>
        <div className="post-options" ref={optionsRef}>
          <button
            className="post-icon-button"
            type="button"
            aria-label={`More options for ${post.author.name}'s post`}
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            ref={optionsButtonRef}
            onClick={() => setOptionsOpen((current) => !current)}
          >
            <Icon name="more" size={20} />
          </button>
          {optionsOpen && (
            <div className="post-options-panel" id={optionsId} role="group" aria-label="Post options">
              <button type="button" onClick={copyLink}>
                <Icon name="share" size={16} /> Copy link
              </button>
              <button type="button" onClick={() => {
                setOptionsOpen(false);
                optionsButtonRef.current?.focus();
              }}>
                <Icon name="close" size={16} /> Close options
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="post-media" aria-label={images.length > 1 ? 'Photo carousel' : undefined}>
        {currentPhoto && !failedPhotos.includes(photoIndex) ? (
          <img
            key={currentPhoto.src}
            src={currentPhoto.src}
            alt={currentPhoto.alt}
            className="post-photo"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedPhotos((current) => [...current, photoIndex])}
          />
        ) : (
          <div className="post-photo-fallback" role="img" aria-label={currentPhoto ? `${currentPhoto.alt} (photo unavailable)` : 'Photo unavailable'}>
            <span>A quiet moment</span>
            <small>Photo unavailable</small>
          </div>
        )}
        {images.length > 1 && (
          <>
            <span className="post-photo-count" aria-live="polite" aria-atomic="true">
              {photoIndex + 1} / {images.length}
            </span>
            <button
              className="post-carousel-arrow post-carousel-previous"
              type="button"
              aria-label="Previous photo"
              disabled={photoIndex === 0}
              onClick={() => updateField('photoIndex', (current) => current - 1)}
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <button
              className="post-carousel-arrow post-carousel-next"
              type="button"
              aria-label="Next photo"
              disabled={photoIndex === images.length - 1}
              onClick={() => updateField('photoIndex', (current) => current + 1)}
            >
              <Icon name="chevron-right" size={18} />
            </button>
            <div className="post-carousel-dots" aria-label="Choose photo">
              {images.map((image, index) => (
                <button
                  key={`${image.src}-${index}`}
                  type="button"
                  className="post-carousel-dot"
                  aria-label={`Show photo ${index + 1} of ${images.length}`}
                  aria-current={index === photoIndex ? 'true' : undefined}
                  onClick={() => updateField('photoIndex', index)}
                >
                  <span />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="post-actions">
        <div className="post-primary-actions">
          <button
            className="post-action-button"
            type="button"
            aria-label={liked ? 'Unlike sample post' : 'Like sample post'}
            aria-pressed={liked}
            onClick={() => updateField('liked', (current) => !current)}
          >
            <Icon name="heart" size={22} fill={liked ? 'currentColor' : 'none'} />
            <span>{likeCount}</span>
          </button>
          <button className="post-action-button" type="button" aria-label={`Add a sample comment, ${commentCount} comments`} onClick={openComments}>
            <Icon name="message" size={21} />
            <span>{commentCount}</span>
          </button>
          <button className="post-icon-button" type="button" aria-label="Copy post link" onClick={copyLink}>
            <Icon name="share" size={21} />
          </button>
        </div>
        <button
          className="post-icon-button post-save-button"
          type="button"
          aria-label={saved ? 'Remove sample post from saved' : 'Save sample post'}
          aria-pressed={saved}
          onClick={onToggleSave}
        >
          <Icon name="bookmark" size={21} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="post-caption-area">
        <p className="post-caption">{post.caption}</p>
        {post.tags?.length > 0 && (
          <div className="post-tags" aria-label="Post hashtags">
            {post.tags.map((tag) => <span key={tag}>#{tag.replace(/^#/, '')}</span>)}
          </div>
        )}
      </div>

      <div className="post-comments">
        <button
          className="post-comments-toggle"
          type="button"
          aria-controls={commentListId}
          aria-expanded={commentsExpanded}
          onClick={() => setCommentsExpanded((current) => !current)}
        >
          {commentsExpanded ? 'Show fewer comments' : `View comments (${commentCount})`}
        </button>
        <div className="post-comment-list" id={commentListId}>
          {visibleComments.map((comment) => (
            <p className="post-comment" key={comment.id}>
              <span className="post-comment-author">
                {typeof comment.author === 'string' ? comment.author : (comment.author.handle || comment.author.name)}
              </span>
              {' '}{comment.body}
            </p>
          ))}
          {commentsExpanded && commentCount > comments.length && (
            <p className="post-comment-note">Showing the {comments.length} sample comments available in this preview.</p>
          )}
          {commentsExpanded && comments.length === 0 && (
            <p className="post-comment-note">Be the first to leave a sample comment.</p>
          )}
        </div>
      </div>

      <form className="post-comment-form" onSubmit={addComment}>
        <Avatar src={post.viewer?.avatar} name={post.viewer?.name || 'You'} size={28} />
        <div className="post-comment-input-wrap">
          <label className="post-visually-hidden" htmlFor={commentInputId}>
            Add a sample comment to {post.author.name}&apos;s post
          </label>
          <textarea
            id={commentInputId}
            ref={commentInputRef}
            rows={1}
            maxLength={2000}
            value={draft}
            placeholder="Add a quiet reflection…"
            onChange={(event) => updateField('draft', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={!draft.trim()}>Post</button>
        </div>
      </form>
    </article>
  );
}
