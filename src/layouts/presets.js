/**
 * Data-driven Controller Layout Presets & Player Customization Persistence.
 * Coordinates (x, y, w, h) are normalized percentages [0..100] of the controller pad stage,
 * so layouts adapt cleanly across different phone screen sizes and orientations.
 */

export const LAYOUT_PRESETS = {
  action_gamepad: {
    id: 'action_gamepad',
    name: '标准双区动作手柄',
    imuEnabled: false,
    controls: [
      { id: 'joy_l', type: 'joystick', stick: 'left', label: 'MOVE', x: 6, y: 26, w: 34, h: 62 },
      { id: 'btn_a', type: 'button', bit: 0, label: 'A', color: '#22c55e', x: 76, y: 56, w: 16, h: 28 },
      { id: 'btn_b', type: 'button', bit: 1, label: 'B', color: '#ef4444', x: 58, y: 62, w: 16, h: 28 },
      { id: 'btn_x', type: 'button', bit: 2, label: 'X', color: '#3b82f6', x: 58, y: 28, w: 16, h: 28 },
      { id: 'btn_y', type: 'button', bit: 3, label: 'Y', color: '#eab308', x: 76, y: 22, w: 16, h: 28 },
      { id: 'btn_start', type: 'button', bit: 9, label: 'START', color: '#64748b', x: 43, y: 74, w: 13, h: 16 },
    ],
  },

  motion_party: {
    id: 'motion_party',
    name: '体感 + 技能按键手柄',
    imuEnabled: true,
    controls: [
      { id: 'dpad', type: 'dpad', label: 'DIR', x: 6, y: 30, w: 32, h: 58 },
      { id: 'btn_skill', type: 'button', bit: 0, label: '挥击 / 确认', color: '#6366f1', x: 56, y: 28, w: 36, h: 32 },
      { id: 'btn_dash', type: 'button', bit: 1, label: '冲刺', color: '#14b8a6', x: 56, y: 65, w: 36, h: 24 },
    ],
  },

  party_quiz: {
    id: 'party_quiz',
    name: '派对抢答 / 投票面板',
    imuEnabled: false,
    controls: [
      { id: 'opt_a', type: 'action_btn', actionId: 'choice', value: 'A', label: 'A 选项', color: '#ef4444', x: 6, y: 18, w: 42, h: 34 },
      { id: 'opt_b', type: 'action_btn', actionId: 'choice', value: 'B', label: 'B 选项', color: '#3b82f6', x: 52, y: 18, w: 42, h: 34 },
      { id: 'opt_c', type: 'action_btn', actionId: 'choice', value: 'C', label: 'C 选项', color: '#eab308', x: 6, y: 58, w: 42, h: 34 },
      { id: 'opt_d', type: 'action_btn', actionId: 'choice', value: 'D', label: 'D 选项', color: '#22c55e', x: 52, y: 58, w: 42, h: 34 },
    ],
  },
};

const STORAGE_PREFIX = 'partypad_layout_override_';

export function loadLayoutOverrides(layoutId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + layoutId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLayoutOverrides(layoutId, overrides) {
  try {
    localStorage.setItem(STORAGE_PREFIX + layoutId, JSON.stringify(overrides));
  } catch {
    // ignore storage quota errors
  }
}

export function clearLayoutOverrides(layoutId) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + layoutId);
  } catch {
    // ignore
  }
}

export function applyLayoutOverrides(layout, overrides) {
  if (!overrides) return structuredClone(layout);
  const cloned = structuredClone(layout);
  cloned.controls = cloned.controls.map((ctrl) => {
    const ov = overrides[ctrl.id];
    if (!ov) return ctrl;
    return {
      ...ctrl,
      x: clampPct(ov.x, 0, 92),
      y: clampPct(ov.y, 0, 88),
      w: clampPct(ov.w, 8, 60),
      h: clampPct(ov.h, 10, 75),
    };
  });
  return cloned;
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
