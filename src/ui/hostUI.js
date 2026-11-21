import { DRAW_OP } from '../core/constants.js';
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
    this.drawStrokes = new Map(); // playerId -> [{id, color, width, pts}]
    this._bindControls();
  }

  _bindControls() {
    this.els.newRoomBtn.onclick = () => this.startRoom();
    if (this.els.transportSelect) this.els.transportSelect.onchange = () => {
      if (this.host) {
        const mode = this.els.transportSelect.value;
        this.host.setTransportMode(mode);
        this.els.status.textContent = `房间就绪 · 已热切换传输层: ${mode}`;
        this._log(`已热切换全部玩家传输层 -> ${mode}`);
        this.renderPlayers();
      } else {
        this.startRoom();
      }
    };

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
    const transport = 'auto (WebRTC + KCP)';
    this.els.status.textContent = `正在创建 PeerJS 房间（${transport}）…`;

    this.host = new PartyHost();
    this.gamepadAdapter = attachGamepadAPIAdapter(this.host);
    this.host.on('transportChange', (pid, mode) => {
      this._log(`玩家 ${pid} 传输层已热切换 -> ${mode}`);
      this.renderPlayers();
    });
    this.bridge = new ServerBridgeAdapter(this.host, {
      onPlayerJoin: (ev) => {
        this._log(`玩家加入: ${ev.name} (${ev.playerId}, Slot #${ev.slot})`);
        this.renderPlayers();
      },
      onPlayerLeave: (ev) => {
        this._log(`玩家断开: ${ev.playerId}`);
        this.renderPlayers();
      },
      onDraw: (ev) => this._handleDraw(ev),
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
      this.els.status.textContent = '房间就绪 · 已同时兼容 WebRTC / KCP（随手机端设置热切换）';
      const url = buildJoinUrl(roomCode);
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


  _handleDraw(ev) {
    if (!this.drawStrokes.has(ev.playerId)) {
      this.drawStrokes.set(ev.playerId, []);
    }
    const list = this.drawStrokes.get(ev.playerId);
    if (ev.op === DRAW_OP.CLEAR) {
      list.length = 0;
      this._log(`玩家 ${ev.playerId} 清空了画板`);
    } else if (ev.op === DRAW_OP.UNDO) {
      const idx = list.findIndex((s) => s.id === ev.strokeId);
      if (idx >= 0) list.splice(idx, 1);
      else list.pop();
    } else if (ev.op === DRAW_OP.START) {
      list.push({ id: ev.strokeId, color: ev.color || '#fff', width: ev.width || 4, pts: [{ x: ev.x, y: ev.y }] });
    } else if (ev.op === DRAW_OP.MOVE || ev.op === DRAW_OP.END) {
      let st = list.find((s) => s.id === ev.strokeId);
      if (!st) {
        st = { id: ev.strokeId, color: ev.color || '#fff', width: ev.width || 4, pts: [] };
        list.push(st);
      }
      st.pts.push({ x: ev.x, y: ev.y });
    }
    this._renderDrawCanvas();
  }

  _renderDrawCanvas() {
    const canvas = this.els.drawCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const list of this.drawStrokes.values()) {
      for (const st of list) {
        if (st.pts.length === 0) continue;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.width;
        ctx.beginPath();
        ctx.moveTo(st.pts[0].x * w, st.pts[0].y * h);
        for (let i = 1; i < st.pts.length; i++) {
          ctx.lineTo(st.pts[i].x * w, st.pts[i].y * h);
        }
        ctx.stroke();
      }
    }
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
