# PartyPad → Windows 虚拟 Xbox 360 手柄桥接（Python + ViGEmBus）

通过本桥接脚本，可以把连入 PartyPad 的多台手机直接模拟为 **Windows 系统级 Xbox 360 实体手柄**，从而直接游玩 Steam / Epic / 本地 PC 游戏（如《胡闹厨房》《人类一败涂地》《双人成行》《拳皇》《任天堂模拟器》等）。

## 启动步骤（Windows 10 / 11）

```bash
cd adapters/python
pip install -r requirements.txt
python vgamepad_bridge.py --port 8765
```

> `vgamepad` 在 Windows 上安装时会自动附带 ViGEmBus 虚拟手柄驱动（如遇权限提示，请允许驱动安装）。

1. 启动 PartyPad 前端：`npm run dev`
2. 电脑浏览器打开测试大屏 `/host-demo.html`
3. 在左侧「桥接外部服务端」填入 `ws://localhost:8765/partypad` 并点击连接
4. 手机扫码进入 `dual_stick_pro`（双摇杆 + 10 键）布局，打开任意支持手柄的 PC 游戏即可开玩！

## 特性
- **多手柄独立映射**：每台连入的手机自动分配一个独立的虚拟 Xbox 360 手柄，断开连接自动拔出释放。
- **完整按键与双摇杆**：映射 A/B/X/Y、LB/RB、LT/RT 扳机、Start/Back、L3/R3、十字键与左右模拟摇杆（自动翻转 Y 轴以匹配 Xbox 坐标系）。
- **游戏震动回传手机**：当 PC 游戏触发 Xbox 手柄震动时，脚本自动通过 `vibrate` 指令把震动反馈回传到对应玩家的手机。
- **无驱动测试模式**：在 macOS / Linux 上可加 `--dry-run` 联调协议。
