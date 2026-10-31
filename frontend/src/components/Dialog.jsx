import { useEffect, useId, useRef } from 'react';
import Icon from './Icon.jsx';

export default function Dialog({ title, description, children, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined} onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button type="button" className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
      <div className="dialog-mark"><Icon name="leaf" size={28} /></div>
      <h2 id={titleId}>{title}</h2>
      {description && <p id={descriptionId} className="dialog-description">{description}</p>}
      {children}
      <button type="button" className="button button-primary dialog-action" onClick={onClose}>Back to feed</button>
    </dialog>
  );
}
