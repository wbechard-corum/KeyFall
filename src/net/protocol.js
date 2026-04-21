// KeyFall mirror wire protocol (v1).
//
// All messages are JSON objects with a top-level `type` field. The relay
// forwards `state`, `intent`, and `custom` messages verbatim between peers in
// the same room (adding a `from` tag with the sender role). Every other type
// is an endpoint concern (register/join/leave/ping) and never leaves the
// relay.

export const PROTOCOL_VERSION = 1;

// Client → relay
export const registerHost = () => ({ type: 'register-host' });
export const join = (code) => ({ type: 'join', code });
export const leave = () => ({ type: 'leave' });
export const ping = () => ({ type: 'ping', t: Date.now() });

// App messages (relayed peer-to-peer)
export const state = (module, payload) => ({ type: 'state', module, payload });
export const intent = (module, action, payload) => ({ type: 'intent', module, action, payload });

// Relay → client response types (for type narrowing in listeners):
//   { type: 'hello', version }
//   { type: 'registered', role: 'host', code, peers }
//   { type: 'joined',     role: 'client', code, peers }
//   { type: 'left' }
//   { type: 'peer-joined', role }
//   { type: 'peer-left',   role }
//   { type: 'pong', t }
//   { type: 'error', reason, ...details }
//
// Peer → peer message types (forwarded with `from` tag):
//   { type: 'state',  module, payload, from }
//   { type: 'intent', module, action, payload, from }
//   { type: 'custom', ...anything, from }
