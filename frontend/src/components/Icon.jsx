const shapes = {
  leaf: <><path d="M19.5 4.5c-7-1-13.5 1-13.5 7.2a6.3 6.3 0 0 0 6.3 6.3c6.2 0 8.2-6.5 7.2-13.5Z" /><path d="m5 20 9-9" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h5v-7h4v7h5V9" /></>,
  explore: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  user: <><circle cx="12" cy="7" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2H5Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: <><path d="m9.5 3-.6 2.2-2 .9-2-.6-2.5 4.3L4 11.5v2l-1.6 1.7L5 19.5l2-.6 2 .9.6 2.2h5l.6-2.2 2-.9 2 .6 2.5-4.3L20 13.5v-2l1.6-1.7L19 5.5l-2 .6-2-.9L14.5 3h-5Z" /><circle cx="12" cy="12.5" r="3" /></>,
  heart: <path d="M20.5 5.5a5.1 5.1 0 0 0-7.3 0L12 6.8l-1.2-1.3a5.1 5.1 0 0 0-7.3 7.2L12 21l8.5-8.3a5.1 5.1 0 0 0 0-7.2Z" />,
  message: <path d="M21 4H3v14h5l4 4v-4h9V4Z" />,
  share: <><path d="M12 16V3m-4 4 4-4 4 4" /><path d="M7 10H4v11h16V10h-3" /></>,
  more: <><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="19" cy="12" r=".8" fill="currentColor" /></>,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'arrow-left': <path d="M20 12H4m6-6-6 6 6 6" />,
  'arrow-up': <path d="M12 20V4m-6 6 6-6 6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  tune: <><path d="M3 6h6m4 0h8M3 12h12m4 0h2M3 18h2m4 0h12" /><path d="M9 3v6m6 0v6M5 15v6" /></>,
  note: <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.2-3.6 1.8 1.8 0 0 1 1-3.3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" /><circle cx="7" cy="11" r=".6" /><circle cx="10" cy="7" r=".6" /><circle cx="15" cy="7" r=".6" /><circle cx="7.5" cy="15" r=".6" /></>,
  building: <path d="M5 21V5l10-2v18M3 21h18M15 10h4v11M8 8h1m2-1h1m-4 5h1m2-1h1m-4 5h1m2-1h1" />,
  send: <><path d="m22 2-7 20-4-9-9-4L22 2Z" /><path d="m22 2-11 11" /></>,
  logout: <><path d="M9 4H4v16h5M13 12h8m-4-4 4 4-4 4" /></>,
};

export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {shapes[name] ?? shapes.leaf}
    </svg>
  );
}
