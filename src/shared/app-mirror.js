import { createMirrorHost } from './mirror.js';

const SECTIONS = ['controller', 'trainer'];

// Singleton mirror host shared between controller and trainer modules.
// Each subsystem:
//   - publishes its slice of state via setSection(id, payload)
//   - registers command handlers via setCommandHandler(target, handler)
// The mirror host emits a merged snapshot { controller, trainer } on
// every setSection call once started. Commands come in with
// { target, action, args } and are dispatched to the registered handler.

let host = null;
let startListeners = new Set();
const latest = { controller: null, trainer: null };
const handlers = { controller: null, trainer: null };
let status = { state: 'idle', code: null, peers: 0 };
const statusListeners = new Set();

// The trainer calls setSection() from its render loop — once per animation
// frame while playing, plus a 10Hz idle tick. Publishing all of that put
// ~60 JSON snapshots per second on the socket, which is a lot of radio for a
// phone on battery. The client interpolates the playhead locally between
// updates (see interpolateTime in mirror-client/ui.js), so a coalescing
// throttle is invisible to it. Leading edge fires immediately so discrete
// events — a key press, play/pause — stay responsive; the trailing edge
// guarantees the final state is never left unsent.
const PUBLISH_INTERVAL_MS = 50;
let lastPublish = 0;
let pendingPublish = null;

function publishNow() {
  lastPublish = performance.now();
  host.publishState({ ...latest });
}

function emit() {
  if (!host) return;
  if (pendingPublish !== null) return;   // already scheduled; it'll pick up `latest`
  const since = performance.now() - lastPublish;
  if (since >= PUBLISH_INTERVAL_MS) {
    publishNow();
    return;
  }
  pendingPublish = setTimeout(() => {
    pendingPublish = null;
    if (host) publishNow();
  }, PUBLISH_INTERVAL_MS - since);
}

export function onMirrorStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function onMirrorStart(fn) {
  startListeners.add(fn);
  return () => startListeners.delete(fn);
}

export function isMirrorActive() { return !!host; }

export function startMirror() {
  if (host) return status;
  host = createMirrorHost({
    onStatus: (st) => {
      status = st;
      for (const fn of statusListeners) fn(status);
    },
    onCommand: (cmd) => {
      if (!cmd || typeof cmd !== 'object') return;
      const target = cmd.target || 'controller';
      const handler = handlers[target];
      handler?.(cmd);
    },
  });
  emit();
  for (const fn of startListeners) fn();
  return status;
}

export function stopMirror() {
  if (!host) return;
  if (pendingPublish !== null) { clearTimeout(pendingPublish); pendingPublish = null; }
  host.close();
  host = null;
  status = { state: 'idle', code: null, peers: 0 };
  for (const fn of statusListeners) fn(status);
}

export function setSection(id, payload) {
  if (!SECTIONS.includes(id)) return;
  latest[id] = payload;
  if (host) emit();
}

export function setCommandHandler(target, handler) {
  if (!SECTIONS.includes(target)) return;
  handlers[target] = handler;
}
