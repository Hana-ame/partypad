import unittest
from vgamepad_bridge import VirtualXboxManager


class TestVirtualXboxBridge(unittest.TestCase):
    def test_multiplayer_mapping_and_cleanup(self):
        mgr = VirtualXboxManager(dry_run=True)

        # Two players join
        mgr.handle_event({"type": "player_join", "playerId": "p1", "name": "Alice"})
        mgr.handle_event({"type": "player_join", "playerId": "p2", "name": "Bob"})
        self.assertEqual(len(mgr.pads), 2)

        # Player 1 presses A (bit 0) + L2 (bit 6) + pushes left stick right-up (screen ly=-0.8 -> Xbox ly=+0.8)
        mgr.handle_event({
            "type": "input",
            "playerId": "p1",
            "buttons": (1 << 0) | (1 << 6) | (1 << 9),
            "lx": 0.75,
            "ly": -0.8,
            "rx": -0.5,
            "ry": 0.25,
        })

        pad1 = mgr.pads["p1"]
        self.assertIn("XUSB_GAMEPAD_A", pad1.pressed)
        self.assertIn("XUSB_GAMEPAD_START", pad1.pressed)
        self.assertNotIn("XUSB_GAMEPAD_B", pad1.pressed)
        self.assertEqual(pad1.lt, 1.0)
        self.assertEqual(pad1.rt, 0.0)
        self.assertAlmostEqual(pad1.lx, 0.75)
        self.assertAlmostEqual(pad1.ly, 0.8)   # Y inverted for Xbox
        self.assertAlmostEqual(pad1.rx, -0.5)
        self.assertAlmostEqual(pad1.ry, -0.25) # Y inverted for Xbox
        self.assertEqual(pad1.updates, 1)

        # Player 2 remains unaffected
        self.assertEqual(mgr.pads["p2"].updates, 0)

        # Player 1 disconnects -> virtual pad removed cleanly
        mgr.handle_event({"type": "player_leave", "playerId": "p1"})
        self.assertNotIn("p1", mgr.pads)
        self.assertIn("p2", mgr.pads)


if __name__ == "__main__":
    unittest.main()
