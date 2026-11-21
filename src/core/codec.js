import { PKT } from './constants.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Compact 16-byte Input Packet (Little-Endian)
 * [0]     uint8  tag = PKT.INPUT (0x01)
 * [1]     uint8  flags (bit 0: hasRedundantMask)
 * [2..3]  uint16 seq (wrapping sequence number for stale-frame rejection)
 * [4..7]  uint32 buttons (bitmask for up to 32 buttons)
 * [8..9]  int16  lx (-32767..32767 -> -1..1)
 * [10..11] int16 ly
 * [12..13] int16 rx
 * [14..15] int16 ry
 */
export function encodeInput({ seq = 0, buttons = 0, lx = 0, ly = 0, rx = 0, ry = 0 }) {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT.INPUT);
  dv.setUint8(1, 0);
  dv.setUint16(2, seq & 0xffff, true);
  dv.setUint32(4, buttons >>> 0, true);
  dv.setInt16(8, clampAxis(lx), true);
  dv.setInt16(10, clampAxis(ly), true);
  dv.setInt16(12, clampAxis(rx), true);
  dv.setInt16(14, clampAxis(ry), true);
  return new Uint8Array(buf);
}

export function decodeInput(bytes) {
  const u8 = toUint8Array(bytes);
  if (u8.byteLength < 16 || u8[0] !== PKT.INPUT) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return {
    seq: dv.getUint16(2, true),
    buttons: dv.getUint32(4, true),
    lx: dv.getInt16(8, true) / 32767,
    ly: dv.getInt16(10, true) / 32767,
    rx: dv.getInt16(12, true) / 32767,
    ry: dv.getInt16(14, true) / 32767,
  };
}

/**
 * Compact 28-byte IMU Motion Packet (Little-Endian)
 * [0]      uint8   tag = PKT.MOTION (0x02)
 * [1]      uint8   flags (bit 0: swingHit)
 * [2..3]   uint16  seq
 * [4..7]   float32 qx (orientation quaternion x)
 * [8..11]  float32 qy
 * [12..15] float32 qz
 * [16..19] float32 qw
 * [20..23] float32 omega (angular speed rad/s)
 * [24..27] float32 hitPeak (0 if no swing, >0 peak omega)
 */
export function encodeMotion({ seq = 0, q = { x: 0, y: 0, z: 0, w: 1 }, omega = 0, hit = 0 }) {
  const buf = new ArrayBuffer(28);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT.MOTION);
  dv.setUint8(1, hit > 0 ? 1 : 0);
  dv.setUint16(2, seq & 0xffff, true);
  dv.setFloat32(4, q.x, true);
  dv.setFloat32(8, q.y, true);
  dv.setFloat32(12, q.z, true);
  dv.setFloat32(16, q.w, true);
  dv.setFloat32(20, omega, true);
  dv.setFloat32(24, hit, true);
  return new Uint8Array(buf);
}

export function decodeMotion(bytes) {
  const u8 = toUint8Array(bytes);
  if (u8.byteLength < 28 || u8[0] !== PKT.MOTION) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return {
    seq: dv.getUint16(2, true),
    q: {
      x: dv.getFloat32(4, true),
      y: dv.getFloat32(8, true),
      z: dv.getFloat32(12, true),
      w: dv.getFloat32(16, true),
    },
    omega: dv.getFloat32(20, true),
    hit: dv.getFloat32(24, true),
  };
}

/**
 * Control JSON Packet (prefixed with PKT.CONTROL byte for binary transports like KCP)
 */
export function encodeControl(obj) {
  const jsonBytes = textEncoder.encode(JSON.stringify(obj));
  const out = new Uint8Array(1 + jsonBytes.byteLength);
  out[0] = PKT.CONTROL;
  out.set(jsonBytes, 1);
  return out;
}

export function decodeControl(bytes) {
  const u8 = toUint8Array(bytes);
  if (u8.byteLength < 2 || u8[0] !== PKT.CONTROL) return null;
  try {
    return JSON.parse(textDecoder.decode(u8.subarray(1)));
  } catch {
    return null;
  }
}

export function isNewerSeq(seq, lastSeq) {
  if (lastSeq < 0) return true;
  const diff = (seq - lastSeq) & 0xffff;
  return diff > 0 && diff < 0x8000;
}

export function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(0);
}

function clampAxis(v) {
  const n = Math.max(-1, Math.min(1, Number(v) || 0));
  return Math.round(n * 32767);
}
