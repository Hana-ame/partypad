import { PartyHost } from '../../src/sdk/PartyHost.js';
import { attachGamepadAPIAdapter } from '../../src/sdk/adapters/GamepadAPIAdapter.js';
import { ServerBridgeAdapter } from '../../src/sdk/adapters/ServerBridgeAdapter.js';
import { LAYOUT_PRESETS } from '../../src/layouts/presets.js';
import { buildJoinUrl, TRANSPORT_MODE } from '../../src/core/constants.js';

/**
 * Pure Frontend (Zero-Backend) Adapter for HTML5 Canvas / Phaser / Three.js / React games.
 * Wraps PartyHost + optional W3C Gamepad API + clean per-frame state polling.
 */
export class FrontendPartyAdapter {
  /**
   * @param {{
   *   transport?: 'dual-dc' | 'kcp',
   *   enableGamepadAPI?: boolean,
   *   defaultLayout?: object,
   *   onPlayerJoin?: Function,
   *   onPlayerLeave?: Function,
   *   onAction?: Function,
   *   onSwing?: Function,
   * }} opts
   */
  constructor(opts = {}) {
    this.host = new PartyHost({
      transport: opts.transport || TRANSPORT_MODE.DUAL_DC,
      defaultLayout: opts.defaultLayout || LAYOUT_PRESETS.action_gamepad,
    });
    this.gamepad = opts.enableGamepadAPI ? attachGamepadAPIAdapter(this.host) : null;
    this.bridge = new ServerBridgeAdapter(this.host, {
      onPlayerJoin: opts.onPlayerJoin,
      onPlayerLeave: opts.onPlayerLeave,
      onAction: opts.onAction,
      onMotion: (ev) => {
        if (ev.hit > 0) opts.onSwing?.(ev);
      },
    });
  }

  async start() {
    const info = await this.host.start();
    return {
      ...info,
      joinUrl: buildJoinUrl(info.roomCode, this.host.transportMode),
    };
  }

  /**
   * Call inside requestAnimationFrame() to read all connected players' latest inputs & IMU.
   */
  getPlayerStates() {
    return this.host.getPlayers().map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      connected: p.connected,
      lx: p.input?.lx || 0,
      ly: p.input?.ly || 0,
      rx: p.input?.rx || 0,
      ry: p.input?.ry || 0,
      buttons: p.input?.buttons || 0,
      isPressed: (bit) => (((p.input?.buttons || 0) >>> bit) & 1) === 1,
      motion: p.motion,
    }));
  }

  broadcastLayout(layout) {
    this.bridge.broadcastLayout(layout);
  }

  setPlayerLayout(playerId, layout) {
    return this.bridge.setLayout(playerId, layout);
  }

  sendPrivate(playerId, { title, body, secret = true }) {
    return this.bridge.sendPrivate(playerId, { title, body, secret });
  }

  vibrate(playerId, pattern = [35]) {
    this.bridge.vibrate(playerId, pattern);
  }

  destroy() {
    this.bridge.destroy();
    this.gamepad?.detach();
    this.host.destroy();
  }
}
