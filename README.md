# PartyPad · PeerJS 派对游戏手机手柄与多端服务端适配层

一个从零构建的**独立派对游戏手柄项目与 SDK**，覆盖 **纯前端、Node.js、Go、Unity（Desktop + WebGL）** 四种接入方式：
- **纯 PeerJS，无 MQTT**：仅通过 **二维码扫码** 或 **手动输入 5 位无歧义房间码** 直连 Host。
- **可插拔传输层（含可选 KCP 优化）**：
  - 默认 `dual-dc`：PeerJS 主通道传可靠控制帧 + 独立 `ordered: false, maxRetransmits: 0` 不可靠 DataChannel 传 60Hz 触控与体感帧。
  - 可选 `kcp`：内置纯 JS 实现的 **KCP ARQ 协议**（`src/core/kcp.js`，支持 `nodelay=1, interval=10, resend=2, nc=1`、快速重传、1.5x RTO 与分片重组），直接跑在零重传 `RTCDataChannel` 之上，规避原生 WebRTC SCTP 队头阻塞与保守退避。
- **手机端完整手柄体验**：
  - 支持 **摇杆 / D-Pad / 动作键 / 抢答选项** + **W3C 体感 IMU（四元数姿态、角速度、挥动峰值检测、一键校准、震动反馈）**。
  - **布局可修改**：既支持 Host 随游戏阶段动态下发 JSON 布局 Schema，也支持玩家在手机上进入「编辑布局」自由拖拽位置、缩放大小、左右手镜像并自动持久化到 `localStorage`。
  - **私人文本下发**：支持 Host 仅向指定 `playerId` 下发私密信息卡，默认「按住查看、松手隐藏」防偷窥，带 `private_ack` 签收与断线重连自动补发。

## 快速启动

```bash
npm install
npm run dev      # 启动手柄与 Host 控制台（--host 暴露局域网供手机扫码）
npm test         # 运行全部 Node 自动化单元测试（含 KCP 丢包乱序 & 服务端桥接协议测试）
```

> 提示：iOS Safari 调用陀螺仪/加速度计要求 HTTPS，局域网实测体感建议通过反向代理或 Vite HTTPS 插件提供 TLS。

## 四大平台服务端适配层（`adapters/`）

| 目标平台 | 目录路径 | 接入方式与启动命令 |
| :--- | :--- | :--- |
| **纯前端（零后端）** | `adapters/frontend/` | 引入 `FrontendPartyAdapter.js`（可选开启 W3C Gamepad API），或直接访问 `adapters/frontend/example-canvas.html` 体验完整 Canvas 多人演示。 |
| **Node.js 服务端** | `adapters/node/` | `cd adapters/node && npm install && npm start`，监听 `ws://localhost:8765/partypad`，在浏览器 Host 控制台填入地址连接即可。 |
| **Go 服务端** | `adapters/go/` | `cd adapters/go && go mod tidy && go run ./cmd/example`，监听 `ws://localhost:8765/partypad`，使用 `partypad.NewServer(...)` 处理事件并调用 `SendPrivate` / `BroadcastLayout` / `Vibrate`。 |
| **Unity（Desktop & WebGL）** | `adapters/unity/` | 将 `PartyPadTypes.cs`、`PartyPadBridge.cs`、`PartyPadDemo.cs` 放入 `Assets/Scripts/PartyPad/`；WebGL 导出额外放入 `Plugins/WebGL/PartyPadWebGL.jslib`。桌面端内置零第三方依赖的 `HttpListener` WebSocket 服务（默认 `ws://localhost:8765/partypad/`），所有事件自动派发回 Unity 主线程 `Update()`。 |

## WebSocket 桥接统一协议（Node / Go / Unity 共用）

- **Host → 服务端（上行事件 JSON）**：`player_join`、`player_reconnect`、`player_leave`、`input`（`lx, ly, rx, ry, buttons`）、`motion`（`q, omega, hit`）、`action`（`id, value`）、`private_ack`（`msgId`）。
- **服务端 → Host（下行指令 JSON）**：
  - `{ "cmd": "send_private", "playerId": "p_xxx", "title": "身份", "body": "卧底", "secret": true }`
  - `{ "cmd": "clear_private", "playerId": "p_xxx", "msgId": "pm_1" }`
  - `{ "cmd": "broadcast_layout", "layout": { ... } }`
  - `{ "cmd": "set_layout", "playerId": "p_xxx", "layout": { ... } }`
  - `{ "cmd": "vibrate", "playerId": "p_xxx", "pattern": [40, 30, 40] }`
