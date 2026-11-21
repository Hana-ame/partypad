import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyHost } from '../src/sdk/PartyHost.js';
import { ServerBridgeAdapter } from '../src/sdk/adapters/ServerBridgeAdapter.js';
import { PartyPadNodeServer } from '../adapters/node/PartyPadServer.mjs';
import { MSG } from '../src/core/constants.js';
import { encodeMotion } from '../src/core/codec.js';

/**
 * End-to-end contract test between browser ServerBridgeAdapter and Node/Go/Unity WebSocket servers.
 */
test('ServerBridgeAdapter <-> PartyPadNodeServer bidirectional WebSocket protocol contract', () => {
  // Paired in-memory WebSocket mocks (browser client <-> server socket)
  let serverOnMessage = null;
  let clientWs = null;

  const mockServerSocket = {
    readyState: 1,
    on(ev, fn) {
      if (ev === 'message') serverOnMessage = fn;
    },
    send(payload) {
      clientWs?.onmessage?.({ data: payload });
    },
  };

  class MockBrowserWebSocket {
    constructor() {
      this.readyState = 1;
      clientWs = this;
    }
    send(payload) {
      serverOnMessage?.(payload);
    }
    close() {
      this.readyState = 3;
    }
  }

  const nodeServer = new PartyPadNodeServer().attachSocket(mockServerSocket);
  const host = new PartyHost({ roomCode: 'TEST1' });
  const bridge = new ServerBridgeAdapter(host, {
    wsUrl: 'ws://localhost:8765/partypad',
    WebSocketCtor: MockBrowserWebSocket,
  });

  // Mock phone PeerJS connection
  const phoneSent = [];
  const phoneHandlers = new Map();
  const mockPhoneConn = {
    open: true,
    metadata: { transport: 'dual-dc' },
    peerConnection: null,
    on: (ev, fn) => {
      if (!phoneHandlers.has(ev)) phoneHandlers.set(ev, []);
      phoneHandlers.get(ev).push(fn);
    },
    emit: (ev, d) => (phoneHandlers.get(ev) || []).forEach((fn) => fn(d)),
    send: (d) => phoneSent.push(d),
    close: () => {},
  };

  let joinedOnServer = null;
  let swingOnServer = null;

  nodeServer.on('playerJoin', (ev) => {
    joinedOnServer = ev;
    nodeServer.sendPrivate(ev.playerId, {
      title: '服务端私密指令',
      body: '你是暗杀者',
      secret: true,
    });
  });

  nodeServer.on('motion', (ev) => {
    if (ev.hit > 0) {
      swingOnServer = ev;
      nodeServer.vibrate(ev.playerId, [50]);
    }
  });

  host._handleIncomingConn(mockPhoneConn);
  mockPhoneConn.emit('data', { t: MSG.HELLO, clientId: 'p_neo', name: 'Neo' });

  assert.equal(joinedOnServer?.playerId, 'p_neo');
  assert.ok(
    phoneSent.some((m) => m.t === MSG.PRIVATE_MSG && m.body === '你是暗杀者' && m.secret === true),
    'Node server sendPrivate must reach the phone with secret=true',
  );

  // Phone swings IMU -> Node server receives hit -> replies with vibrate command
  mockPhoneConn.emit('data', encodeMotion({ seq: 1, q: { x: 0, y: 0, z: 0, w: 1 }, omega: 5.2, hit: 5.2 }));
  assert.ok(swingOnServer && swingOnServer.hit > 5);
  assert.ok(phoneSent.some((m) => m.t === MSG.VIBRATE && m.pattern[0] === 50));

  bridge.destroy();
  host.destroy();
});
