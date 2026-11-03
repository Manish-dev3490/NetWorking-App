import { useEffect, useRef } from 'react';
import Icon from '../../components/Icon.jsx';
import './network.css';

export default function NetworkPage({ title, eyebrow = 'A little good company', description, onBack, backLabel = 'Feed', onFind, onRequests, children }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return <main className="network-page">
    <header className="network-page-header"><button type="button" className="brand" onClick={onBack} aria-label={backLabel === 'Feed' ? 'Gather home' : `Back to ${backLabel.toLowerCase()}`}><span className="brand-mark"><Icon name="leaf" size={22} /></span><span className="brand-copy"><strong>Gather</strong><span>Everyday moments</span></span></button>
      <nav aria-label="Community navigation"><button type="button" className="text-button" onClick={onFind}>Find members</button><button type="button" className="text-button" onClick={onRequests}>Follow requests</button><button type="button" className="button button-secondary" onClick={onBack}><Icon name="arrow-left" size={16} />{backLabel}</button></nav></header>
    <div className="network-content"><div className="network-intro"><p className="auth-eyebrow">{eyebrow}</p><h1 ref={headingRef} tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>{children}</div>
  </main>;
}
