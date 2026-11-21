import { EventEmitter } from 'node:events';

/**
 * PartyPadNodeServer — Lightweight Node.js server adapter for PartyPad.
 * Accepts a WebSocketServer instance (e.g. `new WebSocketServer({ port: 8765, path: '/partypad' })`)
 * or attaches to any existing HTTP/WebSocket server.
 */
export class PartyPadNodeServer extends EventEmitter {
  constructor() {
    super();
    this.hosts = new Set();
    this.players = new Map();
  }

  /**
   * Attach a `ws` WebSocketServer instance.
   */
  attachWebSocketServer(wss) {
    wss.on('connection', (ws) => this.attachSocket(ws));
    return this;
  }

  /**
   * Attach a single Host WebSocket connection (also directly testable without real sockets).
   */
  attachSocket(ws) {
    this.hosts.add(ws);
    ws.on('message', (raw) => {
      try {
        const ev = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
        this.handleInboundEvent(ev);
      } catch {
        // ignore malformed JSON
      }
    });
    ws.on('close', () => {
      this.hosts.delete(ws);
    });
    return this;
  }

  handleInboundEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.type) {
      case 'player_join':
      case 'player_reconnect':
        this.players.set(ev.playerId, { id: ev.playerId, slot: ev.slot, name: ev.name });
        this.emit('playerJoin', ev);
        break;
      case 'player_leave':
        this.players.delete(ev.playerId);
        this.emit('playerLeave', ev);
        break;
      case 'input':
        this.emit('input', ev);
        break;
      case 'motion':
        this.emit('motion', ev);
        break;
      case 'action':
        this.emit('action', ev);
        break;
      case 'private_ack':
        this.emit('privateAck', ev);
        break;
      default:
        break;
    }
  }

  _send(cmd) {
    const payload = JSON.stringify(cmd);
    for (const ws of this.hosts) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  sendPrivate(playerId, { title = '私密信息', body = '', style = 'card', secret = true }) {
    this._send({ cmd: 'send_private', playerId, title, body, style, secret });
  }

  clearPrivate(playerId, msgId = null) {
    this._send({ cmd: 'clear_private', playerId, msgId });
  }

  broadcastLayout(layout) {
    this._send({ cmd: 'broadcast_layout', layout });
  }

  setLayout(playerId, layout) {
    this._send({ cmd: 'set_layout', playerId, layout });
  }

  vibrate(playerId, pattern = [40]) {
    this._send({ cmd: 'vibrate', playerId, pattern });
  }
}
