/**
 * Pure JavaScript KCP (Fast and Reliable ARQ Protocol) Implementation
 * Designed to run over an unreliable, unordered WebRTC RTCDataChannel
 * ({ ordered: false, maxRetransmits: 0 }) or any raw UDP-like datagram carrier.
 *
 * Wire header (24 bytes, little-endian — standard KCP layout):
 *   conv (4B) | cmd (1B) | frg (1B) | wnd (2B) | ts (4B) | sn (4B) | una (4B) | len (4B)
 */

const IKCP_RTO_NDL = 30;       // no-delay min RTO (ms)
const IKCP_RTO_MIN = 100;      // normal min RTO (ms)
const IKCP_RTO_DEF = 200;      // default RTO (ms)
const IKCP_RTO_MAX = 60000;    // max RTO (ms)
const IKCP_CMD_PUSH = 81;      // cmd: push data
const IKCP_CMD_ACK = 82;       // cmd: ack
const IKCP_CMD_WASK = 83;      // cmd: window probe (ask)
const IKCP_CMD_WINS = 84;      // cmd: window size (tell)
const IKCP_ASK_SEND = 1;       // need to send IKCP_CMD_WINS
const IKCP_ASK_TELL = 2;       // need to send IKCP_CMD_WASK
const IKCP_WND_SND = 64;
const IKCP_WND_RCV = 128;
const IKCP_MTU_DEF = 1100;     // Safe for WebRTC DTLS/SCTP without fragmentation
const IKCP_INTERVAL = 10;      // fast mode default 10ms
const IKCP_OVERHEAD = 24;
const IKCP_PROBE_INIT = 7000;
const IKCP_PROBE_LIMIT = 120000;
const IKCP_FASTACK_LIMIT = 5;

function itimediff(later, earlier) {
  return (later - earlier) | 0;
}

class Segment {
  constructor(data = new Uint8Array(0)) {
    this.conv = 0;
    this.cmd = 0;
    this.frg = 0;
    this.wnd = 0;
    this.ts = 0;
    this.sn = 0;
    this.una = 0;
    this.resendts = 0;
    this.rto = 0;
    this.fastack = 0;
    this.xmit = 0;
    this.data = data;
  }
}

export class KcpSession {
  /**
   * @param {number} conv Conversation ID (must match on both peers)
   * @param {(packet: Uint8Array) => void} outputCallback Sends raw datagrams to carrier
   */
  constructor(conv, outputCallback) {
    this.conv = conv >>> 0;
    this.output = outputCallback;

    this.mtu = IKCP_MTU_DEF;
    this.mss = this.mtu - IKCP_OVERHEAD;
    this.sndUna = 0;
    this.sndNxt = 0;
    this.rcvNxt = 0;

    this.rxSrt = 0;
    this.rxRttval = 0;
    this.rxRto = IKCP_RTO_DEF;
    this.rxMinrto = IKCP_RTO_MIN;

    this.sndWnd = IKCP_WND_SND;
    this.rcvWnd = IKCP_WND_RCV;
    this.rmtWnd = IKCP_WND_RCV;
    this.cwnd = 0;
    this.probe = 0;

    this.current = 0;
    this.interval = IKCP_INTERVAL;
    this.tsFlush = IKCP_INTERVAL;
    this.nodelay = 0;
    this.updated = false;
    this.tsProbe = 0;
    this.probeWait = 0;
    this.incr = 0;

    this.fastresend = 0;
    this.nocwnd = 0;
    this.ssthresh = 2;

    this.sndQueue = [];
    this.rcvQueue = [];
    this.sndBuf = [];
    this.rcvBuf = [];
    this.ackList = [];

    // Telemetry stats
    this.stats = {
      txPackets: 0,
      rxPackets: 0,
      retransmits: 0,
      fastRetransmits: 0,
      rttMs: 0,
    };

    // Default to aggressive game-grade turbo mode
    this.setNoDelay(1, 10, 2, 1);
  }

