const WS_PATH = '/mirror/ws';

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

function createSocket({ onOpen, onMessage, onClose, onError }) {
  const state = { ws: null, closed: false, retries: 0 };

  function connect() {
    if (state.closed) return;
    const ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.addEventListener('open', () => {
      state.retries = 0;
      onOpen?.(ws);
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage?.(msg);
    });
    ws.addEventListener('close', () => {
      onClose?.();
      if (state.closed) return;
      const delay = Math.min(15000, 500 * Math.pow(2, state.retries++));
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', (e) => onError?.(e));
  }

  connect();

  return {
    send(obj) {
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },
    close() {
      state.closed = true;
      state.ws?.close();
    },
  };
}

export function createMirrorHost({ onCommand, onStatus } = {}) {
  let code = null;
  let peers = 0;

  const socket = createSocket({
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: 'host' }));
      onStatus?.({ state: 'connecting', code, peers });
    },
    onMessage: (msg) => {
      if (msg.type === 'hosted') {
        code = msg.code;
        onStatus?.({ state: 'ready', code, peers });
      } else if (msg.type === 'peer-joined') {
        peers += 1;
        onStatus?.({ state: 'ready', code, peers });
      } else if (msg.type === 'peer-left') {
        peers = Math.max(0, peers - 1);
        onStatus?.({ state: 'ready', code, peers });
      } else if (msg.type === 'cmd') {
        onCommand?.(msg.payload);
      }
    },
    onClose: () => {
      code = null;
      peers = 0;
      onStatus?.({ state: 'disconnected', code, peers });
    },
  });

  return {
    publishState(payload) {
      socket.send({ type: 'state', payload });
    },
    close() { socket.close(); },
  };
}

export function createMirrorClient(code, { onState, onStatus, onHostGone } = {}) {
  const socket = createSocket({
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: 'join', code }));
      onStatus?.({ state: 'connecting', code });
    },
    onMessage: (msg) => {
      if (msg.type === 'joined') {
        onStatus?.({ state: 'connected', code });
      } else if (msg.type === 'join-error') {
        onStatus?.({ state: 'error', code, reason: msg.reason });
      } else if (msg.type === 'state') {
        onState?.(msg.payload);
      } else if (msg.type === 'host-gone') {
        onHostGone?.();
        onStatus?.({ state: 'host-gone', code });
      }
    },
    onClose: () => onStatus?.({ state: 'disconnected', code }),
  });

  return {
    sendCommand(payload) {
      socket.send({ type: 'cmd', payload });
    },
    close() { socket.close(); },
  };
}
