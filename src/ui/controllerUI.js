import {
  LAYOUT_PRESETS,
  loadLayoutOverrides,
  saveLayoutOverrides,
  clearLayoutOverrides,
  applyLayoutOverrides,
  mirrorLayoutHorizontally,
} from '../layouts/presets.js';

/**
 * Renders the mobile controller stage from a JSON Layout Schema,
 * handles multi-touch joysticks / D-pads / buttons / action choices,
 * supports live drag-and-resize Layout Edit Mode, and renders Hold-to-Reveal private cards.
 */
export class ControllerUI {
  /**
   * @param {import('../sdk/PartyController.js').PartyController} controller
   * @param {{ stageEl: HTMLElement, privateEl: HTMLElement, imuToggleBtn: HTMLElement, imuCalibBtn: HTMLElement, editBtn: HTMLElement, mirrorBtn: HTMLElement, resetBtn: HTMLElement }} els
   */
  constructor(controller, els) {
    this.controller = controller;
    this.els = els;
    this.baseLayout = LAYOUT_PRESETS.action_gamepad;
    this.activeLayout = structuredClone(this.baseLayout);
    this.editMode = false;
    this.imuActive = false;
    this.latestPrivate = null;
    this.privateRevealed = false;

    this._bindToolbar();
    this._bindControllerEvents();
    this.renderLayout(this.baseLayout);
  }

  _bindToolbar() {
    this.els.editBtn.onclick = () => {
      this.editMode = !this.editMode;
      this.els.stageEl.classList.toggle('editing', this.editMode);
      this.els.editBtn.classList.toggle('active', this.editMode);
      this.els.editBtn.textContent = this.editMode ? '完成编辑' : '编辑布局';
      this.els.mirrorBtn.classList.toggle('hidden', !this.editMode);
      this.els.resetBtn.classList.toggle('hidden', !this.editMode);
      this._renderStage();
    };

    this.els.mirrorBtn.onclick = () => {
      this.activeLayout = mirrorLayoutHorizontally(this.activeLayout);
      this._persistCurrentLayout();
      this._renderStage();
    };

    this.els.resetBtn.onclick = () => {
      clearLayoutOverrides(this.baseLayout.id);
      this.activeLayout = structuredClone(this.baseLayout);
      this._renderStage();
    };

    this.els.imuToggleBtn.onclick = async () => {
      if (!this.imuActive) {
        const ok = await this.controller.enableImu();
        if (ok) {
          this.imuActive = true;
          this.els.imuToggleBtn.classList.add('active');
          this.els.imuToggleBtn.textContent = '体感: 开';
          this.els.imuCalibBtn.classList.remove('hidden');
        } else {
          alert('无法获取陀螺仪权限（iOS 需 HTTPS 环境并允许动作与方向访问）');
        }
      } else {
        this.controller.disableImu();
        this.imuActive = false;
        this.els.imuToggleBtn.classList.remove('active');
        this.els.imuToggleBtn.textContent = '体感: 关';
        this.els.imuCalibBtn.classList.add('hidden');
      }
    };

    this.els.imuCalibBtn.onclick = () => {
      this.controller.calibrateImu();
      this.controller.imu.vibrate(35);
    };
  }

  _bindControllerEvents() {
    this.controller.on('layout', (layout) => {
      this.renderLayout(layout);
    });

    this.controller.on('privateMessage', (msg) => {
      this.latestPrivate = msg;
      this.privateRevealed = !msg.secret;
      this._renderPrivateBox();
    });

    this.controller.on('privateClear', (msgId) => {
      if (!msgId || this.latestPrivate?.msgId === msgId) {
        this.latestPrivate = null;
        this._renderPrivateBox();
      }
    });
  }

  renderLayout(layout) {
    this.baseLayout = structuredClone(layout);
    const saved = loadLayoutOverrides(layout.id);
    this.activeLayout = applyLayoutOverrides(this.baseLayout, saved);
    this._renderStage();
  }

  _persistCurrentLayout() {
    const overrides = {};
    for (const c of this.activeLayout.controls) {
      overrides[c.id] = { x: c.x, y: c.y, w: c.w, h: c.h };
    }
    saveLayoutOverrides(this.baseLayout.id, overrides);
  }

