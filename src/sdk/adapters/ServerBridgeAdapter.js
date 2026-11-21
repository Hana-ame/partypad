/**
 * ServerBridgeAdapter — Fast plug-and-play adapter for connecting PartyHost
 * to ANY game engine or external backend server (Node, Go, Python, Unity, Godot).
 *
 * Supports two integration styles:
 *  1. In-process Game Server: pass callbacks `{ onPlayerJoin, onInput, onMotion, onAction }`
 *     and call `bridge.sendPrivate()`, `bridge.setLayout()`, `bridge.vibrate()`.
 *  2. Remote WebSocket Bridge: pass `{ wsUrl: 'ws://localhost:8080/partypad' }` so the
 *     browser Host automatically relays controller events to your backend server and
 *     executes backend commands (`send_private`, `set_layout`, `broadcast_layout`, `vibrate`).
 */
export class ServerBridgeAdapter {
  /**
   * @param {import('../PartyHost.js').PartyHost} host
   * @param {{
   *   wsUrl?: string,
   *   WebSocketCtor?: any,
   *   onPlayerJoin?: Function,
   *   onPlayerLeave?: Function,
   *   onInput?: Function,
   *   onMotion?: Function,
   *   onAction?: Function,
   *   onPrivateAck?: Function,
   * }} opts
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.ws = null;
    this.unsubs = [];

    this._bindHostEvents();
    if (opts.wsUrl) {
      this.connectWebSocket(opts.wsUrl, opts.WebSocketCtor);
    }
  }

  _bindHostEvents() {
    this.unsubs.push(
      this.host.on('playerJoin', (playerId, player) => {
        const payload = { type: 'player_join', playerId, slot: player.slot, name: player.name };
        this.opts.onPlayerJoin?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('playerReconnect', (playerId, player) => {
        const payload = { type: 'player_reconnect', playerId, slot: player.slot, name: player.name };
        this.opts.onPlayerJoin?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('playerLeave', (playerId, player) => {
        const payload = { type: 'player_leave', playerId, slot: player.slot };
        this.opts.onPlayerLeave?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('input', (playerId, frame) => {
        const payload = { type: 'input', playerId, ...frame };
        this.opts.onInput?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('motion', (playerId, frame) => {
        const payload = { type: 'motion', playerId, ...frame };
        this.opts.onMotion?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('action', (playerId, action) => {
        const payload = { type: 'action', playerId, ...action };
        this.opts.onAction?.(payload);
        this._sendWs(payload);
      }),
      this.host.on('privateAck', (playerId, msgId) => {
        const payload = { type: 'private_ack', playerId, msgId };
        this.opts.onPrivateAck?.(payload);
        this._sendWs(payload);
      }),
    );
  }

  connectWebSocket(wsUrl, WebSocketCtor = globalThis.WebSocket) {
    if (!WebSocketCtor) throw new Error('WebSocket constructor unavailable');
    this.ws = new WebSocketCtor(wsUrl);
    this.ws.onmessage = (ev) => {
      try {
        const cmd = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        this.handleServerCommand(cmd);
      } catch {
        // ignore malformed server command
      }
    };
    return this.ws;
  }

  /**
   * Execute a normalized command object from an external game server.
   */
  handleServerCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return false;
    switch (cmd.cmd) {
      case 'broadcast_layout':
        this.host.broadcastLayout(cmd.layout);
        return true;
      case 'set_layout':
        return this.host.setPlayerLayout(cmd.playerId, cmd.layout);
      case 'send_private':
        return !!this.host.sendPrivateMessage(cmd.playerId, {
          title: cmd.title,
          body: cmd.body,
          style: cmd.style || 'card',
          secret: cmd.secret !== false,
        });
      case 'clear_private':
        this.host.clearPrivateMessages(cmd.playerId, cmd.msgId || null);
        return true;
      case 'vibrate':
        this.host.vibrate(cmd.playerId, cmd.pattern || [40]);
        return true;
      default:
        return false;
    }
  }

  // Ergonomic imperative helpers for in-process servers
  broadcastLayout(layout) {
    this.host.broadcastLayout(layout);
  }

  setLayout(playerId, layout) {
    return this.host.setPlayerLayout(playerId, layout);
  }

  sendPrivate(playerId, message) {
    return this.host.sendPrivateMessage(playerId, message);
  }

  vibrate(playerId, pattern) {
    this.host.vibrate(playerId, pattern);
  }

  _sendWs(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  destroy() {
    this.unsubs.forEach((fn) => fn());
    this.unsubs.length = 0;
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
