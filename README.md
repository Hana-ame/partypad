# PartyPad · PeerJS 派对游戏手机手柄与服务端适配层

一个从零构建的**独立派对游戏手柄项目与 SDK**：
- **纯 PeerJS，无 MQTT**：仅通过 **二维码扫码** 或 **手动输入 5 位无歧义房间码** 直连 Host。
- **可插拔传输层（含可选 KCP 优化）**：
  - 默认 `dual-dc`：PeerJS 主通道传可靠控制帧 + 独立 `ordered: false, maxRetransmits: 0` 不可靠 DataChannel 传 60Hz 触控与体感帧。
  - 可选 `kcp`：内置纯 JS 实现的 **KCP ARQ 协议**（`src/core/kcp.js`，支持 `nodelay=1, interval=10, resend=2, nc=1`、快速重传、1.5x RTO 与分片重组），直接跑在零重传 `RTCDataChannel` 之上，规避原生 WebRTC SCTP 队头阻塞与保守退避。
- **手机端完整手柄体验**：
  - 支持 **摇杆 / D-Pad / 动作键 / 抢答选项** + **W3C 体感 IMU（四元数姿态、角速度、挥动峰值检测、一键校准、震动反馈）**。
  - **布局可修改**：既支持 Host 随游戏阶段动态下发 JSON 布局 Schema，也支持玩家在手机上进入「编辑布局」自由拖拽位置、缩放大小、左右手镜像并自动持久化到 `localStorage`。
  - **私人文本下发**：支持 Host 仅向指定 `playerId` 下发私密信息卡（如狼人杀身份、卧底词），默认「按住查看、松手隐藏」防偷窥，带 `private_ack` 签收与断线重连自动补发。
- **服务端快速适配层**：
  - `GamepadAPIAdapter`：一行代码将所有手机手柄映射为标准 `navigator.getGamepads()`，直接兼容 Phaser / Three.js / Unity WebGL。
  - `ServerBridgeAdapter`：支持进程内回调或 WebSocket 转发，让 Node / Go / Python / Unity / Godot 服务端在 10 行代码内接入。

## 快速启动

```bash
npm install
npm run dev      # 启动开发服务器（--host 暴露局域网供手机扫码）
npm test         # 运行 Node 自动化单元测试（含 KCP 15% 丢包乱序测试）
```

> 提示：iOS Safari 调用陀螺仪/加速度计要求 HTTPS，局域网实测体感建议通过反向代理或 Vite HTTPS 插件提供 TLS。

## 服务端快速接入示例

### 方式 1：进程内接入（Web 游戏 / 自定义 Server）

```js
import { PartyHost, ServerBridgeAdapter, LAYOUT_PRESETS } from './src/index.js';

const host = new PartyHost({ transport: 'kcp' }); // 或默认 'dual-dc'
const { roomCode } = await host.start();

const bridge = new ServerBridgeAdapter(host, {
  onPlayerJoin: ({ playerId, name, slot }) => {
    // 单独给该玩家下发防偷窥身份卡
    bridge.sendPrivate(playerId, {
      title: '本局身份',
      body: '你是卧底，词条：乌龙茶',
      secret: true,
    });
  },
  onInput: ({ playerId, lx, ly, buttons }) => { /* 更新角色移动/按键 */ },
  onMotion: ({ playerId, q, omega, hit }) => { /* 体感挥动判定 */ },
  onAction: ({ playerId, id, value }) => { /* 抢答/投票选项 */ },
});

// 随游戏阶段切换所有人的手柄布局
bridge.broadcastLayout(LAYOUT_PRESETS.party_quiz);
```

### 方式 2：一行接入标准 HTML5 Gamepad API

```js
import { PartyHost, attachGamepadAPIAdapter } from './src/index.js';

const host = new PartyHost();
attachGamepadAPIAdapter(host);
await host.start();
// 之后游戏循环里直接轮询 navigator.getGamepads() 即可
```

### 方式 3：通过 WebSocket 桥接到外部后端（Go / Node / Unity / Godot）

```js
const bridge = new ServerBridgeAdapter(host, {
  wsUrl: 'ws://localhost:8080/partypad',
});
// 外部服务端只需发 JSON 指令即可控制手机端：
// { "cmd": "send_private", "playerId": "p_xxx", "title": "身份", "body": "预言家", "secret": true }
// { "cmd": "broadcast_layout", "layout": { ... } }
// { "cmd": "vibrate", "playerId": "p_xxx", "pattern": [40, 30, 40] }
```
