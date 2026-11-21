import {
  PEER_PREFIX,
  MSG,
  TRANSPORT_MODE,
  genRoomCode,
  normalizeRoomCode,
} from '../core/constants.js';
import { PeerTransport } from '../core/transport.js';
import { LAYOUT_PRESETS } from '../layouts/presets.js';

/**
 * PartyHost — Host-side multi-player PeerJS room manager.
 * - No MQTT: players connect strictly via QR code or 5-char manual room code.
 * - Supports 1-to-N star topology with persistent clientId slot recovery on reconnect.
 * - Supports dynamic layout pushing (global or per-player) and guaranteed private text delivery.
 */
export class PartyHost {
  /**
   * @param {{
   *   roomCode?: string,
   *   transport?: 'dual-dc' | 'kcp',
   *   defaultLayout?: object,
   *   peerOptions?: object,
   *   PeerCtor?: any,
   *   maxPlayers?: number
   * }} opts
   */
  constructor(opts = {}) {
    this.roomCode = opts.roomCode ? normalizeRoomCode(opts.roomCode) : genRoomCode();
    this.transportMode = opts.transport || TRANSPORT_MODE.DUAL_DC;
    this.defaultLayout = opts.defaultLayout || LAYOUT_PRESETS.dual_stick_pro;
    this.peerOptions = opts.peerOptions || { debug: 0 };
    this.PeerCtor = opts.PeerCtor || null;
    this.maxPlayers = opts.maxPlayers || 16;

    this.peer = null;
    this.peerId = null;
    this.players = new Map(); // playerId -> PlayerRecord
    this.listeners = new Map();
    this.msgSeq = 1;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  _emit(event, ...args) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  async start(maxRetries = 5) {
    const PeerClass = this.PeerCtor || (await import('peerjs')).default;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const candidateId = `${PEER_PREFIX}-${this.roomCode}`;
      try {
        const peer = new PeerClass(candidateId, this.peerOptions);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('peer-open-timeout')), 12000);
          peer.once('open', () => { clearTimeout(timer); resolve(); });
          peer.once('error', (err) => { clearTimeout(timer); reject(err); });
        });
        this.peer = peer;
        this.peerId = candidateId;
        this.peer.on('connection', (conn) => this._handleIncomingConn(conn));
        this.peer.on('error', (err) => this._emit('error', err));
        this._emit('ready', { roomCode: this.roomCode, peerId: this.peerId });
        return { roomCode: this.roomCode, peerId: this.peerId };
      } catch (err) {
        if (err?.type === 'unavailable-id' && attempt + 1 < maxRetries) {
          this.roomCode = genRoomCode();
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate PeerJS room ID');
  }

  /**
   * Attach an incoming PeerJS DataConnection (also callable directly in unit tests).
   */
  _handleIncomingConn(conn) {
    const requestedMode = conn.metadata?.transport === TRANSPORT_MODE.KCP ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
    let boundPlayerId = null;

    const transport = new PeerTransport(conn, {
      mode: requestedMode,
      isInitiator: false,
      handlers: {
        onControl: (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === MSG.HELLO) {
            boundPlayerId = this._registerPlayer(msg, transport, requestedMode);
            return;
          }
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (!player) return;
          player.lastSeen = Date.now();

          if (msg.t === MSG.PING) {
            transport.sendControl({ t: MSG.PONG, ts: msg.ts });
          } else if (msg.t === MSG.PRIVATE_ACK && msg.msgId) {
            const pm = player.privateMessages.find((m) => m.msgId === msg.msgId);
            if (pm) pm.acked = true;
            this._emit('privateAck', boundPlayerId, msg.msgId);
          } else if (msg.t === MSG.ACTION) {
            this._emit('action', boundPlayerId, { id: msg.id, value: msg.value });
          } else if (msg.t === MSG.DRAW) {
            this._emit('draw', boundPlayerId, msg, player);
          } else if (msg.t === MSG.SET_TRANSPORT && msg.mode) {
            const next = transport.setMode(msg.mode);
            player.transportMode = next;
            this._emit('transportChange', boundPlayerId, next);
          }
        },
        onInput: (frame) => {
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (!player) return;
          player.lastSeen = Date.now();
          player.input = frame;
          this._emit('input', boundPlayerId, frame, player);
        },
        onDraw: (frame) => {
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (!player) return;
          player.lastSeen = Date.now();
          this._emit('draw', boundPlayerId, frame, player);
        },
        onMotion: (frame) => {
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (!player) return;
          player.lastSeen = Date.now();
          player.motion = frame;
          this._emit('motion', boundPlayerId, frame, player);
        },
        onClose: () => {
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (player && player.transport === transport) {
            player.connected = false;
            this._emit('playerLeave', boundPlayerId, player);
          }
        },
        onModeChange: (mode) => {
          if (!boundPlayerId) return;
          const player = this.players.get(boundPlayerId);
          if (player) {
            player.transportMode = mode;
            this._emit('transportChange', boundPlayerId, mode);
          }
        },
        onError: (err) => this._emit('error', err),
      },
    });
  }

  _registerPlayer(helloMsg, transport, transportMode) {
    const clientId = String(helloMsg.clientId || `p_${Date.now()}`);
    const existing = this.players.get(clientId);

    if (!existing && this.players.size >= this.maxPlayers) {
      transport.sendControl({ t: MSG.KICK, reason: 'room_full' });
      transport.close();
      return null;
    }

    if (existing) {
      // Seamless slot recovery on mobile refresh / reconnect
      try { existing.transport?.close(); } catch { /* noop */ }
      existing.transport = transport;
      existing.transportMode = transportMode;
      existing.connected = true;
      existing.name = helloMsg.name || existing.name;
      existing.lastSeen = Date.now();

      transport.sendControl({
        t: MSG.WELCOME,
        playerId: existing.id,
        slot: existing.slot,
        roomCode: this.roomCode,
        layout: existing.layout,
        pendingPrivate: existing.privateMessages,
      });
      this._emit('playerReconnect', existing.id, existing);
      return existing.id;
    }

    const slot = this._nextFreeSlot();
    const record = {
      id: clientId,
      slot,
      name: helloMsg.name || `玩家 ${slot + 1}`,
      connected: true,
      transportMode,
      transport,
      layout: this.defaultLayout,
      input: { seq: 0, buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0 },
      motion: null,
      privateMessages: [],
      lastSeen: Date.now(),
    };

    this.players.set(clientId, record);
    transport.sendControl({
      t: MSG.WELCOME,
      playerId: record.id,
      slot: record.slot,
      roomCode: this.roomCode,
      layout: record.layout,
      pendingPrivate: [],
    });
    this._emit('playerJoin', record.id, record);
    return record.id;
  }

  _nextFreeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  /**
   * Push a new controller layout schema to ALL connected players.
   */
  broadcastLayout(layout) {
    this.defaultLayout = layout;
    for (const player of this.players.values()) {
      player.layout = layout;
      if (player.connected) {
        player.transport.sendControl({ t: MSG.LAYOUT, layout });
      }
    }
  }

  /**
   * Push a custom controller layout schema to a SINGLE player (e.g., asymmetric party role).
   */
  setPlayerLayout(playerId, layout) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.layout = layout;
    if (player.connected) {
      player.transport.sendControl({ t: MSG.LAYOUT, layout });
    }
    return true;
  }

  /**
   * Send a private text message / secret role card strictly to ONE player.
   * Cached on the player record so it is automatically replayed if the phone refreshes.
   */
  sendPrivateMessage(playerId, { title = '私密信息', body = '', style = 'card', secret = true }) {
    const player = this.players.get(playerId);
    if (!player) return null;

    const msg = {
      msgId: `pm_${this.msgSeq++}`,
      title,
      body,
      style,
      secret: !!secret,
      ts: Date.now(),
      acked: false,
    };
    player.privateMessages.push(msg);
    if (player.privateMessages.length > 20) {
      player.privateMessages.shift();
    }

    if (player.connected) {
      player.transport.sendControl({ t: MSG.PRIVATE_MSG, ...msg });
    }
    return msg.msgId;
  }

  clearPrivateMessages(playerId, msgId = null) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.privateMessages = msgId
      ? player.privateMessages.filter((m) => m.msgId !== msgId)
      : [];
    if (player.connected) {
      player.transport.sendControl({ t: MSG.PRIVATE_CLEAR, msgId });
    }
  }

  vibrate(playerId, pattern = [40]) {
    const player = this.players.get(playerId);
    if (player?.connected) {
      player.transport.sendControl({ t: MSG.VIBRATE, pattern });
    }
  }

  /**
   * Hot-switch transport mode ('dual-dc' | 'kcp') for all connected players without disconnecting.
   */
  setTransportMode(mode) {
    const normalized = mode === TRANSPORT_MODE.KCP ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
    this.transportMode = normalized;
    for (const player of this.players.values()) {
      this.setPlayerTransportMode(player.id, normalized);
    }
  }

  setPlayerTransportMode(playerId, mode) {
    const player = this.players.get(playerId);
    if (!player) return false;
    const normalized = mode === TRANSPORT_MODE.KCP ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
    player.transportMode = normalized;
    if (player.connected && player.transport) {
      player.transport.setMode(normalized);
      player.transport.sendControl({ t: MSG.SET_TRANSPORT, mode: normalized }, { forcePrimary: true });
    }
    this._emit('transportChange', playerId, normalized);
    return true;
  }

  getPlayers() {
    return [...this.players.values()];
  }

  destroy() {
    for (const player of this.players.values()) {
      player.transport?.close();
    }
    this.players.clear();
    try { this.peer?.destroy(); } catch { /* noop */ }
    this.peer = null;
  }
}
