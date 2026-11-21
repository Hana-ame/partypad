import { DRAW_OP } from '../core/constants.js';
import {
  LAYOUT_PRESETS,
  loadCustomLayout,
  saveCustomLayout,
  clearCustomLayout,
  mirrorLayoutHorizontally,
} from '../layouts/presets.js';

const BTN_PALETTE = ['#22c55e', '#ef4444', '#3b82f6', '#eab308', '#a855f7', '#14b8a6', '#f97316', '#ec4899'];

/**
 * Renders the landscape fullscreen mobile controller from any Layout Schema.
 * Supports:
 *  - Dual joysticks (left + right), arbitrary button counts (bits 0..31), D-pad, action choices, inline text_input
 *  - Always-available quick text input drawer
 *  - Live Edit Mode: drag to move, drag handle to resize, freely ADD or DELETE controls, mirror, reset
 *  - Hold-to-Reveal private message card pushed from Host
 */
export class ControllerUI {
  constructor(controller, els) {
    this.controller = controller;
    this.els = els;
    this.baseLayout = LAYOUT_PRESETS.dual_stick_pro;
    this.activeLayout = structuredClone(this.baseLayout);
    this.editMode = false;
    this.imuActive = false;
    this.latestPrivate = null;
    this.privateRevealed = false;
    this.customSeq = 1;

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
      this.els.editBar.classList.toggle('hidden', !this.editMode);
      this._renderStage();
    };

    this.els.addJoyLBtn.onclick = () => this._addControl({
      id: `joy_l_${this.customSeq++}`,
      type: 'joystick',
      stick: 'left',
      label: 'L',
      x: 8, y: 26, w: 24, h: 62,
    });

    this.els.addJoyRBtn.onclick = () => this._addControl({
      id: `joy_r_${this.customSeq++}`,
      type: 'joystick',
      stick: 'right',
      label: 'R',
      x: 62, y: 26, w: 24, h: 62,
    });

    this.els.addBtnBtn.onclick = () => {
      const nextBit = this._nextFreeButtonBit();
      const color = BTN_PALETTE[nextBit % BTN_PALETTE.length];
      this._addControl({
        id: `btn_${nextBit}_${this.customSeq++}`,
        type: 'button',
        bit: nextBit,
        label: `B${nextBit + 1}`,
        color,
        x: 42 + (nextBit % 4) * 5,
        y: 24 + (nextBit % 3) * 10,
        w: 12,
        h: 24,
      });
    };

    this.els.addDpadBtn.onclick = () => this._addControl({
      id: `dpad_${this.customSeq++}`,
      type: 'dpad',
      label: 'DIR',
      x: 10, y: 24, w: 24, h: 60,
    });

    if (this.els.addDrawBtn) {
      this.els.addDrawBtn.onclick = () => this._addControl({
        id: `draw_${this.customSeq++}`,
        type: 'draw_pad',
        label: '画板',
        x: 6, y: 6, w: 88, h: 88,
      });
    }

    this.els.addTextBtn.onclick = () => this._addControl({
      id: `txt_${this.customSeq++}`,
      type: 'text_input',
      actionId: 'text_input',
      placeholder: '输入文本发送到主机…',
      label: '发送',
      x: 20, y: 8, w: 60, h: 20,
    });

    this.els.mirrorBtn.onclick = () => {
      this.activeLayout = mirrorLayoutHorizontally(this.activeLayout);
      saveCustomLayout(this.baseLayout.id, this.activeLayout);
      this._renderStage();
    };

    this.els.resetBtn.onclick = () => {
      clearCustomLayout(this.baseLayout.id);
      this.activeLayout = structuredClone(this.baseLayout);
      this._renderStage();
    };

