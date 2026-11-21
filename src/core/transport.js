import { PKT, TRANSPORT_MODE } from './constants.js';
import {
  encodeControl,
  decodeControl,
  decodeInput,
  decodeMotion,
  decodeDraw,
  isNewerSeq,
  toUint8Array,
} from './codec.js';
import { KcpSession } from './kcp.js';

/**
 * Unified Transport Wrapper over a PeerJS DataConnection with ZERO-DISCONNECT KCP Hot-Switching.
 *
 * Every datagram on `partypad-fast` ({ ordered: false, maxRetransmits: 0 }) carries a 1-byte wire tag:
 *   0x00 (WIRE_RAW) -> Unreliable low-latency input / IMU frames (always bypasses KCP)
 *   0x01 (WIRE_KCP) -> KCP ARQ encapsulated reliable control frames
 *
 * Because both modes share the exact same wire framing, calling `setMode('kcp' | 'dual-dc')`
 * switches transport live at runtime without closing or re-negotiating the PeerJS connection.
 */
const WIRE_RAW = 0x00;
const WIRE_KCP = 0x01;

export class PeerTransport {
  /**
   * @param {import('peerjs').DataConnection} conn
   * @param {{ mode?: string, isInitiator?: boolean, conv?: number, handlers?: object }} opts
   */
  constructor(conn, opts = {}) {
    this.conn = conn;
    this.mode = opts.mode || TRANSPORT_MODE.DUAL_DC;
    this.isInitiator = !!opts.isInitiator;
    this.conv = opts.conv || 0x50414401;
    this.handlers = opts.handlers || {};
    this.fastDc = null;
    this.kcp = null;
    this.kcpTimer = null;
    this.lastInputSeq = -1;
    this.lastMotionSeq = -1;
    this.closed = false;

    this._bindPrimaryConn();
    this._setupFastDataChannel();
  }

  /**
   * Hot-switch between 'dual-dc' and 'kcp' without disconnecting.
   */
  setMode(nextMode) {
    const normalized = nextMode === TRANSPORT_MODE.KCP
      ? TRANSPORT_MODE.KCP
      : TRANSPORT_MODE.DUAL_DC;
    if (this.mode === normalized) return this.mode;
    this.mode = normalized;

    if (this.mode === TRANSPORT_MODE.KCP) {
      this._ensureKcp();
    } else {
      this._stopKcpTimer();
    }
    this.handlers.onModeChange?.(this.mode);
    return this.mode;
  }

  _bindPrimaryConn() {
    this.conn.on('data', (payload) => {
      if (this.closed) return;
      if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
        this._dispatchBinary(toUint8Array(payload));
      } else if (payload && typeof payload === 'object') {
        this.handlers.onControl?.(payload);
      } else if (typeof payload === 'string') {
        try {
          this.handlers.onControl?.(JSON.parse(payload));
        } catch {
          // ignore malformed
        }
      }
    });