  /**
   * Configure KCP turbo parameters.
   * Fast mode recommended for party games: setNoDelay(1, 10, 2, 1)
   */
  setNoDelay(nodelay = 1, interval = 10, resend = 2, nc = 1) {
    if (nodelay >= 0) {
      this.nodelay = nodelay;
      this.rxMinrto = nodelay ? IKCP_RTO_NDL : IKCP_RTO_MIN;
    }
    if (interval >= 0) {
      this.interval = Math.max(5, Math.min(5000, interval));
    }
    if (resend >= 0) {
      this.fastresend = resend;
    }
    if (nc >= 0) {
      this.nocwnd = nc;
    }
  }

  setMtu(mtu) {
    if (mtu < 50 || mtu < IKCP_OVERHEAD) return false;
    this.mtu = mtu;
    this.mss = mtu - IKCP_OVERHEAD;
    return true;
  }

  setWndSize(sndWnd = 64, rcvWnd = 128) {
    if (sndWnd > 0) this.sndWnd = sndWnd;
    if (rcvWnd > 0) this.rcvWnd = Math.max(rcvWnd, IKCP_WND_RCV);
  }

  /**
   * Queue an application message for reliable, ordered KCP delivery.
   */
  send(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const len = data.byteLength;
    if (len === 0) return 0;

    const count = len <= this.mss ? 1 : Math.ceil(len / this.mss);
    if (count > 255) {
      throw new Error(`KCP message too large (${len} bytes > ${255 * this.mss})`);
    }

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const size = Math.min(this.mss, len - offset);
      const seg = new Segment(data.slice(offset, offset + size));
      seg.frg = count - i - 1;
      this.sndQueue.push(seg);
      offset += size;
    }
    return len;
  }

  /**
   * Pull the next complete reassembled application message, or null if none ready.
   */
  recv() {
    if (this.rcvQueue.length === 0) return null;
    const peekSize = this._peekSize();
    if (peekSize < 0) return null;

    const recover = this.rcvQueue.length >= this.rcvWnd;
    const out = new Uint8Array(peekSize);
    let offset = 0;

    while (this.rcvQueue.length > 0) {
      const seg = this.rcvQueue.shift();
      out.set(seg.data, offset);
      offset += seg.data.byteLength;
      if (seg.frg === 0) break;
    }

    // Move contiguous segments from rcvBuf to rcvQueue
    while (this.rcvBuf.length > 0) {
      const seg = this.rcvBuf[0];
      if (seg.sn === this.rcvNxt && this.rcvQueue.length < this.rcvWnd) {
        this.rcvBuf.shift();
        this.rcvQueue.push(seg);
        this.rcvNxt = (this.rcvNxt + 1) >>> 0;
      } else {
        break;
      }
    }

    if (this.rcvQueue.length < this.rcvWnd && recover) {
      this.probe |= IKCP_ASK_TELL;
    }

    return out;
  }

  /**
   * Feed a raw datagram received from the underlying UDP / WebRTC DataChannel.
   */
  input(rawBytes) {
    const data = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    if (data.byteLength < IKCP_OVERHEAD) return -1;

    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    let flag = 0;
    let maxack = 0;
    const prevUna = this.sndUna;

    while (data.byteLength - offset >= IKCP_OVERHEAD) {
      const conv = dv.getUint32(offset, true);
      if (conv !== this.conv) return -1;
      const cmd = dv.getUint8(offset + 4);
      const frg = dv.getUint8(offset + 5);
      const wnd = dv.getUint16(offset + 6, true);
      const ts = dv.getUint32(offset + 8, true);
      const sn = dv.getUint32(offset + 12, true);
      const una = dv.getUint32(offset + 16, true);
      const len = dv.getUint32(offset + 20, true);
      offset += IKCP_OVERHEAD;

      if (data.byteLength - offset < len) return -2;
      if (
        cmd !== IKCP_CMD_PUSH &&
        cmd !== IKCP_CMD_ACK &&
        cmd !== IKCP_CMD_WASK &&
        cmd !== IKCP_CMD_WINS
      ) {
        return -3;
      }

      this.stats.rxPackets++;
      this.rmtWnd = wnd;
      this._parseUna(una);
      this._shrinkBuf();

      if (cmd === IKCP_CMD_ACK) {
        if (itimediff(this.current, ts) >= 0) {
          this._updateAck(itimediff(this.current, ts));
        }
        this._parseAck(sn);
        this._shrinkBuf();
        if (flag === 0) {
          flag = 1;
          maxack = sn;
        } else if (itimediff(sn, maxack) > 0) {
          maxack = sn;
        }
      } else if (cmd === IKCP_CMD_PUSH) {
        if (itimediff(sn, this.rcvNxt + this.rcvWnd) < 0) {
          this.ackList.push([sn, ts]);
          if (itimediff(sn, this.rcvNxt) >= 0) {
            const seg = new Segment(data.slice(offset, offset + len));
            seg.conv = conv;
            seg.cmd = cmd;
            seg.frg = frg;
            seg.wnd = wnd;
            seg.ts = ts;
            seg.sn = sn;
            seg.una = una;
            this._parseData(seg);
          }
        }
      } else if (cmd === IKCP_CMD_WASK) {
        this.probe |= IKCP_ASK_TELL;
      } else if (cmd === IKCP_CMD_WINS) {
        // Window size already updated via rmtWnd above
      }

      offset += len;
    }

    if (flag !== 0) {
      this._parseFastack(maxack);
    }

    if (itimediff(this.sndUna, prevUna) > 0 && this.cwnd < this.rmtWnd) {
      const mss = this.mss;
      if (this.cwnd < this.ssthresh) {
        this.cwnd++;
        this.incr += mss;
      } else {
        if (this.incr < mss) this.incr = mss;
        this.incr += Math.floor((mss * mss) / this.incr) + Math.floor(mss / 16);
        if ((this.cwnd + 1) * mss <= this.incr) {
          this.cwnd = Math.floor((this.incr + mss - 1) / Math.max(1, mss));
        }
      }
      if (this.cwnd > this.rmtWnd) {
        this.cwnd = this.rmtWnd;
        this.incr = this.rmtWnd * mss;
      }
    }

    return 0;
  }

  /**
   * Drive KCP internal clock (call every 10-20ms with monotonic ms timestamp).
   */
  update(currentMs) {
    this.current = currentMs >>> 0;
    if (!this.updated) {
      this.updated = true;
      this.tsFlush = this.current;
    }

    let slap = itimediff(this.current, this.tsFlush);
    if (slap >= 10000 || slap < -10000) {
      this.tsFlush = this.current;
      slap = 0;
    }

    if (slap >= 0) {
      this.tsFlush = (this.tsFlush + this.interval) >>> 0;
      if (itimediff(this.current, this.tsFlush) >= 0) {
        this.tsFlush = (this.current + this.interval) >>> 0;
      }
      this.flush();
    }
  }

  flush() {
    if (!this.updated) return;
    const current = this.current;
    const wndUnused = Math.max(0, this.rcvWnd - this.rcvQueue.length);

    let outChunks = [];
    let outLen = 0;

    const flushOut = () => {
      if (outLen === 0) return;
      const merged = new Uint8Array(outLen);
      let pos = 0;
      for (const c of outChunks) {
        merged.set(c, pos);
        pos += c.byteLength;
      }
      this.stats.txPackets++;
      this.output(merged);
      outChunks = [];
      outLen = 0;
    };

    const appendSeg = (seg) => {
      const need = IKCP_OVERHEAD + seg.data.byteLength;
      if (outLen + need > this.mtu) {
        flushOut();
      }
      outChunks.push(this._encodeSeg(seg));
      outLen += need;
    };

    // 1. Flush ACKs
    for (const [sn, ts] of this.ackList) {
      const ack = new Segment();
      ack.conv = this.conv;
      ack.cmd = IKCP_CMD_ACK;
      ack.wnd = wndUnused;
      ack.una = this.rcvNxt;
      ack.sn = sn;
      ack.ts = ts;
      appendSeg(ack);
    }
    this.ackList.length = 0;

    // 2. Probe window if remote window is zero
    if (this.rmtWnd === 0) {
      if (this.probeWait === 0) {
        this.probeWait = IKCP_PROBE_INIT;
        this.tsProbe = (current + this.probeWait) >>> 0;
      } else if (itimediff(current, this.tsProbe) >= 0) {
        if (this.probeWait < IKCP_PROBE_INIT) this.probeWait = IKCP_PROBE_INIT;
        this.probeWait = Math.min(IKCP_PROBE_LIMIT, this.probeWait + Math.floor(this.probeWait / 2));
        this.tsProbe = (current + this.probeWait) >>> 0;
        this.probe |= IKCP_ASK_SEND;
      }
    } else {
      this.tsProbe = 0;
      this.probeWait = 0;
    }

    if (this.probe & IKCP_ASK_SEND) {
      const s = new Segment();
      s.conv = this.conv;
      s.cmd = IKCP_CMD_WASK;
      s.wnd = wndUnused;
      s.una = this.rcvNxt;
      appendSeg(s);
    }
    if (this.probe & IKCP_ASK_TELL) {
      const s = new Segment();
      s.conv = this.conv;
      s.cmd = IKCP_CMD_WINS;
      s.wnd = wndUnused;
      s.una = this.rcvNxt;
      appendSeg(s);
    }
    this.probe = 0;

    // 3. Move from sndQueue into sndBuf within window
    let cwnd = Math.min(this.sndWnd, this.rmtWnd);
    if (this.nocwnd === 0) {
      cwnd = Math.min(this.cwnd || 1, cwnd);
    }
    while (itimediff(this.sndNxt, this.sndUna + cwnd) < 0 && this.sndQueue.length > 0) {
      const seg = this.sndQueue.shift();
      seg.conv = this.conv;
      seg.cmd = IKCP_CMD_PUSH;
      seg.wnd = wndUnused;
      seg.ts = current;
      seg.sn = this.sndNxt;
      this.sndNxt = (this.sndNxt + 1) >>> 0;
      seg.una = this.rcvNxt;
      seg.resendts = current;
      seg.rto = this.rxRto;
      seg.fastack = 0;
      seg.xmit = 0;
      this.sndBuf.push(seg);
    }

    // 4. Transmit or retransmit segments in sndBuf
    const resent = this.fastresend > 0 ? this.fastresend : 0xffffffff;
    const rtomin = this.nodelay === 0 ? this.rxRto >> 3 : 0;
    let lost = false;
    let change = 0;

    for (const seg of this.sndBuf) {
      let needSend = false;
      if (seg.xmit === 0) {
        needSend = true;
        seg.xmit++;
        seg.rto = this.rxRto;
        seg.resendts = (current + seg.rto + rtomin) >>> 0;
      } else if (itimediff(current, seg.resendts) >= 0) {
        needSend = true;
        seg.xmit++;
        this.stats.retransmits++;
        if (this.nodelay === 0) {
          seg.rto += Math.max(seg.rto, this.rxRto);
        } else {
          // KCP turbo: 1.5x RTO instead of TCP's 2x
          seg.rto += Math.floor(seg.rto / 2);
        }
        seg.resendts = (current + seg.rto) >>> 0;
        lost = true;
      } else if (seg.fastack >= resent && seg.xmit <= IKCP_FASTACK_LIMIT) {
        needSend = true;
        seg.xmit++;
        seg.fastack = 0;
        seg.resendts = (current + seg.rto) >>> 0;
        this.stats.fastRetransmits++;
        change++;
      }

      if (needSend) {
        seg.ts = current;
        seg.wnd = wndUnused;
        seg.una = this.rcvNxt;
        appendSeg(seg);
      }
    }

    flushOut();

    // Update congestion window if enabled
    if (change > 0) {
      const inflight = this.sndNxt - this.sndUna;
      this.ssthresh = Math.max(2, Math.floor(inflight / 2));
      this.cwnd = this.ssthresh + resent;
      this.incr = this.cwnd * this.mss;
    }
    if (lost) {
      this.ssthresh = Math.max(2, Math.floor(cwnd / 2));
      this.cwnd = 1;
      this.incr = this.mss;
    }
    if (this.cwnd < 1) {
      this.cwnd = 1;
      this.incr = this.mss;
    }
  }

  _peekSize() {
    if (this.rcvQueue.length === 0) return -1;
    const first = this.rcvQueue[0];
    if (first.frg === 0) return first.data.byteLength;
    if (this.rcvQueue.length < first.frg + 1) return -1;
    let len = 0;
    for (const seg of this.rcvQueue) {
      len += seg.data.byteLength;
      if (seg.frg === 0) return len;
    }
    return -1;
  }

  _updateAck(rtt) {
    if (this.rxSrt === 0) {
      this.rxSrt = rtt;
      this.rxRttval = Math.floor(rtt / 2);
    } else {
      const delta = Math.abs(rtt - this.rxSrt);
      this.rxRttval = Math.floor((3 * this.rxRttval + delta) / 4);
      this.rxSrt = Math.floor((7 * this.rxSrt + rtt) / 8);
      if (this.rxSrt < 1) this.rxSrt = 1;
    }
    const rto = this.rxSrt + Math.max(this.interval, 4 * this.rxRttval);
    this.rxRto = Math.max(this.rxMinrto, Math.min(IKCP_RTO_MAX, rto));
    this.stats.rttMs = this.rxSrt;
  }

  _shrinkBuf() {
    this.sndUna = this.sndBuf.length > 0 ? this.sndBuf[0].sn : this.sndNxt;
  }

  _parseAck(sn) {
    if (itimediff(sn, this.sndUna) < 0 || itimediff(sn, this.sndNxt) >= 0) return;
    const idx = this.sndBuf.findIndex((s) => s.sn === sn);
    if (idx >= 0) this.sndBuf.splice(idx, 1);
  }

  _parseUna(una) {
    while (this.sndBuf.length > 0 && itimediff(una, this.sndBuf[0].sn) > 0) {
      this.sndBuf.shift();
    }
  }

  _parseFastack(sn) {
    if (itimediff(sn, this.sndUna) < 0 || itimediff(sn, this.sndNxt) >= 0) return;
    for (const seg of this.sndBuf) {
      if (itimediff(sn, seg.sn) < 0) break;
      if (sn !== seg.sn) seg.fastack++;
    }
  }

  _parseData(newSeg) {
    const sn = newSeg.sn;
    if (itimediff(sn, this.rcvNxt + this.rcvWnd) >= 0 || itimediff(sn, this.rcvNxt) < 0) {
      return;
    }

    let repeat = false;
    let insertIdx = this.rcvBuf.length;
    for (let i = this.rcvBuf.length - 1; i >= 0; i--) {
      const s = this.rcvBuf[i];
      if (s.sn === sn) {
        repeat = true;
        break;
      }
      if (itimediff(sn, s.sn) > 0) {
        insertIdx = i + 1;
        break;
      }
      insertIdx = i;
    }

    if (!repeat) {
      this.rcvBuf.splice(insertIdx, 0, newSeg);
    }

    while (this.rcvBuf.length > 0) {
      const seg = this.rcvBuf[0];
      if (seg.sn === this.rcvNxt && this.rcvQueue.length < this.rcvWnd) {
        this.rcvBuf.shift();
        this.rcvQueue.push(seg);
        this.rcvNxt = (this.rcvNxt + 1) >>> 0;
      } else {
        break;
      }
    }
  }

  _encodeSeg(seg) {
    const buf = new ArrayBuffer(IKCP_OVERHEAD + seg.data.byteLength);
    const dv = new DataView(buf);
    dv.setUint32(0, seg.conv, true);
    dv.setUint8(4, seg.cmd);
    dv.setUint8(5, seg.frg);
    dv.setUint16(6, seg.wnd, true);
    dv.setUint32(8, seg.ts, true);
    dv.setUint32(12, seg.sn, true);
    dv.setUint32(16, seg.una, true);
    dv.setUint32(20, seg.data.byteLength, true);
    const out = new Uint8Array(buf);
    if (seg.data.byteLength > 0) {
      out.set(seg.data, IKCP_OVERHEAD);
    }
    return out;
  }
}
