import { useEffect, useRef, useState } from 'react';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { characterCount, describeError, serverFieldErrors, validateProfile } from './form-utils.js';
import './auth.css';
import PostFeed from '../posts/PostFeed.jsx';

export default function ProfilePage({ user, onSaved, onBack, onLogout, loggingOut, onCreate, onOpenPost, postRevision, onPostChanged }) {
  const [values, setValues] = useState({ displayName: user.displayName, username: user.username, bio: user.bio ?? '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  const requestRef = useRef(null);
  const bioLength = characterCount(values.bio.trim().normalize('NFC'));
  useEffect(() => {
    headingRef.current?.focus();
    return () => requestRef.current?.abort();
  }, []);

  function update(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
    setError(''); setSaved(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const fieldErrors = validateProfile(values);
    setErrors(fieldErrors); setError(''); setSaved(false);
    if (Object.keys(fieldErrors).length) { event.currentTarget.elements[Object.keys(fieldErrors)[0]]?.focus(); return; }
    setPending(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await apiRequest('me/profile', { method: 'PATCH', accountId: user.id, signal: controller.signal, body: {
        displayName: values.displayName.trim(), username: values.username.trim().toLowerCase(), bio: values.bio,
      } });
      if (controller.signal.aborted) return;
      onSaved(response.data);
      setValues({ displayName: response.data.displayName, username: response.data.username, bio: response.data.bio ?? '' });
      setSaved(true);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setErrors(serverFieldErrors(failure)); setError(describeError(failure));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally { if (!controller.signal.aborted) setPending(false); }
  }

  return <div className="profile-page">
    <header className="profile-page-header"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); onBack(); }}><span className="brand-mark"><Icon name="leaf" size={23} /></span><span className="brand-copy"><strong>Gather</strong><span>Everyday moments</span></span></a>
      <button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={16} />Back to feed</button>
    </header>
    <main className="profile-editor" aria-labelledby="profile-heading">
      <div className="profile-editor-intro"><span className="auth-eyebrow">A space that feels like you</span><h1 id="profile-heading" ref={headingRef} tabIndex={-1}>Your profile</h1><p>Let the good company get to know you.</p></div>
      <section className="profile-editor-card" aria-label="Edit your profile">
        <div className="profile-identity"><Avatar name={user.displayName} size={68} /><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>
        {error && <p className="form-error-summary" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        {saved && <p className="form-success" role="status"><Icon name="check" size={18} />Your profile has been updated.</p>}
        <form className="account-form" onSubmit={submit} noValidate aria-busy={pending}>
          <fieldset disabled={pending || loggingOut}><legend className="sr-only">Profile details</legend>
            <div className="form-field"><label htmlFor="profile-name">Your name</label><input id="profile-name" name="displayName" autoComplete="name" value={values.displayName} onChange={update} maxLength={120} required aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? 'profile-name-error' : undefined} />
              {errors.displayName && <p id="profile-name-error" className="field-error">{errors.displayName}</p>}</div>
            <div className="form-field"><label htmlFor="profile-username">Username</label><div className="input-with-prefix"><span aria-hidden="true">@</span><input id="profile-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={values.username} onChange={update} maxLength={30} required aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? 'profile-username-error' : 'profile-username-hint'} /></div>
              {errors.username ? <p id="profile-username-error" className="field-error">{errors.username}</p> : <p id="profile-username-hint" className="field-hint">3–30 letters, numbers or underscores.</p>}</div>
            <div className="form-field"><label htmlFor="profile-bio">A little about you <span className="field-optional">Optional</span></label><textarea id="profile-bio" name="bio" rows={4} maxLength={320} value={values.bio} onChange={update} placeholder="What are you making, exploring or enjoying?" aria-invalid={Boolean(errors.bio)} aria-describedby={errors.bio ? 'profile-bio-error' : 'profile-bio-count'} />
              {errors.bio && <p id="profile-bio-error" className="field-error">{errors.bio}</p>}<p id="profile-bio-count" className={`field-hint bio-count ${bioLength > 160 ? 'field-error' : ''}`}>{bioLength} / 160 characters</p></div>
            <div className="profile-email"><span>Email address</span><strong>{user.email}</strong><p>This is the email you use to log in.</p></div>
            <button type="submit" className="button button-primary account-submit" disabled={pending || loggingOut}>{pending ? 'Saving your profile…' : 'Save changes'}<Icon name="check" size={17} /></button>
          </fieldset>
        </form>
      </section>
      <div className="profile-signout"><div><strong>Done for now?</strong><p>You can come back to your everyday space anytime.</p></div><button className="button button-secondary" type="button" onClick={onLogout} disabled={loggingOut || pending}>{loggingOut ? 'Logging out…' : 'Log out'}<Icon name="logout" size={17} /></button></div>
      <section className="profile-posts-section" aria-labelledby="profile-posts-heading"><div className="profile-posts-heading"><div><span className="auth-eyebrow">Your everyday moments</span><h2 id="profile-posts-heading">Your posts</h2></div><button type="button" className="button button-primary" onClick={onCreate}><Icon name="plus" size={16} />Create post</button></div><PostFeed user={user} scope="own" revision={postRevision} onChanged={onPostChanged} onOpenPost={onOpenPost} onCreate={onCreate} /></section>
    </main>
  </div>;
}
