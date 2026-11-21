import test from 'node:test';
import assert from 'node:assert/strict';
import { PartyHost } from '../src/sdk/PartyHost.js';
import { attachGamepadAPIAdapter } from '../src/sdk/adapters/GamepadAPIAdapter.js';
import { ServerBridgeAdapter } from '../src/sdk/adapters/ServerBridgeAdapter.js';
import { encodeInput, encodeDraw } from '../src/core/codec.js';
import { MSG, TRANSPORT_MODE, DRAW_OP } from '../src/core/constants.js';
import { LAYOUT_PRESETS } from '../src/layouts/presets.js';

function createMockConn(metadata = {}) {
  const handlers = new Map();
  const sent = [];
  const conn = {
    open: true,
    metadata,
    peerConnection: null,
    sent,
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev).push(fn);
    },
    emit(ev, data) {
      (handlers.get(ev) || []).forEach((fn) => fn(data));
    },
    send(data) {
      sent.push(data);
    },
    close() {
      conn.open = false;
      conn.emit('close');
    },
  };
  return conn;
}

test('PartyHost isolates private messages per player, replays on reconnect, and works with adapters', () => {
  const host = new PartyHost({ roomCode: 'ABCDE', transport: TRANSPORT_MODE.DUAL_DC });

  // Mock browser window for GamepadAPIAdapter
  const dispatched = [];
  const mockWin = {
    navigator: { getGamepads: () => [] },
    dispatchEvent: (ev) => dispatched.push(ev.type),
  };
  const padAdapter = attachGamepadAPIAdapter(host, mockWin);

  const bridgeEvents = [];
  const bridge = new ServerBridgeAdapter(host, {
    onPlayerJoin: (e) => bridgeEvents.push(e),
    onAction: (e) => bridgeEvents.push(e),
    onPrivateAck: (e) => bridgeEvents.push(e),
  });

  // Connect Player 1 and Player 2
  const conn1 = createMockConn({ transport: 'dual-dc' });
  const conn2 = createMockConn({ transport: 'dual-dc' });
  host._handleIncomingConn(conn1);
  host._handleIncomingConn(conn2);

  conn1.emit('data', { t: MSG.HELLO, clientId: 'p_alice', name: 'Alice' });
  conn2.emit('data', { t: MSG.HELLO, clientId: 'p_bob', name: 'Bob' });

  assert.equal(host.getPlayers().length, 2);
  assert.equal(dispatched.filter((t) => t === 'gamepadconnected').length, 2);

  // Send private secret ONLY to Alice via ServerBridgeAdapter command
  const ok = bridge.handleServerCommand({
    cmd: 'send_private',
    playerId: 'p_alice',
    title: '你的身份',
    body: '你是卧底',
    secret: true,
  });
  assert.equal(ok, true);

  const alicePrivate = conn1.sent.find((m) => m.t === MSG.PRIVATE_MSG);
  const bobPrivate = conn2.sent.find((m) => m.t === MSG.PRIVATE_MSG);
  assert.ok(alicePrivate, 'Alice must receive her private message');
  assert.equal(alicePrivate.body, '你是卧底');
  assert.equal(bobPrivate, undefined, 'Bob must NOT receive Alice private message');

  // Alice ACKs private message
  conn1.emit('data', { t: MSG.PRIVATE_ACK, msgId: alicePrivate.msgId });
  assert.ok(bridgeEvents.some((e) => e.type === 'private_ack' && e.msgId === alicePrivate.msgId));

  // Alice sends joystick + button input -> verify GamepadAPIAdapter reflects it
  conn1.emit('data', encodeInput({ seq: 1, buttons: 0b1, lx: 0.5, ly: -0.5, rx: 0, ry: 0 }));
  const pads = mockWin.navigator.getGamepads();
  assert.ok(pads[0], 'Slot 0 virtual gamepad should exist');
  assert.equal(pads[0].buttons[0].pressed, true);
  assert.ok(Math.abs(pads[0].axes[0] - 0.5) < 0.001);

  // Broadcast layout change via bridge
  bridge.broadcastLayout(LAYOUT_PRESETS.party_quiz);
  assert.ok(conn1.sent.some((m) => m.t === MSG.LAYOUT && m.layout.id === 'party_quiz'));
  assert.ok(conn2.sent.some((m) => m.t === MSG.LAYOUT && m.layout.id === 'party_quiz'));

  // Alice disconnects -> GamepadAPIAdapter must clean up slot 0
  conn1.close();
  assert.ok(dispatched.includes('gamepaddisconnected'));
  assert.equal(mockWin.navigator.getGamepads()[0], null);

  // Alice reconnects with same clientId -> recovers slot 0 and replays her private message
  const conn1Re = createMockConn({ transport: 'dual-dc' });
  host._handleIncomingConn(conn1Re);
  conn1Re.emit('data', { t: MSG.HELLO, clientId: 'p_alice', name: 'Alice' });
  const welcome = conn1Re.sent.find((m) => m.t === MSG.WELCOME);
  assert.equal(welcome.slot, 0);
  assert.equal(welcome.pendingPrivate.length, 1);
  assert.equal(welcome.pendingPrivate[0].body, '你是卧底');

  bridge.destroy();
  padAdapter.detach();
  host.destroy();
});

