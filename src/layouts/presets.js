/**
 * Data-driven Controller Layout Presets & Full Custom Layout Persistence.
 * Coordinates (x, y, w, h) are normalized percentages [0..100] of the landscape pad stage.
 * Supports dual joysticks (left + right), arbitrary button counts (bits 0..31),
 * D-pad, action choices, and inline text input widgets.
 */

export const LAYOUT_PRESETS = {
  dual_stick_pro: {
    id: 'dual_stick_pro',
    name: '双摇杆 + 多按键手柄',
    imuEnabled: false,
    controls: [
      { id: 'btn_l2', type: 'button', bit: 6, label: 'L2', color: '#475569', x: 4, y: 4, w: 12, h: 16 },
      { id: 'btn_l1', type: 'button', bit: 4, label: 'L1', color: '#334155', x: 18, y: 4, w: 12, h: 16 },
      { id: 'btn_r1', type: 'button', bit: 5, label: 'R1', color: '#334155', x: 70, y: 4, w: 12, h: 16 },
      { id: 'btn_r2', type: 'button', bit: 7, label: 'R2', color: '#475569', x: 84, y: 4, w: 12, h: 16 },

      { id: 'joy_l', type: 'joystick', stick: 'left', label: 'L', x: 4, y: 26, w: 24, h: 66 },
      { id: 'joy_r', type: 'joystick', stick: 'right', label: 'R', x: 48, y: 46, w: 22, h: 50 },

      { id: 'btn_y', type: 'button', bit: 3, label: 'Y', color: '#eab308', x: 79, y: 26, w: 10, h: 22 },
      { id: 'btn_x', type: 'button', bit: 2, label: 'X', color: '#3b82f6', x: 71, y: 46, w: 10, h: 22 },
      { id: 'btn_b', type: 'button', bit: 1, label: 'B', color: '#ef4444', x: 87, y: 46, w: 10, h: 22 },
      { id: 'btn_a', type: 'button', bit: 0, label: 'A', color: '#22c55e', x: 79, y: 66, w: 10, h: 22 },

      { id: 'btn_sel', type: 'button', bit: 8, label: 'SEL', color: '#64748b', x: 34, y: 78, w: 10, h: 15 },
      { id: 'btn_start', type: 'button', bit: 9, label: 'STA', color: '#64748b', x: 34, y: 58, w: 10, h: 15 },
    ],
  },

  action_gamepad: {
    id: 'action_gamepad',
    name: '标准单摇杆 + ABXY 手柄',
    imuEnabled: false,
    controls: [
      { id: 'joy_l', type: 'joystick', stick: 'left', label: 'MOVE', x: 5, y: 22, w: 28, h: 68 },
      { id: 'btn_a', type: 'button', bit: 0, label: 'A', color: '#22c55e', x: 78, y: 58, w: 13, h: 28 },
      { id: 'btn_b', type: 'button', bit: 1, label: 'B', color: '#ef4444', x: 63, y: 62, w: 13, h: 28 },
      { id: 'btn_x', type: 'button', bit: 2, label: 'X', color: '#3b82f6', x: 63, y: 26, w: 13, h: 28 },
      { id: 'btn_y', type: 'button', bit: 3, label: 'Y', color: '#eab308', x: 78, y: 22, w: 13, h: 28 },
      { id: 'btn_start', type: 'button', bit: 9, label: 'START', color: '#64748b', x: 43, y: 74, w: 14, h: 16 },
    ],
  },

  motion_party: {
    id: 'motion_party',
    name: '体感 + 技能按键手柄',
    imuEnabled: true,
    controls: [
      { id: 'dpad', type: 'dpad', label: 'DIR', x: 5, y: 24, w: 26, h: 64 },
      { id: 'btn_skill', type: 'button', bit: 0, label: '挥击 / 确认', color: '#6366f1', x: 58, y: 20, w: 36, h: 34 },
      { id: 'btn_dash', type: 'button', bit: 1, label: '冲刺', color: '#14b8a6', x: 58, y: 60, w: 36, h: 28 },
    ],
  },

  party_quiz: {
    id: 'party_quiz',
    name: '派对抢答 + 文本输入面板',
    imuEnabled: false,
    controls: [
      { id: 'txt_answer', type: 'text_input', actionId: 'text_answer', placeholder: '输入你的答案或发言…', label: '提交', x: 5, y: 6, w: 90, h: 22 },
      { id: 'opt_a', type: 'action_btn', actionId: 'choice', value: 'A', label: 'A 选项', color: '#ef4444', x: 5, y: 34, w: 43, h: 28 },
      { id: 'opt_b', type: 'action_btn', actionId: 'choice', value: 'B', label: 'B 选项', color: '#3b82f6', x: 52, y: 34, w: 43, h: 28 },
      { id: 'opt_c', type: 'action_btn', actionId: 'choice', value: 'C', label: 'C 选项', color: '#eab308', x: 5, y: 66, w: 43, h: 28 },
      { id: 'opt_d', type: 'action_btn', actionId: 'choice', value: 'D', label: 'D 选项', color: '#22c55e', x: 52, y: 66, w: 43, h: 28 },
    ],
  },
};

const STORAGE_PREFIX = 'partypad_custom_layout_';

export function loadCustomLayout(layoutId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + layoutId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCustomLayout(layoutId, layout) {
  try {
    localStorage.setItem(STORAGE_PREFIX + layoutId, JSON.stringify(layout));
  } catch {
    // ignore storage quota errors
  }
}

export function clearCustomLayout(layoutId) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + layoutId);
  } catch {
    // ignore
  }
}

export function mirrorLayoutHorizontally(layout) {
  const cloned = structuredClone(layout);
  cloned.controls = cloned.controls.map((c) => ({
    ...c,
    x: clampPct(100 - c.x - c.w, 0, 95),
  }));
  return cloned;
}

function clampPct(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || min));
}
