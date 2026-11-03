const engagementEvent = 'gather:post-engagement';
const likesInFlight = new Set();
const pendingLikeEvents = new EventTarget();

export const pendingLikes = {
  has(key) { return likesInFlight.has(key); },
  set(key, pending) {
    if (pending) likesInFlight.add(key);
    else likesInFlight.delete(key);
    pendingLikeEvents.dispatchEvent(new Event(key));
  },
  observe(key, listener) {
    pendingLikeEvents.addEventListener(key, listener);
    return () => pendingLikeEvents.removeEventListener(key, listener);
  },
};

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