test('PartyHost is always ready for both WebRTC and KCP simultaneously per player', () => {
  const host = new PartyHost({ roomCode: 'ABCDEF' }); // zero transport config needed on server
  const conn1 = createMockConn({ transport: 'dual-dc' });
  const conn2 = createMockConn({ transport: 'kcp' });
  host._handleIncomingConn(conn1);
  host._handleIncomingConn(conn2);
  conn1.emit('data', { t: MSG.HELLO, clientId: 'p_rtc', name: 'RtcUser' });
  conn2.emit('data', { t: MSG.HELLO, clientId: 'p_kcp', name: 'KcpUser' });

  assert.equal(host.players.get('p_rtc').transportMode, 'dual-dc');
  assert.equal(host.players.get('p_kcp').transportMode, 'kcp');

  // Player 1 hot-switches to KCP from phone settings while Player 2 switches to dual-dc
  conn1.emit('data', { t: MSG.SET_TRANSPORT, mode: TRANSPORT_MODE.KCP });
  conn2.emit('data', { t: MSG.SET_TRANSPORT, mode: TRANSPORT_MODE.DUAL_DC });
  assert.equal(host.players.get('p_rtc').transportMode, 'kcp');
  assert.equal(host.players.get('p_kcp').transportMode, 'dual-dc');
  assert.equal(host.players.get('p_rtc').connected, true);
  assert.equal(host.players.get('p_kcp').connected, true);

  host.destroy();
});

test('PartyHost hot-pushes draw_board layout and streams real-time drawing strokes to ServerBridgeAdapter', () => {
  const host = new PartyHost({ roomCode: 'DRAW99' });
  const receivedDraws = [];
  const bridge = new ServerBridgeAdapter(host, {
    onDraw: (ev) => receivedDraws.push(ev),
  });

  const conn = createMockConn({ transport: 'dual-dc' });
  host._handleIncomingConn(conn);
  conn.emit('data', { t: MSG.HELLO, clientId: 'p_artist', name: 'Artist' });

  // Hot-push layout change from default gamepad -> draw_board mid-session
  bridge.setLayout('p_artist', LAYOUT_PRESETS.draw_board);
  assert.ok(
    conn.sent.some((m) => m.t === MSG.LAYOUT && m.layout.id === 'draw_board'),
    'Phone must receive hot-pushed draw_board layout',
  );

  // Phone streams reliable START + binary realtime MOVE + reliable UNDO
  conn.emit('data', { t: MSG.DRAW, op: DRAW_OP.START, x: 0.1, y: 0.2, color: '#ef4444', width: 5, strokeId: 1 });
  conn.emit('data', encodeDraw({ seq: 1, op: DRAW_OP.MOVE, x: 0.5, y: 0.6, color: '#ef4444', width: 5, strokeId: 1 }));
  conn.emit('data', { t: MSG.DRAW, op: DRAW_OP.UNDO, strokeId: 1 });

  assert.equal(receivedDraws.length, 3);
  assert.equal(receivedDraws[0].op, DRAW_OP.START);
  assert.equal(receivedDraws[1].op, DRAW_OP.MOVE);
  assert.ok(Math.abs(receivedDraws[1].x - 0.5) < 0.001);
  assert.equal(receivedDraws[2].op, DRAW_OP.UNDO);

  bridge.destroy();
  host.destroy();
});
