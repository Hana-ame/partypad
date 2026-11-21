# PartyPad Rust 适配层（Tokio WebSocket + 可选 ViGEmBus）

基于 `tokio` + `tokio-tungstenite` 的轻量级 Rust 服务端桥接模板，监听 `ws://127.0.0.1:8765/partypad`，完整解析双摇杆按键、体感 IMU、实时绘板笔画，并演示向指定玩家下发防偷窥私密卡片与震动反馈。

```bash
cd adapters/rust
cargo run
```

如需直接模拟 Windows Xbox 360 手柄，可在 `Cargo.toml` 中取消注释 `vigem-client` 并把 `ev.lx / -ev.ly / ev.buttons` 写入 `Xbox360Wired`。
