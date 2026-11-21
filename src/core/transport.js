import { PKT, TRANSPORT_MODE } from './constants.js';
import {
  encodeControl,
  decodeControl,
  decodeInput,
  decodeMotion,
  isNewerSeq,
  toUint8Array,
} from './codec.js';
import { KcpSession } from './kcp.js';

/**
 * Unified Transport Wrapper over a PeerJS DataConnection.
 *
 * Mode 1 (Default): 'dual-dc'
 *   - Uses PeerJS's primary reliable DataConnection for critical control messages
 *     (layout updates, private messages, actions, acks).
 *   - Opens a dedicated raw unreliable RTCDataChannel ({ ordered: false, maxRetransmits: 0 })
 *     on the same RTCPeerConnection for 60Hz joystick & IMU frames (zero HoL blocking).
 *
 * Mode 2 (Optional): 'kcp'
 *   - Runs our pure-JS KCP ARQ session over a raw unreliable RTCDataChannel
 *     ({ ordered: false, maxRetransmits: 0 }) for fast-retransmit reliable control delivery,
 *     while high-frequency input/IMU snapshots bypass KCP with a 1-byte header so they
 *     stay zero-retransmit and drop stale out-of-order frames.
 */
const WIRE_RAW = 0x00; // Unreliable bypass (input / motion frames)
const WIRE_KCP = 0x01; // KCP encapsulated reliable control payload

export class PeerTransport {
  /**
   * @param {import('peerjs').DataConnection} conn
   * @param {{ mode?: string, isInitiator?: boolean, conv?: number, handlers?: object }} opts
   */
  constructor(conn, opts = {}) {
    this.conn = conn;
    this.mode = opts.mode || TRANSPORT_MODE.DUAL_DC;
    this.isInitiator = !!opts.isInitiator;
    this.handlers = opts.handlers || {};
    this.fastDc = null;
    this.kcp = null;
    this.kcpTimer = null;
    this.lastInputSeq = -1;
    this.lastMotionSeq = -1;
    this.closed = false;

    this._bindPrimaryConn();
    this._setupFastDataChannel(opts.conv || 0x50414401);
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

  _setupFastDataChannel(conv) {
    const pc = this.conn.peerConnection;
    if (!pc) return;

    const attachDc = (dc) => {
      if (!dc || dc.label !== 'partypad-fast') return;
      this.fastDc = dc;
      dc.binaryType = 'arraybuffer';

      if (this.mode === TRANSPORT_MODE.KCP) {
        this._initKcp(conv);
      }

      dc.onmessage = (ev) => {
        if (this.closed) return;
        const u8 = toUint8Array(ev.data);
        if (u8.byteLength === 0) return;

        if (this.mode === TRANSPORT_MODE.KCP) {
          const wireTag = u8[0];
          const body = u8.subarray(1);
          if (wireTag === WIRE_KCP && this.kcp) {
            this.kcp.input(body);
            this._drainKcp();
          } else if (wireTag === WIRE_RAW) {
            this._dispatchBinary(body);
          }
        } else {
          this._dispatchBinary(u8);
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
        // Fallback gracefully to primary PeerJS channel if browser rejects extra DC
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

  _initKcp(conv) {
    this.kcp = new KcpSession(conv, (kcpPacket) => {
      if (this.fastDc?.readyState === 'open') {
        const frame = new Uint8Array(1 + kcpPacket.byteLength);
        frame[0] = WIRE_KCP;
        frame.set(kcpPacket, 1);
        this.fastDc.send(frame);
      }
    });
    this.kcp.setNoDelay(1, 10, 2, 1);
    this.kcp.setMtu(1100);

    clearInterval(this.kcpTimer);
    this.kcpTimer = setInterval(() => {
      if (!this.kcp || this.closed) return;
      this.kcp.update(Math.floor(performance.now()));
      this._drainKcp();
    }, 10);
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
    } else if (tag === PKT.CONTROL) {
      const obj = decodeControl(u8);
      if (obj) this.handlers.onControl?.(obj);
    }
  }

  /**
   * Reliable delivery (layouts, private messages, actions, acks).
   * Uses KCP when mode === 'kcp' and fastDc is open; otherwise PeerJS reliable DC.
   */
  sendControl(obj) {
    if (this.closed) return;
    if (this.mode === TRANSPORT_MODE.KCP && this.kcp && this.fastDc?.readyState === 'open') {
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
      if (this.mode === TRANSPORT_MODE.KCP) {
        const frame = new Uint8Array(1 + u8.byteLength);
        frame[0] = WIRE_RAW;
        frame.set(u8, 1);
        this.fastDc.send(frame);
      } else {
        this.fastDc.send(u8);
      }
      return;
    }
    // Graceful fallback before fastDc opens
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
    clearInterval(this.kcpTimer);
    try { this.fastDc?.close(); } catch { /* noop */ }
    try { this.conn?.close(); } catch { /* noop */ }
  }

  _handleClose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.kcpTimer);
    this.handlers.onClose?.();
  }
}
