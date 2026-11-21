import {
  PEER_PREFIX,
  MSG,
  TRANSPORT_MODE,
  normalizeRoomCode,
  getOrCreateClientId,
} from '../core/constants.js';
import { encodeInput, encodeMotion, encodeDraw } from '../core/codec.js';
import { DRAW_OP } from '../core/constants.js';
import { PeerTransport } from '../core/transport.js';
import { ImuSensor } from '../sensor/imu.js';

/**
 * PartyController — Phone-side client SDK.
 * Connects strictly via room code (scanned from QR or typed manually),
 * streams 60Hz touch/button + optional IMU data, receives dynamic layouts & private messages.
 */
export class PartyController {
  constructor(opts = {}) {
    this.clientId = opts.clientId || getOrCreateClientId();
    this.name = opts.name || '';
    this.transportMode = opts.transport || TRANSPORT_MODE.DUAL_DC;
    this.peerOptions = opts.peerOptions || { debug: 0 };
    this.PeerCtor = opts.PeerCtor || null;

    this.peer = null;
    this.transport = null;
    this.imu = new ImuSensor();
    this.listeners = new Map();

    this.inputSeq = 1;
    this.motionSeq = 1;
    this.drawSeq = 1;
    this.inputState = { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0 };
    this.inputDirty = false;
    this.inputTimer = null;
    this.pingTimer = null;
    this.rttMs = null;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  _emit(event, ...args) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  async connect(roomCode, { name, transport } = {}) {
    const code = normalizeRoomCode(roomCode);
    if (!code) throw new Error('Invalid room code');
    if (name) this.name = name;
    if (transport) this.transportMode = transport;

    const PeerClass = this.PeerCtor || (await import('peerjs')).default;
    const targetPeerId = `${PEER_PREFIX}-${code}`;

    this.peer = new PeerClass(undefined, this.peerOptions);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('peer-open-timeout')), 12000);
      this.peer.once('open', () => { clearTimeout(timer); resolve(); });
      this.peer.once('error', (err) => { clearTimeout(timer); reject(err); });
    });

    const conn = this.peer.connect(targetPeerId, {
      reliable: true,
      metadata: { transport: this.transportMode },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('host-connect-timeout')), 12000);
      conn.once('open', () => { clearTimeout(timer); resolve(); });
      conn.once('error', (err) => { clearTimeout(timer); reject(err); });
    });

    this.transport = new PeerTransport(conn, {
      mode: this.transportMode,
      isInitiator: true,
      handlers: {
        onControl: (msg) => this._handleControl(msg),
        onFastChannelReady: (mode) => this._emit('fastReady', mode),
        onClose: () => {
          this._stopLoops();
          this._emit('disconnect');
        },
        onError: (err) => this._emit('error', err),
      },
    });

    this.transport.sendControl({
      t: MSG.HELLO,
      clientId: this.clientId,
      name: this.name,
      transport: this.transportMode,
    });

    this._startLoops();
    return { roomCode: code, clientId: this.clientId };
  }

  _handleControl(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.WELCOME:
        this._emit('welcome', msg);
        if (msg.layout) this._emit('layout', msg.layout);
        if (Array.isArray(msg.pendingPrivate)) {
          for (const pm of msg.pendingPrivate) {
            this._emit('privateMessage', pm);
            this.transport?.sendControl({ t: MSG.PRIVATE_ACK, msgId: pm.msgId });
          }
        }
        break;
      case MSG.LAYOUT:
        if (msg.layout) this._emit('layout', msg.layout);
        break;
      case MSG.SET_TRANSPORT:
        if (msg.mode && this.transport) {
          this.transportMode = this.transport.setMode(msg.mode);
          this._emit('transportChange', this.transportMode);
        }
        break;
      case MSG.PRIVATE_MSG:
        this._emit('privateMessage', msg);
        this.imu.vibrate([30, 40, 30]);
        this.transport?.sendControl({ t: MSG.PRIVATE_ACK, msgId: msg.msgId });
        break;
      case MSG.PRIVATE_CLEAR:
        this._emit('privateClear', msg.msgId || null);
        break;
      case MSG.VIBRATE:
        this.imu.vibrate(msg.pattern || 40);
        break;
      case MSG.PONG:
        this.rttMs = Math.max(0, Date.now() - msg.ts);
        this._emit('ping', this.rttMs);
        break;
      case MSG.KICK:
        this._emit('kick', msg.reason);
        this.disconnect();
        break;
      default:
        break;
    }
  }

  setButton(bit, pressed) {
    const mask = (1 << bit) >>> 0;
    const next = pressed ? (this.inputState.buttons | mask) >>> 0 : (this.inputState.buttons & ~mask) >>> 0;
    if (next !== this.inputState.buttons) {
      this.inputState.buttons = next;
      this.inputDirty = true;
      this.flushInput();
    }
  }

  setStick(stick, x, y) {
    if (stick === 'right') {
      this.inputState.rx = x;
      this.inputState.ry = y;
    } else {
      this.inputState.lx = x;
      this.inputState.ly = y;
    }
    this.inputDirty = true;
  }

  /**
   * Hot-switch between 'dual-dc' and 'kcp' live in settings without disconnecting.
   */
  setTransportMode(mode) {
    const normalized = mode === TRANSPORT_MODE.KCP ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
    this.transportMode = normalized;
    if (this.transport) {
      this.transport.setMode(normalized);
      this.transport.sendControl({ t: MSG.SET_TRANSPORT, mode: normalized }, { forcePrimary: true });
    }
    this._emit('transportChange', normalized);
    return normalized;
  }

  getTransportStats() {
    return this.transport?.getStats() || { mode: this.transportMode, fastChannelOpen: false, kcp: null };
  }

  /**
   * Stream real-time drawing events:
   * - MOVE points go as 14-byte binary realtime frames (zero lag)
   * - START / END / CLEAR / UNDO go over reliable control channel (or KCP)
   */
  sendDraw({ op, x = 0, y = 0, color = '#ffffff', width = 4, strokeId = 0 }) {
    if (!this.transport) return;
    if (op === DRAW_OP.MOVE) {
      this.transport.sendRealtime(encodeDraw({ seq: this.drawSeq++, op, x, y, color, width, strokeId }));
    } else {
      this.transport.sendControl({ t: MSG.DRAW, op, x, y, color, width, strokeId });
    }
  }

  sendAction(id, value) {
    this.transport?.sendControl({ t: MSG.ACTION, id, value });
  }

  async enableImu() {
    const ok = await this.imu.start((frame) => {
      const pkt = encodeMotion({
        seq: this.motionSeq++,
        q: frame.q,
        omega: frame.omega,
        hit: frame.hit,
      });
      this.transport?.sendRealtime(pkt);
      this._emit('localImu', frame);
    });
    return ok;
  }

  disableImu() {
    this.imu.stop();
  }

  calibrateImu() {
    this.imu.calibrate();
    this.transport?.sendControl({ t: MSG.CALIBRATE });
  }

  flushInput() {
    if (!this.transport) return;
    const pkt = encodeInput({
      seq: this.inputSeq++,
      ...this.inputState,
    });
    this.transport.sendRealtime(pkt);
    this.inputDirty = false;
  }

  _startLoops() {
    this._stopLoops();
    // 60Hz input flush (only transmits when dirty or every 10th tick as keepalive snapshot)
    let idleTicks = 0;
    this.inputTimer = setInterval(() => {
      idleTicks++;
      if (this.inputDirty || idleTicks >= 12) {
        idleTicks = 0;
        this.flushInput();
      }
    }, 16);

    this.pingTimer = setInterval(() => {
      this.transport?.sendControl({ t: MSG.PING, ts: Date.now() });
    }, 1500);
  }

  _stopLoops() {
    clearInterval(this.inputTimer);
    clearInterval(this.pingTimer);
    this.inputTimer = null;
    this.pingTimer = null;
  }

  disconnect() {
    this._stopLoops();
    this.imu.stop();
    this.transport?.close();
    try { this.peer?.destroy(); } catch { /* noop */ }
    this.transport = null;
    this.peer = null;
  }
}
