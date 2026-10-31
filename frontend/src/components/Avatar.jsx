import { useState } from 'react';

export default function Avatar({ src, name = 'Gather member', size = 40 }) {
  const [failedSource, setFailedSource] = useState(null);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('');
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(11, size * 0.3) }}>
      {src && failedSource !== src ? (
        <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} />
      ) : <span role="img" aria-label={name}>{initials}</span>}
    </span>
  );
}
