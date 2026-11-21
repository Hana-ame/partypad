import { normalizeRoomCode, TRANSPORT_MODE } from './core/constants.js';
import { PartyController } from './sdk/PartyController.js';
import { ControllerUI } from './ui/controllerUI.js';

const $ = (sel) => document.querySelector(sel);

const views = {
  join: $('#view-join'),
  pad: $('#view-pad'),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

/**
 * Request fullscreen + lock landscape orientation immediately on user gesture.
 */
async function enterFullscreenLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    }
  } catch {
    // Some mobile browsers (e.g. iOS Safari) disallow Fullscreen API
  }
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Fallback CSS portrait hint handles browsers without orientation.lock
  }
}

let controller = null;
let controllerUI = null;

async function connectAsPhone(roomCode, name, transport, fromUserGesture = false) {
  const errEl = $('#join-error');
  if (fromUserGesture) {
    enterFullscreenLandscape();
  }
  errEl.textContent = '正在通过 PeerJS 直连 Host…';

  try {
    controller?.disconnect();
    controller = new PartyController({ name, transport });
    controller.on('ping', (ms) => {
      $('#pad-ping').textContent = `${ms} ms`;
    });
    controller.on('transportChange', (mode) => syncKcpUI(mode));
    syncKcpUI(transport);
    controller.on('disconnect', () => {
      $('#pad-ping').textContent = '已断开';
    });

    const { roomCode: normalized } = await controller.connect(roomCode, { name, transport });
    $('#pad-room-badge').textContent = normalized;
    controllerUI = new ControllerUI(controller, {
      stageEl: $('#pad-stage'),
      privateEl: $('#pad-private-box'),
      editBar: $('#pad-edit-bar'),
      imuToggleBtn: $('#pad-imu-toggle'),
      imuCalibBtn: $('#pad-imu-calib'),
      editBtn: $('#pad-edit-toggle'),
      addJoyLBtn: $('#add-joy-l'),
      addJoyRBtn: $('#add-joy-r'),
      addBtnBtn: $('#add-btn'),
      addDpadBtn: $('#add-dpad'),
      addTextBtn: $('#add-text'),
      addDrawBtn: $('#add-draw'),
      mirrorBtn: $('#pad-mirror'),
      resetBtn: $('#pad-reset-layout'),
      textToggleBtn: $('#pad-text-toggle'),
      textDrawer: $('#pad-text-drawer'),
      textInput: $('#pad-text-input'),
      textSendBtn: $('#pad-text-send'),
      textCloseBtn: $('#pad-text-close'),
    });

    errEl.textContent = '';
    showView('pad');
  } catch (err) {
    errEl.textContent = `连接失败：${err.message || err}`;
  }
}

$('#join-submit').onclick = () => {
  const code = normalizeRoomCode($('#join-code').value);
  const name = $('#join-name').value.trim();
  const transport = localStorage.getItem('partypad_kcp_pref') === '1' ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
  if (code.length < 4) {
    $('#join-error').textContent = '请输入房间码（默认 6 位）';
    return;
  }
  connectAsPhone(code, name, transport, true);
};

$('#pad-fs-btn').onclick = () => enterFullscreenLandscape();

const settingsDrawer = $('#pad-settings-drawer');
const kcpSwitch = $('#pad-kcp-switch');
const kcpStatus = $('#pad-kcp-status');
const syncKcpUI = (mode) => {
  const isKcp = mode === TRANSPORT_MODE.KCP;
  kcpSwitch.checked = isKcp;
  kcpStatus.textContent = isKcp ? '当前：KCP over Unreliable DC（已热启用）' : '当前：Dual-Channel WebRTC';
};

$('#pad-settings-btn').onclick = () => {
  const hidden = settingsDrawer.classList.toggle('hidden');
  $('#pad-settings-btn').classList.toggle('active', !hidden);
  if (controller) syncKcpUI(controller.transportMode);
};
$('#pad-settings-close').onclick = () => {
  settingsDrawer.classList.add('hidden');
  $('#pad-settings-btn').classList.remove('active');
};
kcpSwitch.onchange = () => {
  if (!controller) return;
  const next = kcpSwitch.checked ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;
  try { localStorage.setItem('partypad_kcp_pref', kcpSwitch.checked ? '1' : '0'); } catch {}
  controller.setTransportMode(next);
  syncKcpUI(next);
};

$('#rotate-dismiss').onclick = () => {
  $('#rotate-hint').classList.add('dismissed');
};

$('#pad-leave').onclick = () => {
  controller?.disconnect();
  controller = null;
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    screen.orientation?.unlock?.();
  } catch { /* noop */ }
  showView('join');
};

// Auto-handle QR scan links: #/pad?room=ABCDE&transport=kcp
function handleHashRoute() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#/pad')) {
    const qIdx = hash.indexOf('?');
    const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
    const room = normalizeRoomCode(params.get('room'));
    const transport = localStorage.getItem('partypad_kcp_pref') === '1' ? TRANSPORT_MODE.KCP : TRANSPORT_MODE.DUAL_DC;

    $('#join-code').value = room;
    if (room.length >= 4) {
      connectAsPhone(room, '', transport, false);
    }
  }
}

handleHashRoute();
window.addEventListener('hashchange', handleHashRoute);
