const engagementEvent = 'gather:post-engagement';

function pendingActions() {
  const inFlight = new Set();
  const events = new EventTarget();
  return {
    has(key) { return inFlight.has(key); },
    set(key, pending) {
      if (pending) inFlight.add(key);
      else inFlight.delete(key);
      events.dispatchEvent(new Event(key));
    },
    observe(key, listener) {
      events.addEventListener(key, listener);
      return () => events.removeEventListener(key, listener);
    },
  };
}

export const pendingLikes = pendingActions();
export const pendingSaves = pendingActions();

export function notifyEngagement(accountId, postId, summary) {
  window.dispatchEvent(new CustomEvent(engagementEvent, { detail: { accountId, postId, summary } }));
}

export function observeEngagement(accountId, onChange) {
  function changed({ detail }) {
    if (detail.accountId === accountId) onChange(detail.postId, detail.summary);
  }
  window.addEventListener(engagementEvent, changed);
  return () => window.removeEventListener(engagementEvent, changed);
}
