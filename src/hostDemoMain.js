import { HostDashboardUI } from './ui/hostUI.js';

const $ = (sel) => document.querySelector(sel);

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
  wsUrlInput: $('#ws-bridge-url'),
  wsConnectBtn: $('#ws-bridge-connect'),
});

hostUI.startRoom();
