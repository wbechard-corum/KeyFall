// Mirror session client.
//
// Single source of truth for the app's pair-mirror state. Either role:
//   - `host`  : the laptop driving the physical MIDI connection.
//   - `client`: a peer device (iPad, phone) that mirrors and remote-controls.
//
// Flow:
//   startHost()  → register-host  → receives `registered` with a pair code.
//   startClient(code) → join → receives `joined`.
// While connected, the session relays `state` snapshots (outgoing from host)
// and `intent` messages (outgoing from client) through the WebSocket.
//
// The session exposes a small event API; UI and module code subscribe rather
// than poking the socket directly.

import * as P from './protocol.js';

const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

function wsURL() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

export function createSession() {
  const listeners = {
    status: new Set(),
    state: new Set(),   // ({ module, payload, from })
    intent: new Set(),  // ({ module, action, payload, from })
    error: new Set(),
  };

  const state = {
    ws: null,
    role: null,           // null | 'host' | 'client'
    code: null,
    peers: 0,
    status: 'idle',      // idle | connecting | waiting-for-peer | connected | error | disconnected
    error: null,
    shouldReconnect: false,
    reconnectAttempt: 0,
    pendingJoinCode: null,
    pendingBecomeHost: false,
  };

  function emit(event, payload) {
    for (const fn of listeners[event] || []) {
      try { fn(payload); } catch (e) { console.error('session listener error:', e); }
    }
  }

  function setStatus(next, extra) {
    state.status = next;
    emit('status', {
      status: next,
      role: state.role,
      code: state.code,
      peers: state.peers,
      error: state.error,
      ...extra,
    });
  }

  function rawSend(obj) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
    try { state.ws.send(JSON.stringify(obj)); return true; }
    catch (e) { console.warn('WS send failed:', e); return false; }
  }

  function connect() {
    if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) return;

    setStatus('connecting');
    state.shouldReconnect = true;

    let ws;
    try { ws = new WebSocket(wsURL()); }
    catch (e) {
      state.error = e?.message || 'could not open WebSocket';
      setStatus('error');
      scheduleReconnect();
      return;
    }
    state.ws = ws;

    ws.addEventListener('open', () => {
      state.reconnectAttempt = 0;
      // Re-assume role on reconnection: a reconnected host must re-register
      // (new code will be issued, so surface this to the UI).
      if (state.pendingBecomeHost) {
        rawSend(P.registerHost());
      } else if (state.pendingJoinCode) {
        rawSend(P.join(state.pendingJoinCode));
      }
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch { return; }
      handleMessage(msg);
    });

    ws.addEventListener('close', () => {
      state.role = null;
      state.code = null;
      state.peers = 0;
      if (state.shouldReconnect) {
        setStatus('disconnected');
        scheduleReconnect();
      } else {
        setStatus('idle');
      }
    });

    ws.addEventListener('error', () => {
      state.error = 'websocket error';
      emit('error', { message: state.error });
    });
  }

  function scheduleReconnect() {
    if (!state.shouldReconnect) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(state.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    state.reconnectAttempt++;
    setTimeout(() => { if (state.shouldReconnect) connect(); }, delay);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        // Server handshake. Nothing to do until we register or join.
        return;

      case 'registered':
        state.role = 'host';
        state.code = msg.code;
        state.peers = msg.peers ?? 1;
        setStatus(state.peers > 1 ? 'connected' : 'waiting-for-peer');
        return;

      case 'joined':
        state.role = 'client';
        state.code = msg.code;
        state.peers = msg.peers ?? 2;
        setStatus('connected');
        return;

      case 'left':
        state.role = null;
        state.code = null;
        state.peers = 0;
        setStatus('idle');
        return;

      case 'peer-joined':
        state.peers++;
        setStatus('connected');
        return;

      case 'peer-left':
        state.peers = Math.max(1, state.peers - 1);
        setStatus(state.role === 'host' ? 'waiting-for-peer' : 'disconnected');
        return;

      case 'pong':
        return;

      case 'error':
        state.error = msg.reason || 'relay error';
        emit('error', { message: state.error, details: msg });
        setStatus('error');
        return;

      case 'state':
        emit('state', { module: msg.module, payload: msg.payload, from: msg.from });
        return;

      case 'intent':
        emit('intent', { module: msg.module, action: msg.action, payload: msg.payload, from: msg.from });
        return;
    }
  }

  return {
    on(event, fn) {
      (listeners[event] || (listeners[event] = new Set())).add(fn);
      return () => listeners[event].delete(fn);
    },

    startHost() {
      state.pendingBecomeHost = true;
      state.pendingJoinCode = null;
      connect();
    },

    joinAs(code) {
      state.pendingBecomeHost = false;
      state.pendingJoinCode = code;
      connect();
    },

    leave() {
      state.shouldReconnect = false;
      state.pendingBecomeHost = false;
      state.pendingJoinCode = null;
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        rawSend(P.leave());
        try { state.ws.close(1000, 'leave'); } catch { /* noop */ }
      }
      state.role = null;
      state.code = null;
      state.peers = 0;
      setStatus('idle');
    },

    sendState(module, payload) {
      if (state.role !== 'host') return false;
      return rawSend(P.state(module, payload));
    },

    sendIntent(module, action, payload) {
      if (state.role !== 'client') return false;
      return rawSend(P.intent(module, action, payload));
    },

    role: () => state.role,
    status: () => state.status,
    code: () => state.code,
    getSnapshot: () => ({
      status: state.status,
      role: state.role,
      code: state.code,
      peers: state.peers,
      error: state.error,
    }),
  };
}

// Shared singleton — the app has exactly one mirror session at a time.
export const session = createSession();
