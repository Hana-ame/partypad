#!/usr/bin/env python3
"""
PartyPad -> Windows Xbox 360 Virtual Gamepad Bridge (Python + ViGEmBus)

Turns connected smartphones (via PartyPad Host Dashboard WebSocket bridge)
into real Windows Xbox 360 controllers recognized by Steam / PC games
(Overcooked, It Takes Two, Human Fall Flat, Gang Beasts, emulators, etc.).

Usage (Windows 10/11):
    pip install -r requirements.txt
    python vgamepad_bridge.py --port 8765

Dry-run test mode (Linux/macOS/Windows without ViGEmBus):
    python vgamepad_bridge.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logging.basicConfig(
    level=logging.INFO,
    format="[PartyPad-Py] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("partypad-bridge")


# Bitmask indices matching PartyPad's dual_stick_pro & W3C standard mapping
BUTTON_BIT_MAP = {
    0: "XUSB_GAMEPAD_A",
    1: "XUSB_GAMEPAD_B",
    2: "XUSB_GAMEPAD_X",
    3: "XUSB_GAMEPAD_Y",
    4: "XUSB_GAMEPAD_LEFT_SHOULDER",   # L1
    5: "XUSB_GAMEPAD_RIGHT_SHOULDER",  # R1
    # 6 -> Left Trigger (L2, analog)
    # 7 -> Right Trigger (R2, analog)
    8: "XUSB_GAMEPAD_BACK",            # SELECT
    9: "XUSB_GAMEPAD_START",           # START
    10: "XUSB_GAMEPAD_LEFT_THUMB",     # L3
    11: "XUSB_GAMEPAD_RIGHT_THUMB",    # R3
    12: "XUSB_GAMEPAD_DPAD_UP",
    13: "XUSB_GAMEPAD_DPAD_DOWN",
    14: "XUSB_GAMEPAD_DPAD_LEFT",
    15: "XUSB_GAMEPAD_DPAD_RIGHT",
}


class MockXboxPad:
    """In-memory mock gamepad used in --dry-run mode and unit tests."""

    def __init__(self, player_id: str):
        self.player_id = player_id
        self.pressed: set[str] = set()
        self.lx = 0.0
        self.ly = 0.0
        self.rx = 0.0
        self.ry = 0.0
        self.lt = 0.0
        self.rt = 0.0
        self.updates = 0

    def press_button(self, button: Any) -> None:
        self.pressed.add(str(button))

    def release_button(self, button: Any) -> None:
        self.pressed.discard(str(button))

    def left_joystick_float(self, x_value_float: float, y_value_float: float) -> None:
        self.lx = x_value_float
        self.ly = y_value_float

    def right_joystick_float(self, x_value_float: float, y_value_float: float) -> None:
        self.rx = x_value_float
        self.ry = y_value_float

    def left_trigger_float(self, value_float: float) -> None:
        self.lt = value_float

    def right_trigger_float(self, value_float: float) -> None:
        self.rt = value_float

    def update(self) -> None:
        self.updates += 1

    def reset(self) -> None:
        self.pressed.clear()
        self.lx = self.ly = self.rx = self.ry = self.lt = self.rt = 0.0


@dataclass
class VirtualXboxManager:
    """Manages one virtual Xbox 360 controller per connected PartyPad player."""

    dry_run: bool = False
    on_rumble: Optional[Callable[[str, int], None]] = None
    pads: Dict[str, Any] = field(default_factory=dict)
    _vg: Any = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if not self.dry_run:
            try:
                import vgamepad as vg  # type: ignore

                self._vg = vg
            except Exception as exc:
                log.warning(
                    "Could not load vgamepad/ViGEmBus (%s); falling back to --dry-run mode.",
                    exc,
                )
                self.dry_run = True

    def ensure_player(self, player_id: str, name: str = "") -> Any:
        if player_id in self.pads:
            return self.pads[player_id]

        if self.dry_run:
            pad = MockXboxPad(player_id)
        else:
            pad = self._vg.VX360Gamepad()
            if self.on_rumble is not None:
                # Forward PC game force-feedback rumble back to the player's phone
                def _rumble_cb(_client, _target, large_motor, small_motor, _led, _user):
                    intensity = max(int(large_motor), int(small_motor))
                    if intensity > 20 and self.on_rumble:
                        duration_ms = max(25, min(200, int(intensity * 0.7)))
                        self.on_rumble(player_id, duration_ms)

                pad.register_notification(callback_function=_rumble_cb)

        self.pads[player_id] = pad
        log.info("Attached virtual Xbox 360 controller for %s (%s)", name or player_id, player_id)
        return pad

    def remove_player(self, player_id: str) -> None:
        pad = self.pads.pop(player_id, None)
        if pad is None:
            return
        try:
            pad.reset()
            pad.update()
        except Exception:
            pass
        log.info("Detached virtual Xbox 360 controller for %s", player_id)

    def apply_input(self, ev: Dict[str, Any]) -> None:
        player_id = str(ev.get("playerId") or "")
        if not player_id:
            return
        pad = self.ensure_player(player_id)

        buttons = int(ev.get("buttons", 0))
        for bit, btn_name in BUTTON_BIT_MAP.items():
            pressed = ((buttons >> bit) & 1) == 1
            btn_code = btn_name if self.dry_run else getattr(self._vg.XUSB_BUTTON, btn_name)
            if pressed:
                pad.press_button(button=btn_code)
            else:
                pad.release_button(button=btn_code)

        # Analog triggers L2 (bit 6) and R2 (bit 7)
        pad.left_trigger_float(1.0 if ((buttons >> 6) & 1) else 0.0)
        pad.right_trigger_float(1.0 if ((buttons >> 7) & 1) else 0.0)

        # Analog sticks: screen Y is down (+1), Xbox 360 Y is up (+1) -> invert Y
        lx = _clamp(float(ev.get("lx", 0.0)))
        ly = _clamp(-float(ev.get("ly", 0.0)))
        rx = _clamp(float(ev.get("rx", 0.0)))
        ry = _clamp(-float(ev.get("ry", 0.0)))
        pad.left_joystick_float(x_value_float=lx, y_value_float=ly)
        pad.right_joystick_float(x_value_float=rx, y_value_float=ry)
        pad.update()

    def handle_event(self, ev: Dict[str, Any]) -> None:
        etype = ev.get("type")
        player_id = str(ev.get("playerId") or "")
        if etype in ("player_join", "player_reconnect") and player_id:
            self.ensure_player(player_id, str(ev.get("name") or ""))
        elif etype == "player_leave" and player_id:
            self.remove_player(player_id)
        elif etype == "input":
            self.apply_input(ev)
        elif etype == "motion" and float(ev.get("hit", 0.0)) > 0:
            log.debug("Motion swing from %s peak=%.2f", player_id, float(ev["hit"]))


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, v))


async def run_server(host: str, port: int, dry_run: bool) -> None:
    import websockets  # type: ignore

    active_sockets: set[Any] = set()
    loop = asyncio.get_running_loop()

    def relay_rumble(player_id: str, duration_ms: int) -> None:
        cmd = json.dumps({"cmd": "vibrate", "playerId": player_id, "pattern": [duration_ms]})
        for ws in list(active_sockets):
            asyncio.run_coroutine_threadsafe(ws.send(cmd), loop)

    manager = VirtualXboxManager(dry_run=dry_run, on_rumble=relay_rumble)

    async def ws_handler(websocket: Any) -> None:
        active_sockets.add(websocket)
        log.info("PartyPad Host connected from %s", websocket.remote_address)
        try:
            async for raw in websocket:
                try:
                    ev = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                manager.handle_event(ev)
        finally:
            active_sockets.discard(websocket)
            for pid in list(manager.pads.keys()):
                manager.remove_player(pid)
            log.info("PartyPad Host disconnected; cleaned up virtual controllers")

    log.info(
        "Listening on ws://%s:%d/partypad (mode=%s)",
        host,
        port,
        "DRY-RUN" if manager.dry_run else "ViGEmBus Xbox360",
    )
    async with websockets.serve(ws_handler, host, port):
        await asyncio.Future()  # run forever


def main() -> None:
    parser = argparse.ArgumentParser(description="PartyPad -> Xbox 360 Virtual Gamepad Bridge")
    parser.add_argument("--host", default="127.0.0.1", help="WebSocket bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket bind port (default: 8765)")
    parser.add_argument("--dry-run", action="store_true", help="Run without ViGEmBus driver for testing")
    args = parser.parse_args()

    try:
        asyncio.run(run_server(args.host, args.port, args.dry_run))
    except KeyboardInterrupt:
        log.info("Bridge stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