    // Quick text input drawer
    this.els.textToggleBtn.onclick = () => {
      const hidden = this.els.textDrawer.classList.toggle('hidden');
      this.els.textToggleBtn.classList.toggle('active', !hidden);
      if (!hidden) this.els.textInput.focus();
    };
    this.els.textCloseBtn.onclick = () => {
      this.els.textDrawer.classList.add('hidden');
      this.els.textToggleBtn.classList.remove('active');
    };
    const submitDrawerText = () => {
      const val = this.els.textInput.value.trim();
      if (!val) return;
      this.controller.sendAction('text_input', val);
      this.controller.imu.vibrate(20);
      this.els.textInput.value = '';
    };
    this.els.textSendBtn.onclick = submitDrawerText;
    this.els.textInput.onkeydown = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submitDrawerText();
      }
    };

    // IMU toggle & calibrate
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

  _addControl(ctrl) {
    this.activeLayout.controls.push(ctrl);
    saveCustomLayout(this.baseLayout.id, this.activeLayout);
    this._renderStage();
  }

  _removeControl(ctrlId) {
    this.activeLayout.controls = this.activeLayout.controls.filter((c) => c.id !== ctrlId);
    saveCustomLayout(this.baseLayout.id, this.activeLayout);
    this._renderStage();
  }

  _nextFreeButtonBit() {
    const used = new Set(
      this.activeLayout.controls
        .filter((c) => c.type === 'button' && typeof c.bit === 'number')
        .map((c) => c.bit),
    );
    for (let b = 0; b < 32; b++) {
      if (!used.has(b)) return b;
    }
    return 0;
  }

  renderLayout(layout) {
    this.baseLayout = structuredClone(layout);
    const saved = loadCustomLayout(layout.id);
    this.activeLayout = saved && Array.isArray(saved.controls)
      ? saved
      : structuredClone(this.baseLayout);
    this._renderStage();
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
      } else if (ctrl.type === 'text_input') {
        this._buildTextInput(wrap, ctrl);
      } else if (ctrl.type === 'draw_pad') {
        this._buildDrawPad(wrap, ctrl);
      }

      if (this.editMode) {
        const delBtn = document.createElement('button');
        delBtn.className = 'del-handle';
        delBtn.type = 'button';
        delBtn.textContent = '×';
        delBtn.onclick = (ev) => {
          ev.stopPropagation();
          this._removeControl(ctrl.id);
        };
        wrap.appendChild(delBtn);

        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        this._attachEditResize(handle, wrap, ctrl);
        wrap.appendChild(handle);
      }

      stage.appendChild(wrap);
    }
  }

  _buildJoystick(wrap, ctrl) {
    const base = document.createElement('div');
    base.className = 'joy-base';
    const tag = document.createElement('span');
    tag.className = 'joy-tag';
    tag.textContent = ctrl.label || (ctrl.stick === 'right' ? 'R' : 'L');
    const knob = document.createElement('div');
    knob.className = 'joy-knob';
    base.appendChild(tag);
    base.appendChild(knob);
    wrap.appendChild(base);

    if (this.editMode) return;

    let activePtr = null;
    const update = (ev) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = Math.max(12, rect.width * 0.42);
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


  _buildDrawPad(wrap) {
    const container = document.createElement('div');
    container.className = 'draw-wrap';

    const tools = document.createElement('div');
    tools.className = 'draw-tools';

    const colors = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#a855f7', '#0f172a'];
    let activeColor = '#ffffff';
    let activeWidth = 5;
    let strokeSeq = 1;
    const strokes = []; // { id, color, width, pts: [{x,y}] }

    const swatches = colors.map((col, idx) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'draw-swatch' + (idx === 0 ? ' active' : '');
      sw.style.background = col;
      sw.title = col === '#0f172a' ? '橡皮擦' : col;
      sw.onclick = () => {
        activeColor = col;
        swatches.forEach((b) => b.classList.remove('active'));
        sw.classList.add('active');
      };
      tools.appendChild(sw);
      return sw;
    });

    const sizeBtn = document.createElement('button');
    sizeBtn.type = 'button';
    sizeBtn.className = 'btn sm';
    sizeBtn.textContent = '笔粗: 中';
    const sizes = [
      { label: '笔粗: 细', w: 2 },
      { label: '笔粗: 中', w: 5 },
      { label: '笔粗: 粗', w: 12 },
    ];
    let sizeIdx = 1;
    sizeBtn.onclick = () => {
      sizeIdx = (sizeIdx + 1) % sizes.length;
      activeWidth = sizes[sizeIdx].w;
      sizeBtn.textContent = sizes[sizeIdx].label;
    };

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'btn sm';
    undoBtn.textContent = '撤销';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn sm ghost';
    clearBtn.textContent = '清空';

    tools.appendChild(sizeBtn);
    tools.appendChild(undoBtn);
    tools.appendChild(clearBtn);

    const canvas = document.createElement('canvas');
    canvas.className = 'draw-canvas';
    container.appendChild(tools);
    container.appendChild(canvas);
    wrap.appendChild(container);

    const ctx = canvas.getContext('2d');
    const redrawAll = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const st of strokes) {
        if (st.pts.length === 0) continue;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.width;
        ctx.beginPath();
        ctx.moveTo(st.pts[0].x * rect.width, st.pts[0].y * rect.height);
        for (let i = 1; i < st.pts.length; i++) {
          ctx.lineTo(st.pts[i].x * rect.width, st.pts[i].y * rect.height);
        }
        ctx.stroke();
      }
    };

    requestAnimationFrame(redrawAll);
    if (this.editMode) return;

    undoBtn.onclick = () => {
      const popped = strokes.pop();
      if (!popped) return;
      redrawAll();
      this.controller.sendDraw({ op: DRAW_OP.UNDO, strokeId: popped.id });
    };

    clearBtn.onclick = () => {
      strokes.length = 0;
      redrawAll();
      this.controller.sendDraw({ op: DRAW_OP.CLEAR });
    };

    let drawingPtr = null;
    let currentStroke = null;
    const normPoint = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0, Math.min(1, (ev.clientY - rect.top) / Math.max(1, rect.height))),
      };
    };

    canvas.onpointerdown = (ev) => {
      ev.preventDefault();
      drawingPtr = ev.pointerId;
      canvas.setPointerCapture(ev.pointerId);
      const pt = normPoint(ev);
      const id = strokeSeq++;
      currentStroke = { id, color: activeColor, width: activeWidth, pts: [pt] };
      strokes.push(currentStroke);
      redrawAll();
      this.controller.sendDraw({ op: DRAW_OP.START, x: pt.x, y: pt.y, color: activeColor, width: activeWidth, strokeId: id });
    };

    canvas.onpointermove = (ev) => {
      if (ev.pointerId !== drawingPtr || !currentStroke) return;
      const pt = normPoint(ev);
      const prev = currentStroke.pts[currentStroke.pts.length - 1];
      if (Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.003) return;
      currentStroke.pts.push(pt);
      redrawAll();
      this.controller.sendDraw({ op: DRAW_OP.MOVE, x: pt.x, y: pt.y, color: currentStroke.color, width: currentStroke.width, strokeId: currentStroke.id });
    };

    canvas.onpointerup = canvas.onpointercancel = (ev) => {
      if (ev.pointerId !== drawingPtr || !currentStroke) return;
      const pt = normPoint(ev);
      this.controller.sendDraw({ op: DRAW_OP.END, x: pt.x, y: pt.y, color: currentStroke.color, width: currentStroke.width, strokeId: currentStroke.id });
      drawingPtr = null;
      currentStroke = null;
    };
  }

  _buildTextInput(wrap, ctrl) {
    const box = document.createElement('div');
    box.className = 'ctrl-text-box';
    const inp = document.createElement('input');
    inp.className = 'ctrl-text-input';
    inp.placeholder = ctrl.placeholder || '输入文本…';
    inp.disabled = this.editMode;
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn primary sm';
    sendBtn.textContent = ctrl.label || '发送';
    sendBtn.disabled = this.editMode;

    if (!this.editMode) {
      const submit = () => {
        const val = inp.value.trim();
        if (!val) return;
        this.controller.sendAction(ctrl.actionId || ctrl.id, val);
        this.controller.imu.vibrate(20);
        inp.value = '';
      };
      sendBtn.onclick = submit;
      inp.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submit();
        }
      };
    }

    box.appendChild(inp);
    box.appendChild(sendBtn);
    wrap.appendChild(box);
  }

  _attachEditDrag(wrap, ctrl) {
    let startX = 0, startY = 0, origX = 0, origY = 0, pid = null;
    wrap.onpointerdown = (ev) => {
      if (ev.target.classList.contains('resize-handle') || ev.target.classList.contains('del-handle')) return;
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
      saveCustomLayout(this.baseLayout.id, this.activeLayout);
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
      ctrl.w = Math.max(8, Math.min(92, origW + ((ev.clientX - startX) / rect.width) * 100));
      ctrl.h = Math.max(12, Math.min(82, origH + ((ev.clientY - startY) / rect.height) * 100));
      wrap.style.width = `${ctrl.w}%`;
      wrap.style.height = `${ctrl.h}%`;
    };
    handle.onpointerup = handle.onpointercancel = (ev) => {
      if (ev.pointerId !== pid) return;
      pid = null;
      saveCustomLayout(this.baseLayout.id, this.activeLayout);
    };
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
