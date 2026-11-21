import test from 'node:test';
import assert from 'node:assert/strict';
import { KcpSession } from '../src/core/kcp.js';

/**
 * Deterministic pseudo-random generator for reproducible packet loss & jitter tests.
 */
function makeRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

test('KcpSession delivers 50 messages in-order under 15% packet loss and reordering', () => {
  const rng = makeRng(2026);
  const wireAtoB = [];
  const wireBtoA = [];
  let now = 0;

  const enqueueWithImpairment = (queue, pkt) => {
    if (rng() < 0.15) return; // 15% packet drop
    const delay = 10 + Math.floor(rng() * 35); // 10..45ms jitter (causes reordering)
    queue.push({ deliverAt: now + delay, pkt: new Uint8Array(pkt) });
  };

  const client = new KcpSession(0x11223344, (pkt) => enqueueWithImpairment(wireAtoB, pkt));
  const server = new KcpSession(0x11223344, (pkt) => enqueueWithImpairment(wireBtoA, pkt));
  client.setNoDelay(1, 10, 2, 1);
  server.setNoDelay(1, 10, 2, 1);

  const expected = [];
  const received = [];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  for (let i = 0; i < 50; i++) {
    const text = `msg-${i}-payload-${'x'.repeat(i % 7 === 0 ? 1800 : 32)}`; // includes fragmented >MTU messages
    expected.push(text);
    client.send(enc.encode(text));
  }

  for (let tick = 0; tick < 800; tick++) {
    now += 10;
    client.update(now);
    server.update(now);

    for (let i = wireAtoB.length - 1; i >= 0; i--) {
      if (wireAtoB[i].deliverAt <= now) {
        server.input(wireAtoB[i].pkt);
        wireAtoB.splice(i, 1);
      }
    }
    for (let i = wireBtoA.length - 1; i >= 0; i--) {
      if (wireBtoA[i].deliverAt <= now) {
        client.input(wireBtoA[i].pkt);
        wireBtoA.splice(i, 1);
      }
    }

    let msg;
    while ((msg = server.recv()) !== null) {
      received.push(dec.decode(msg));
    }
    if (received.length === expected.length) break;
  }

  assert.equal(received.length, expected.length, 'All 50 messages (including fragmented) must arrive');
  assert.deepEqual(received, expected, 'Messages must be reassembled in exact order');
  assert.ok(
    client.stats.retransmits + client.stats.fastRetransmits > 0,
    'KCP should have performed retransmissions under 15% packet loss',
  );
});
