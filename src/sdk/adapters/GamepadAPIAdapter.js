/**
 * GamepadAPIAdapter — 1-line drop-in bridge from PartyHost to W3C HTML5 Gamepad API.
 * Any HTML5 game / Phaser / Three.js / Unity WebGL game reading navigator.getGamepads()
 * immediately sees connected smartphones as standard 16-button, 4-axis gamepads.
 *
 * Unlike older libraries, properly cleans up slots and dispatches `gamepaddisconnected`.
 */
export function attachGamepadAPIAdapter(host, targetWindow = globalThis.window) {
  if (!targetWindow || !targetWindow.navigator) {
    throw new Error('GamepadAPIAdapter requires a browser window with navigator');
  }

  const nativeGetGamepads = typeof targetWindow.navigator.getGamepads === 'function'
    ? targetWindow.navigator.getGamepads.bind(targetWindow.navigator)
    : () => [];

  const virtualPads = new Map(); // slot -> Gamepad-like object
  const unsubs = [];

  const makePad = (player) => ({
    id: `PartyPad (${player.name})`,
    index: player.slot,
    connected: true,
    timestamp: performance.now(),
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
  });

  const dispatchPadEvent = (type, pad) => {
    if (typeof targetWindow.dispatchEvent !== 'function') return;
    const ev = typeof CustomEvent === 'function'
      ? new CustomEvent(type, { detail: { gamepad: pad } })
      : { type, gamepad: pad };
    ev.gamepad = pad;
    targetWindow.dispatchEvent(ev);
  };

  unsubs.push(
    host.on('playerJoin', (_id, player) => {
      const pad = makePad(player);
      virtualPads.set(player.slot, pad);
      dispatchPadEvent('gamepadconnected', pad);
    }),
  );

  unsubs.push(
    host.on('playerReconnect', (_id, player) => {
      let pad = virtualPads.get(player.slot);
      if (!pad) {
        pad = makePad(player);
        virtualPads.set(player.slot, pad);
      }
      pad.connected = true;
      pad.timestamp = performance.now();
      dispatchPadEvent('gamepadconnected', pad);
    }),
  );

  unsubs.push(
    host.on('input', (_id, frame, player) => {
      const pad = virtualPads.get(player.slot);
      if (!pad) return;
      pad.axes[0] = frame.lx;
      pad.axes[1] = frame.ly;
      pad.axes[2] = frame.rx;
      pad.axes[3] = frame.ry;
      for (let i = 0; i < 16; i++) {
        const down = ((frame.buttons >>> i) & 1) === 1;
        pad.buttons[i].pressed = down;
        pad.buttons[i].touched = down;
        pad.buttons[i].value = down ? 1 : 0;
      }
      pad.timestamp = performance.now();
    }),
  );

  unsubs.push(
    host.on('playerLeave', (_id, player) => {
      const pad = virtualPads.get(player.slot);
      if (!pad) return;
      pad.connected = false;
      pad.timestamp = performance.now();
      virtualPads.delete(player.slot);
      dispatchPadEvent('gamepaddisconnected', pad);
    }),
  );

  targetWindow.navigator.getGamepads = () => {
    const physical = Array.from(nativeGetGamepads() || []);
    const maxSlot = Math.max(physical.length - 1, ...[-1, ...virtualPads.keys()]);
    const merged = [];
    for (let i = 0; i <= maxSlot; i++) {
      merged[i] = virtualPads.get(i) || physical[i] || null;
    }
    return merged;
  };

  return {
    detach() {
      unsubs.forEach((fn) => fn());
      targetWindow.navigator.getGamepads = nativeGetGamepads;
      virtualPads.clear();
    },
  };
}
