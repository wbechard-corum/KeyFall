// Attach a controller instance to a mirror session so its state syncs with
// connected peers.
//
// Role logic:
//   - When the session becomes a `host`, the controller broadcasts every
//     snapshot it emits (profile, banks, effects, etc.).
//   - When the session becomes a `client`, the controller switches into
//     `client` mirror role, which suppresses its direct MIDI sends and
//     forwards every user action as an intent to the host. Incoming state
//     snapshots from the host are applied via applyRemoteSnapshot.
//   - On disconnect / idle, the controller reverts to solo mode.

function serializableSnapshot(snap) {
  // Strip non-serialisable bits (the full profile object, identity reply)
  // and keep only what a peer needs to mirror state faithfully.
  return {
    profile: snap.profile ? { id: snap.profile.id } : null,
    bankIndex: snap.bankIndex,
    patchIndex: snap.patchIndex,
    channel: snap.channel,
    effectValues: snap.effectValues,
    controlStates: snap.controlStates,
    lastMessage: snap.lastMessage,
  };
}

export function attachControllerMirror(controller, session) {
  let sendingRemoteSnapshot = false;

  const unsubChange = controller.onChange((snap) => {
    if (sendingRemoteSnapshot) return;
    if (session.role() === 'host') {
      session.sendState('controller', serializableSnapshot(snap));
    }
  });

  const unsubState = session.on('state', ({ module, payload }) => {
    if (module !== 'controller') return;
    // Apply remote snapshot guarded so our own onChange doesn't rebroadcast.
    sendingRemoteSnapshot = true;
    try { controller.applyRemoteSnapshot(payload); }
    finally { sendingRemoteSnapshot = false; }
  });

  const unsubIntent = session.on('intent', ({ module, action, payload }) => {
    if (module !== 'controller') return;
    if (session.role() !== 'host') return;
    controller.applyRemoteIntent(action, payload);
  });

  const unsubStatus = session.on('status', (s) => {
    if (s.status === 'idle' || s.status === 'disconnected' || s.status === 'error') {
      controller.setMirrorRole('solo', null);
      return;
    }

    if (s.role === 'host') {
      controller.setMirrorRole('host', null);
      // Push a fresh snapshot every time a peer joins so they start in sync.
      if (s.peers > 1) {
        session.sendState('controller', serializableSnapshot(controller.getSnapshot()));
      }
    } else if (s.role === 'client') {
      controller.setMirrorRole('client', (action, payload) => {
        session.sendIntent('controller', action, payload);
      });
    }
  });

  return () => {
    unsubChange();
    unsubState();
    unsubIntent();
    unsubStatus();
    controller.setMirrorRole('solo', null);
  };
}