  _renderPrivateBox() {
    const box = this.els.privateEl;
    if (!this.latestPrivate) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const pm = this.latestPrivate;
    box.classList.remove('hidden');
    if (pm.secret && !this.privateRevealed) {
      box.innerHTML = `
        <div class="pm-header"><span>🔒 ${escapeHtml(pm.title || '私密信息')}</span><span>仅你可见</span></div>
        <div class="pm-shield">按住此处查看私密内容，松手自动隐藏</div>
      `;
    } else {
      box.innerHTML = `
        <div class="pm-header"><span>📩 ${escapeHtml(pm.title || '私密信息')}</span><span>${pm.secret ? '松手隐藏' : '来自主机'}</span></div>
        <div class="pm-body">${escapeHtml(pm.body)}</div>
      `;
    }

    if (pm.secret) {
      box.onpointerdown = (ev) => {
        ev.preventDefault();
        box.setPointerCapture(ev.pointerId);
        this.privateRevealed = true;
        this._renderPrivateBox();
      };
      box.onpointerup = box.onpointercancel = () => {
        this.privateRevealed = false;
        this._renderPrivateBox();
      };
    } else {
      box.onpointerdown = box.onpointerup = box.onpointercancel = null;
    }
  }

  _renderStage() {
    const stage = this.els.stageEl;
    stage.innerHTML = '';

    for (const ctrl of this.activeLayout.controls) {
      const wrap = document.createElement('div');
      wrap.className = 'ctrl';
      wrap.style.left = `${ctrl.x}%`;
      wrap.style.top = `${ctrl.y}%`;
      wrap.style.width = `${ctrl.w}%`;
      wrap.style.height = `${ctrl.h}%`;

      if (this.editMode) {
        this._attachEditDrag(wrap, ctrl);
      }

      if (ctrl.type === 'joystick') {
        this._buildJoystick(wrap, ctrl);
      } else if (ctrl.type === 'dpad') {
        this._buildDpad(wrap, ctrl);
      } else if (ctrl.type === 'button') {
        this._buildButton(wrap, ctrl);
      } else if (ctrl.type === 'action_btn') {
        this._buildActionButton(wrap, ctrl);
      }

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      if (this.editMode) {
        this._attachEditResize(handle, wrap, ctrl);
      }
      wrap.appendChild(handle);
      stage.appendChild(wrap);
    }
  }

  _buildJoystick(wrap, ctrl) {
    const base = document.createElement('div');
    base.className = 'joy-base';
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.appendChild(knob);
    wrap.appendChild(base);

    if (this.editMode) return;

    let activePtr = null;
    const update = (ev) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = rect.width * 0.42;
      let dx = ev.clientX - cx;
      let dy = ev.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.controller.setStick(ctrl.stick || 'left', dx / maxR, dy / maxR);
    };

