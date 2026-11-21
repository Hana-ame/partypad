import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeInput,
  decodeInput,
  encodeMotion,
  decodeMotion,
  encodeControl,
  decodeControl,
  isNewerSeq,
} from '../src/core/codec.js';

test('Input binary codec round-trip (16 bytes)', () => {
  const pkt = encodeInput({
    seq: 4201,
    buttons: 0b10101,
    lx: -0.75,
    ly: 0.5,
    rx: 1,
    ry: -1,
  });
  assert.equal(pkt.byteLength, 16);
  const decoded = decodeInput(pkt);
  assert.equal(decoded.seq, 4201);
  assert.equal(decoded.buttons, 0b10101);
  assert.ok(Math.abs(decoded.lx - (-0.75)) < 0.001);
  assert.ok(Math.abs(decoded.ly - 0.5) < 0.001);
  assert.equal(decoded.rx, 1);
  assert.equal(decoded.ry, -1);
});

test('IMU motion binary codec round-trip (28 bytes)', () => {
  const pkt = encodeMotion({
    seq: 99,
    q: { x: 0.1, y: 0.2, z: 0.3, w: 0.927 },
    omega: 4.5,
    hit: 4.5,
  });
  assert.equal(pkt.byteLength, 28);
  const decoded = decodeMotion(pkt);
  assert.equal(decoded.seq, 99);
  assert.ok(Math.abs(decoded.q.w - 0.927) < 0.001);
  assert.ok(Math.abs(decoded.omega - 4.5) < 0.001);
  assert.ok(Math.abs(decoded.hit - 4.5) < 0.001);
});

test('Control JSON codec & sequence wraparound comparison', () => {
  const obj = { t: 'private_msg', title: '身份', body: '卧底', secret: true };
  const decoded = decodeControl(encodeControl(obj));
  assert.deepEqual(decoded, obj);

  assert.equal(isNewerSeq(5, 4), true);
  assert.equal(isNewerSeq(4, 5), false);
  assert.equal(isNewerSeq(0, 65535), true); // uint16 wraparound
  assert.equal(isNewerSeq(65535, 0), false);
});
