export const PEER_PREFIX = 'partypad';

// 5-char unambiguous alphabet (excludes 0/O/1/I/L)
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;

// Wire packet tags (first byte of binary frames)
export const PKT = {
  INPUT: 0x01,   // High-frequency touch/button/joystick state (16 bytes)
  MOTION: 0x02,  // High-frequency IMU quaternion + omega + swing hit (26 bytes)
  CONTROL: 0x03, // UTF-8 JSON control payload (used over KCP or single-channel mode)
};

// Control message types
export const MSG = {
  HELLO: 'hello',                 // Phone -> Host: { clientId, name, transport, capabilities }
  WELCOME: 'welcome',             // Host -> Phone: { playerId, slot, roomCode, layout, pendingPrivate }
  LAYOUT: 'layout',               // Host -> Phone: { layout }
  PRIVATE_MSG: 'private_msg',     // Host -> Phone: { msgId, title, body, style, secret, ts }
  PRIVATE_ACK: 'private_ack',     // Phone -> Host: { msgId }
  PRIVATE_CLEAR: 'private_clear', // Host -> Phone: { msgId? }
  ACTION: 'action',               // Phone -> Host: { id, value } (quiz choice, text reply, button event)
  VIBRATE: 'vibrate',             // Host -> Phone: { pattern }
  CALIBRATE: 'calibrate',         // Bidirectional: reset IMU front reference
  PING: 'ping',                   // Bidirectional: { ts }
  PONG: 'pong',                   // Bidirectional: { ts }
  KICK: 'kick',                   // Host -> Phone: { reason }
};

export const TRANSPORT_MODE = {
  DUAL_DC: 'dual-dc', // Default: reliable ctrl DataChannel + unreliable input DataChannel
  KCP: 'kcp',         // Optional: KCP ARQ over raw unreliable (ordered:false, maxRetransmits:0) DataChannel
};

export const IMU_DEFAULTS = {
  HZ: 60,
  SWING_PEAK: 3.2,
  SWING_COOLDOWN_MS: 140,
};

export function genRoomCode() {
  let out = '';
  const buf = new Uint32Array(1);
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    crypto.getRandomValues(buf);
    out += ROOM_CODE_ALPHABET[buf[0] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LEN);
}

export function buildJoinUrl(roomCode, transport = TRANSPORT_MODE.DUAL_DC) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const tParam = transport === TRANSPORT_MODE.KCP ? '&transport=kcp' : '';
  return `${base}#/pad?room=${encodeURIComponent(roomCode)}${tParam}`;
}

export function getOrCreateClientId() {
  const key = 'partypad_client_id';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `p_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
}