    base.onpointerdown = (ev) => {
      ev.preventDefault();
      activePtr = ev.pointerId;
      base.setPointerCapture(ev.pointerId);
      update(ev);
    };
    base.onpointermove = (ev) => {
      if (ev.pointerId === activePtr) update(ev);
    };
    base.onpointerup = base.onpointercancel = (ev) => {
      if (ev.pointerId !== activePtr) return;
      activePtr = null;
      knob.style.transform = 'translate(-50%, -50%)';
      this.controller.setStick(ctrl.stick || 'left', 0, 0);
    };
  }

  _buildDpad(wrap) {
    const grid = document.createElement('div');
    grid.className = 'dpad-grid';
    const dirs = [
      null, { label: '▲', dx: 0, dy: -1, bit: 12 }, null,
      { label: '◀', dx: -1, dy: 0, bit: 14 }, null, { label: '▶', dx: 1, dy: 0, bit: 15 },
      null, { label: '▼', dx: 0, dy: 1, bit: 13 }, null,
    ];

    for (const d of dirs) {
      const cell = document.createElement('div');
      if (!d) {
        grid.appendChild(cell);
        continue;
      }
      cell.className = 'dpad-cell';
      cell.textContent = d.label;
      if (!this.editMode) {
        cell.onpointerdown = (ev) => {
          ev.preventDefault();
          cell.setPointerCapture(ev.pointerId);
          cell.classList.add('pressed');
          this.controller.setButton(d.bit, true);
          this.controller.setStick('left', d.dx, d.dy);
        };
        cell.onpointerup = cell.onpointercancel = () => {
          cell.classList.remove('pressed');
          this.controller.setButton(d.bit, false);
          this.controller.setStick('left', 0, 0);
        };
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
  }

  _buildButton(wrap, ctrl) {
    const btn = document.createElement('div');
    btn.className = 'ctrl-btn';
    btn.textContent = ctrl.label || 'BTN';
    btn.style.background = ctrl.color || '#3b82f6';
    wrap.appendChild(btn);

    if (this.editMode) return;

    btn.onpointerdown = (ev) => {
      ev.preventDefault();
      btn.setPointerCapture(ev.pointerId);
      btn.classList.add('pressed');
      this.controller.setButton(ctrl.bit ?? 0, true);
      this.controller.imu.vibrate(15);
    };
    btn.onpointerup = btn.onpointercancel = () => {
      btn.classList.remove('pressed');
      this.controller.setButton(ctrl.bit ?? 0, false);
    };
  }

  _buildActionButton(wrap, ctrl) {
    const btn = document.createElement('div');
    btn.className = 'ctrl-btn';
    btn.textContent = ctrl.label || ctrl.value;
    btn.style.background = ctrl.color || '#3b82f6';
    wrap.appendChild(btn);

    if (this.editMode) return;

    btn.onpointerdown = (ev) => {
      ev.preventDefault();
      btn.classList.add('pressed');
      this.controller.sendAction(ctrl.actionId || ctrl.id, ctrl.value);
      this.controller.imu.vibrate(25);
      setTimeout(() => btn.classList.remove('pressed'), 120);
    };
  }

  _attachEditDrag(wrap, ctrl) {
    let startX = 0, startY = 0, origX = 0, origY = 0, pid = null;
    wrap.onpointerdown = (ev) => {
      if (ev.target.classList.contains('resize-handle')) return;
      ev.preventDefault();
      pid = ev.pointerId;
      wrap.setPointerCapture(pid);
      startX = ev.clientX;
      startY = ev.clientY;
      origX = ctrl.x;
      origY = ctrl.y;
    };
    wrap.onpointermove = (ev) => {
      if (ev.pointerId !== pid) return;
      const rect = this.els.stageEl.getBoundingClientRect();
      ctrl.x = Math.max(0, Math.min(100 - ctrl.w, origX + ((ev.clientX - startX) / rect.width) * 100));
      ctrl.y = Math.max(0, Math.min(100 - ctrl.h, origY + ((ev.clientY - startY) / rect.height) * 100));
      wrap.style.left = `${ctrl.x}%`;
      wrap.style.top = `${ctrl.y}%`;
    };
    wrap.onpointerup = wrap.onpointercancel = (ev) => {
      if (ev.pointerId !== pid) return;
      pid = null;
      this._persistCurrentLayout();
    };
  }

  _attachEditResize(handle, wrap, ctrl) {
    let startX = 0, startY = 0, origW = 0, origH = 0, pid = null;
    handle.onpointerdown = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      pid = ev.pointerId;
      handle.setPointerCapture(pid);
      startX = ev.clientX;
      startY = ev.clientY;
      origW = ctrl.w;
      origH = ctrl.h;
    };
    handle.onpointermove = (ev) => {
      if (ev.pointerId !== pid) return;
      const rect = this.els.stageEl.getBoundingClientRect();
      ctrl.w = Math.max(10, Math.min(60, origW + ((ev.clientX - startX) / rect.width) * 100));
      ctrl.h = Math.max(12, Math.min(75, origH + ((ev.clientY - startY) / rect.height) * 100));
      wrap.style.width = `${ctrl.w}%`;
      wrap.style.height = `${ctrl.h}%`;
    };
    handle.onpointerup = handle.onpointercancel = (ev) => {
      if (ev.pointerId !== pid) return;
      pid = null;
      this._persistCurrentLayout();
    };
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
