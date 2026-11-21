import QRCode from 'qrcode';
import { buildJoinUrl } from '../core/constants.js';
import { LAYOUT_PRESETS } from '../layouts/presets.js';
import { PartyHost } from '../sdk/PartyHost.js';
import { attachGamepadAPIAdapter } from '../sdk/adapters/GamepadAPIAdapter.js';
import { ServerBridgeAdapter } from '../sdk/adapters/ServerBridgeAdapter.js';

export class HostDashboardUI {
  constructor(els) {
    this.els = els;
    this.host = null;
    this.gamepadAdapter = null;
    this.bridge = null;
    this.logs = [];
    this._bindControls();
  }

  _bindControls() {
    this.els.newRoomBtn.onclick = () => this.startRoom();
    this.els.transportSelect.onchange = () => this.startRoom();

    this.els.layoutBtns.forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.layout;
        const preset = LAYOUT_PRESETS[key];
        if (preset && this.bridge) {
          this.bridge.broadcastLayout(preset);
          this._log(`已广播布局: ${preset.name}`);
        }
      };
    });

    if (this.els.wsConnectBtn) {
      this.els.wsConnectBtn.onclick = () => {
        const url = this.els.wsUrlInput?.value?.trim();
        if (!url || !this.bridge) return;
        const ws = this.bridge.connectWebSocket(url);
        ws.onopen = () => this._log(`已连接外部服务端: ${url}`);
        ws.onerror = () => this._log(`外部服务端连接失败: ${url}`);
        ws.onclose = () => this._log(`外部服务端连接已关闭: ${url}`);
      };
    }

    this.els.pmSendBtn.onclick = () => {
      const targetId = this.els.pmTarget.value;
      if (!targetId || !this.bridge) return;
      const msgId = this.bridge.sendPrivate(targetId, {
        title: this.els.pmTitle.value.trim() || '私密信息',
        body: this.els.pmBody.value.trim(),
        secret: this.els.pmSecret.checked,
      });
      this._log(`已向 ${targetId} 下发私密文本 (${msgId})`);
    };
  }

  async startRoom() {
    this.destroy();
    const transport = this.els.transportSelect.value;
    this.els.status.textContent = `正在创建 PeerJS 房间（${transport}）…`;

    this.host = new PartyHost({ transport });
    this.gamepadAdapter = attachGamepadAPIAdapter(this.host);
    this.bridge = new ServerBridgeAdapter(this.host, {
      onPlayerJoin: (ev) => {
        this._log(`玩家加入: ${ev.name} (${ev.playerId}, Slot #${ev.slot})`);
        this.renderPlayers();
      },
      onPlayerLeave: (ev) => {
        this._log(`玩家断开: ${ev.playerId}`);
        this.renderPlayers();
      },
      onAction: (ev) => {
        this._log(`玩家动作: ${ev.playerId} -> ${ev.id}=${JSON.stringify(ev.value)}`);
      },
      onPrivateAck: (ev) => {
        this._log(`私密消息已签收: ${ev.playerId} ack ${ev.msgId}`);
      },
      onInput: () => this.renderPlayers(),
      onMotion: () => this.renderPlayers(),
    });

    try {
      const { roomCode } = await this.host.start();
      this.els.code.textContent = roomCode;
      this.els.status.textContent = `房间就绪 · 传输层: ${transport}（支持 Gamepad API）`;
      const url = buildJoinUrl(roomCode, transport);
      await QRCode.toCanvas(this.els.qr, url, { width: 220, margin: 1 });
      this.renderPlayers();
    } catch (err) {
      this.els.status.textContent = `建房失败: ${err.message || err}`;
      this._log(`ERROR: ${err.message || err}`);
    }
  }

  renderPlayers() {
    const players = this.host ? this.host.getPlayers() : [];
    const prevTarget = this.els.pmTarget.value;
    this.els.pmTarget.innerHTML = players.length
      ? players.map((p) => `<option value="${p.id}">${p.name} (Slot #${p.slot})</option>`).join('')
      : '<option value="">暂无已连接玩家</option>';
    if (players.some((p) => p.id === prevTarget)) {
      this.els.pmTarget.value = prevTarget;
    }

    if (players.length === 0) {
      this.els.playersEl.innerHTML = '<div class="muted">等待手机扫码或输入房间码加入…</div>';
      return;
    }

    this.els.playersEl.innerHTML = players.map((p) => {
      const inp = p.input || { lx: 0, ly: 0, buttons: 0 };
      const mot = p.motion;
      const imuLine = mot
        ? `IMU q=(${mot.q.x.toFixed(2)}, ${mot.q.y.toFixed(2)}, ${mot.q.z.toFixed(2)}) ω=${mot.omega.toFixed(1)}`
        : 'IMU: 未开启';
      return `
        <div class="player-card ${p.connected ? '' : 'offline'}">
          <div class="player-head">
            <strong>${p.name}</strong>
            <span class="badge">Slot #${p.slot} · ${p.transportMode}</span>
          </div>
          <div class="telemetry">
            L: (${inp.lx.toFixed(2)}, ${inp.ly.toFixed(2)}) · R: (${(inp.rx || 0).toFixed(2)}, ${(inp.ry || 0).toFixed(2)})<br/>
            Buttons: 0x${(inp.buttons >>> 0).toString(16).padStart(4, '0')}<br/>
            ${imuLine}
          </div>
        </div>
      `;
    }).join('');
  }

  _log(line) {
    const ts = new Date().toLocaleTimeString();
    this.logs.unshift(`[${ts}] ${line}`);
    if (this.logs.length > 40) this.logs.pop();
    this.els.logEl.textContent = this.logs.join('\n');
  }

  destroy() {
    this.bridge?.destroy();
    this.gamepadAdapter?.detach();
    this.host?.destroy();
    this.bridge = null;
    this.gamepadAdapter = null;
    this.host = null;
  }
}
