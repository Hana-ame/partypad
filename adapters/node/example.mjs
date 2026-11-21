import { WebSocketServer } from 'ws';
import { PartyPadNodeServer } from './PartyPadServer.mjs';

const PORT = Number(process.env.PORT || 8765);
const wss = new WebSocketServer({ port: PORT, path: '/partypad' });
const server = new PartyPadNodeServer().attachWebSocketServer(wss);

server.on('playerJoin', ({ playerId, name, slot }) => {
  console.log(`[NodeServer] 玩家加入: ${name} (${playerId}, Slot #${slot})`);
  server.sendPrivate(playerId, {
    title: '本局机密任务',
    body: `你是 #${slot + 1} 号玩家，请勿向他人展示本卡片。`,
    secret: true,
  });
});

server.on('input', ({ playerId, lx, ly, buttons }) => {
  if (buttons !== 0) {
    console.log(`[NodeServer] 输入 ${playerId}: buttons=0x${buttons.toString(16)} (${lx.toFixed(2)}, ${ly.toFixed(2)})`);
  }
});

server.on('motion', ({ playerId, hit }) => {
  if (hit > 0) {
    console.log(`[NodeServer] 挥动触发 ${playerId}: peak=${hit.toFixed(2)} rad/s`);
    server.vibrate(playerId, [35]);
  }
});

server.on('action', ({ playerId, id, value }) => {
  console.log(`[NodeServer] 动作 ${playerId}: ${id}=${JSON.stringify(value)}`);
});

console.log(`PartyPad Node bridge listening on ws://localhost:${PORT}/partypad`);
