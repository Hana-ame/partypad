import { normalizeRoomCode, TRANSPORT_MODE } from './core/constants.js';
import { PartyController } from './sdk/PartyController.js';
import { ControllerUI } from './ui/controllerUI.js';
import { HostDashboardUI } from './ui/hostUI.js';

const $ = (sel) => document.querySelector(sel);

const views = {
  home: $('#view-home'),
  host: $('#view-host'),
  join: $('#view-join'),
  pad: $('#view-pad'),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

const hostUI = new HostDashboardUI({
  qr: $('#host-qr'),
  code: $('#host-code'),
  status: $('#host-status'),
  transportSelect: $('#host-transport'),
  newRoomBtn: $('#host-new-room'),
  layoutBtns: [...document.querySelectorAll('.layout-btn')],
  pmTarget: $('#pm-target'),
  pmTitle: $('#pm-title'),
  pmBody: $('#pm-body'),
  pmSecret: $('#pm-secret'),
  pmSendBtn: $('#pm-send'),
  playersEl: $('#host-players'),
  logEl: $('#host-log'),
});

let controller = null;
let controllerUI = null;

async function connectAsPhone(roomCode, name, transport) {
  const errEl = $('#join-error');
  errEl.textContent = '正在通过 PeerJS 直连 Host…';
  try {
    controller?.disconnect();
    controller = new PartyController({ name, transport });
    controller.on('ping', (ms) => {
      $('#pad-ping').textContent = `${ms} ms`;
    });
    controller.on('disconnect', () => {
      $('#pad-ping').textContent = '已断开';
    });

    const { roomCode: normalized } = await controller.connect(roomCode, { name, transport });
    $('#pad-room-badge').textContent = normalized;
    controllerUI = new ControllerUI(controller, {
      stageEl: $('#pad-stage'),
      privateEl: $('#pad-private-box'),
      imuToggleBtn: $('#pad-imu-toggle'),
      imuCalibBtn: $('#pad-imu-calib'),
      editBtn: $('#pad-edit-toggle'),
      mirrorBtn: $('#pad-mirror'),
      resetBtn: $('#pad-reset-layout'),
    });
    errEl.textContent = '';
    showView('pad');
  } catch (err) {
    errEl.textContent = `连接失败：${err.message || err}`;
  }
}

$('#btn-go-host').onclick = () => {
  showView('host');
  hostUI.startRoom();
};

$('#btn-go-pad').onclick = () => showView('join');

$('#host-back').onclick = () => {
  hostUI.destroy();
  showView('home');
};

$('#join-back').onclick = () => showView('home');

$('#join-submit').onclick = () => {
  const code = normalizeRoomCode($('#join-code').value);
  const name = $('#join-name').value.trim();
  const transport = $('#join-transport').value;
  if (code.length < 5) {
    $('#join-error').textContent = '请输入完整的 5 位房间码';
    return;
  }
  connectAsPhone(code, name, transport);
};

$('#pad-leave').onclick = () => {
  controller?.disconnect();
  controller = null;
  showView('join');
};

// Auto-handle QR scan links: #/pad?room=ABCDE&transport=kcp
function handleHashRoute() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#/pad')) {
    const qIdx = hash.indexOf('?');
    const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
    const room = normalizeRoomCode(params.get('room'));
    const transport = params.get('transport') === TRANSPORT_MODE.KCP
      ? TRANSPORT_MODE.KCP
      : TRANSPORT_MODE.DUAL_DC;

    $('#join-code').value = room;
    $('#join-transport').value = transport;
    showView('join');
    if (room.length === 5) {
      connectAsPhone(room, '', transport);
    }
  }
}

handleHashRoute();
window.addEventListener('hashchange', handleHashRoute);
