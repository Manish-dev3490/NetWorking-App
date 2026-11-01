import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { apiRequest } from '../../services/api.js';
import { characterCount, describeError, serverFieldErrors, validateProfile } from './form-utils.js';
import './auth.css';

export default function AuthPage({ mode, onNavigate, onAuthenticated, notice }) {
  const signup = mode === 'signup';
  const [values, setValues] = useState({ displayName: '', username: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef(null);
  const headingRef = useRef(null);
  const requestRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
    return () => requestRef.current?.abort();
  }, []);

  function update(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const fieldErrors = signup ? validateProfile(values) : {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) || values.email.trim().length > 254) {
      fieldErrors.email = 'Enter a valid email address.';
    }
    const passwordLength = characterCount(values.password);
    if (!values.password || (signup && passwordLength < 15) || passwordLength > 128
      || new TextEncoder().encode(values.password).length > 512) {
      fieldErrors.password = signup ? 'Use 15–128 characters (up to 512 bytes).' : 'Enter your password.';
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      event.currentTarget.elements[Object.keys(fieldErrors)[0]]?.focus();
      return;
    }
    setPending(true);
    setError('');
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const body = { email: values.email.trim().toLowerCase(), password: values.password };
      if (signup) Object.assign(body, { displayName: values.displayName.trim(), username: values.username.trim().toLowerCase() });
      const response = await apiRequest(signup ? 'auth/register' : 'auth/login', { method: 'POST', body, signal: controller.signal });
      if (controller.signal.aborted) return;
      setValues((previous) => ({ ...previous, password: '' }));
      onAuthenticated(response.data);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setErrors(serverFieldErrors(failure));
      setError(describeError(failure));
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally { if (!controller.signal.aborted) setPending(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story" aria-label="Welcome to Gather">
      <a className="brand auth-brand" href="/login" onClick={(event) => { event.preventDefault(); if (!pending) onNavigate('/login'); }}>
        <span className="brand-mark"><Icon name="leaf" size={25} /></span>
        <span className="brand-copy"><strong>Gather</strong><span>Everyday moments</span></span>
      </a>
      <div className="auth-story-copy"><span className="auth-eyebrow">A little room for connection</span>
        <h2>Good company.<br />Everyday inspiration.</h2>
        <p>A space to share what you’re making, find a familiar face, and enjoy the little things.</p>
      </div>
      <div className="auth-garden" aria-hidden="true"><span className="garden-orbit orbit-one" /><span className="garden-orbit orbit-two" />
        <span className="garden-leaf leaf-one"><Icon name="leaf" size={78} /></span>
        <span className="garden-leaf leaf-two"><Icon name="leaf" size={48} /></span>
        <span className="garden-caption">Room for the everyday.</span>
      </div>
      <p className="auth-story-footer">A little inspiration, a familiar face.</p>
    </section>
    <section className="auth-form-section" aria-labelledby="auth-heading">
      <div className="auth-form-card">
        <div className="auth-form-mark"><Icon name={signup ? 'plus' : 'leaf'} size={25} /></div>
        <p className="auth-eyebrow">{signup ? 'Make yourself at home' : 'Your everyday space'}</p>
        <h1 id="auth-heading" ref={headingRef} tabIndex={-1}>{signup ? 'Join the good company.' : 'Welcome back.'}</h1>
        <p className="auth-intro">{signup ? 'Create your Gather account and make room for new connections.' : 'Log in to pick up where you left off.'}</p>
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {error && <p className="form-error-summary" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <form className="account-form" onSubmit={submit} noValidate aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend className="sr-only">{signup ? 'Create your account' : 'Log in to your account'}</legend>
            {signup && <>
              <div className="form-field"><label htmlFor="displayName">Your name</label>
                <input id="displayName" name="displayName" value={values.displayName} onChange={update} autoComplete="name" maxLength={120} required
                  aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? 'displayName-error' : undefined} placeholder="How should we call you?" />
                {errors.displayName && <p className="field-error" id="displayName-error">{errors.displayName}</p>}
              </div>
              <div className="form-field"><label htmlFor="username">Username</label>
                <div className="input-with-prefix"><span aria-hidden="true">@</span><input id="username" name="username" value={values.username} onChange={update} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} required
                  aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? 'username-error' : 'username-hint'} placeholder="yourname" /></div>
                {errors.username ? <p className="field-error" id="username-error">{errors.username}</p> : <p className="field-hint" id="username-hint">3–30 letters, numbers or underscores.</p>}
              </div>
            </>}
            <div className="form-field"><label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" value={values.email} onChange={update} autoComplete={signup ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} maxLength={254} required
                aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} placeholder="you@example.com" />
              {errors.email && <p className="field-error" id="email-error">{errors.email}</p>}
            </div>
            <div className="form-field"><label htmlFor="password">Password</label>
              <div className="password-input"><input id="password" name="password" type={showPassword ? 'text' : 'password'} value={values.password} onChange={update} autoComplete={signup ? 'new-password' : 'current-password'} maxLength={256} required
                aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error' : signup ? 'password-hint' : undefined} placeholder={signup ? 'Make it a memorable one' : 'Enter your password'} />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
              </div>
              {errors.password ? <p className="field-error" id="password-error">{errors.password}</p> : signup && <p className="field-hint" id="password-hint">At least 15 characters. A few memorable words work well.</p>}
            </div>
            <button type="submit" className="button button-primary account-submit" disabled={pending}>{pending ? (signup ? 'Creating your account…' : 'Logging in…') : (signup ? 'Create account' : 'Log in')}<Icon name="chevron-right" size={17} /></button>
          </fieldset>
        </form>
        <p className="auth-switch">{signup ? 'Already part of Gather?' : 'New around here?'} <a href={signup ? '/login' : '/signup'} onClick={(event) => { event.preventDefault(); if (!pending) onNavigate(signup ? '/login' : '/signup'); }}>{signup ? 'Log in' : 'Create an account'}</a></p>
        <p className="auth-footnote">{signup ? 'Your account is ready to use as soon as you sign up.' : 'A little inspiration is waiting for you.'}</p>
      </div>
    </section>
  </main>;
}
