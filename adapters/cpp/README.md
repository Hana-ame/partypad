# PartyPad C++ 适配模板（`libdatachannel` / WebSocket + ViGEmClient）

`main.cpp` 提供零依赖 C++17 版本的 PartyPad 二进制帧解包器（16B 手柄输入、28B 体感 IMU、14B 实时绘板），可直接接入：
- **直连模式（几 MB 体积，不含 FFmpeg）**：配合 [libdatachannel](https://github.com/paullouisageneau/libdatachannel) 在 `dc->onMessage(...)` 中调用 `partypad::decodeInput` / `decodeMotion` / `decodeDraw`（去掉 1 字节 `WIRE_RAW`/`WIRE_KCP` 帧头即可）。
- **桥接模式**：配合 `IXWebSocket` / `Boost.Beast` 监听 `ws://127.0.0.1:8765/partypad`，把 JSON 事件喂给 Windows `ViGEmClient` 或 Unreal/自研 C++ 引擎。

## 编译运行内置解包自检

```bash
cmake -B build && cmake --build build
./build/partypad_cpp_demo
```
