// Wake Lock keeps the device display on while the app is in use.
// Most relevant when the iPad is living on a music stand; desktop
// browsers don't really doze but the API no-ops there harmlessly.

let sentinel = null;
let wanted = false;

async function acquire() {
  if (!('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      // Browsers auto-release on tab hide; if we still want it, the
      // visibilitychange handler below will re-acquire on return.
      sentinel = null;
    });
  } catch (err) {
    // User-denied, low power, or not actually supported on this surface.
    console.debug('Wake Lock request failed:', err?.message || err);
  }
}

function release() {
  wanted = false;
  if (sentinel) sentinel.release?.().catch(() => {});
  sentinel = null;
}

export function keepAwake() {
  wanted = true;
  acquire();
}

export function stopKeepingAwake() {
  release();
}

// Auto-reacquire when the tab comes back to the foreground.
document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') acquire();
});