    this.conn.on('close', () => this._handleClose());
    this.conn.on('error', (err) => this.handlers.onError?.(err));
  }

  _setupFastDataChannel() {
    const pc = this.conn.peerConnection;
    if (!pc) return;

    const attachDc = (dc) => {
      if (!dc || dc.label !== 'partypad-fast') return;
      this.fastDc = dc;
      dc.binaryType = 'arraybuffer';

      if (this.mode === TRANSPORT_MODE.KCP) {
        this._ensureKcp();
      }

      dc.onmessage = (ev) => {
        if (this.closed) return;
        const u8 = toUint8Array(ev.data);
        if (u8.byteLength < 2) return;

        const wireTag = u8[0];
        const body = u8.subarray(1);
        if (wireTag === WIRE_KCP) {
          this._ensureKcp();
          this.kcp.input(body);
          this._drainKcp();
        } else if (wireTag === WIRE_RAW) {
          this._dispatchBinary(body);
        }
      };

      dc.onopen = () => {
        this.handlers.onFastChannelReady?.(this.mode);
      };
    };

    if (this.isInitiator) {
      try {
        const dc = pc.createDataChannel('partypad-fast', {
          ordered: false,
          maxRetransmits: 0,
        });
        attachDc(dc);
      } catch (err) {
        console.warn('[PartyPad] Could not create fast DataChannel, falling back:', err);
      }
    } else {
      const prevHandler = pc.ondatachannel;
      pc.ondatachannel = (ev) => {
        if (ev.channel?.label === 'partypad-fast') {
          attachDc(ev.channel);
        } else if (prevHandler) {
          prevHandler.call(pc, ev);
        }
      };
    }
  }

  _ensureKcp() {
    if (!this.kcp) {
      this.kcp = new KcpSession(this.conv, (kcpPacket) => {
        if (this.fastDc?.readyState === 'open') {
          const frame = new Uint8Array(1 + kcpPacket.byteLength);
          frame[0] = WIRE_KCP;
          frame.set(kcpPacket, 1);
          this.fastDc.send(frame);
        }
      });
      this.kcp.setNoDelay(1, 10, 2, 1);
      this.kcp.setMtu(1100);
    }

    if (!this.kcpTimer && !this.closed) {
      this.kcpTimer = setInterval(() => {
        if (!this.kcp || this.closed) return;
        this.kcp.update(Math.floor(performance.now()));
        this._drainKcp();
      }, 10);
    }
  }

  _stopKcpTimer() {
    clearInterval(this.kcpTimer);
    this.kcpTimer = null;
  }

  _drainKcp() {
    if (!this.kcp) return;
    let msg;
    while ((msg = this.kcp.recv()) !== null) {
      this._dispatchBinary(msg);
    }
  }

  _dispatchBinary(u8) {
    if (u8.byteLength === 0) return;
    const tag = u8[0];
    if (tag === PKT.INPUT) {
      const frame = decodeInput(u8);
      if (frame && isNewerSeq(frame.seq, this.lastInputSeq)) {
        this.lastInputSeq = frame.seq;
        this.handlers.onInput?.(frame);
      }
    } else if (tag === PKT.MOTION) {
      const frame = decodeMotion(u8);
      if (frame && isNewerSeq(frame.seq, this.lastMotionSeq)) {
        this.lastMotionSeq = frame.seq;
        this.handlers.onMotion?.(frame);
      }
    } else if (tag === PKT.DRAW) {
      const frame = decodeDraw(u8);
      if (frame) this.handlers.onDraw?.(frame);
    } else if (tag === PKT.CONTROL) {
      const obj = decodeControl(u8);
      if (obj) this.handlers.onControl?.(obj);
    }
  }

  /**
   * Reliable delivery (layouts, private messages, actions, acks).
   * Uses KCP when mode === 'kcp' and fastDc is open; otherwise PeerJS reliable DC.
   */
  sendControl(obj, { forcePrimary = false } = {}) {
    if (this.closed) return;
    if (!forcePrimary && this.mode === TRANSPORT_MODE.KCP && this.kcp && this.fastDc?.readyState === 'open') {
      this.kcp.send(encodeControl(obj));
      this.kcp.update(Math.floor(performance.now()));
      return;
    }
    if (this.conn?.open) {
      this.conn.send(obj);
    }
  }

  /**
   * Unreliable low-latency delivery (60Hz joystick, button snapshots, IMU frames).
   */
  sendRealtime(bytes) {
    if (this.closed) return;
    const u8 = toUint8Array(bytes);
    if (this.fastDc?.readyState === 'open') {
      const frame = new Uint8Array(1 + u8.byteLength);
      frame[0] = WIRE_RAW;
      frame.set(u8, 1);
      this.fastDc.send(frame);
      return;
    }
    if (this.conn?.open) {
      this.conn.send(u8);
    }
  }

  getStats() {
    return {
      mode: this.mode,
      fastChannelOpen: this.fastDc?.readyState === 'open',
      kcp: this.kcp ? { ...this.kcp.stats } : null,
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._stopKcpTimer();
    try { this.fastDc?.close(); } catch { /* noop */ }
    try { this.conn?.close(); } catch { /* noop */ }
  }

  _handleClose() {
    if (this.closed) return;
    this.closed = true;
    this._stopKcpTimer();
    this.handlers.onClose?.();
  }
}
