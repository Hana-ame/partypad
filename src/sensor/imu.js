import { IMU_DEFAULTS } from '../core/constants.js';
import { quatFromDeviceEuler, quatRelative } from './quat.js';

/**
 * Mobile IMU Sensor Controller (DeviceOrientation + DeviceMotion).
 * Handles iOS 13+ permission prompts, one-tap front calibration,
 * angular speed calculation, swing peak detection, and haptic vibration.
 */
export class ImuSensor {
  constructor(opts = {}) {
    this.hz = opts.hz || IMU_DEFAULTS.HZ;
    this.swingPeak = opts.swingPeak || IMU_DEFAULTS.SWING_PEAK;
    this.swingCooldownMs = opts.swingCooldownMs || IMU_DEFAULTS.SWING_COOLDOWN_MS;

    this.running = false;
    this.rawQ = { x: 0, y: 0, z: 0, w: 1 };
    this.refQ = null;
    this.omega = 0;
    this.pendingHit = 0;
    this.lastSwingAt = 0;
    this.timer = null;
    this.onFrame = null;

    this._onOrientation = this._onOrientation.bind(this);
    this._onMotion = this._onMotion.bind(this);
  }

  async requestPermission() {
    const results = [];
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      results.push(await DeviceOrientationEvent.requestPermission());
    }
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      results.push(await DeviceMotionEvent.requestPermission());
    }
    return results.every((r) => r === 'granted');
  }

  async start(onFrame) {
    if (this.running) return true;
    const ok = await this.requestPermission().catch(() => false);
    if (!ok) return false;

    this.onFrame = onFrame;
    this.running = true;
    window.addEventListener('deviceorientation', this._onOrientation);
    window.addEventListener('devicemotion', this._onMotion);

    const intervalMs = Math.max(10, Math.round(1000 / this.hz));
    this.timer = setInterval(() => {
      if (!this.running || !this.onFrame) return;
      const q = this.refQ ? quatRelative(this.refQ, this.rawQ) : this.rawQ;
      const hit = this.pendingHit;
      this.pendingHit = 0;
      this.onFrame({ q, omega: this.omega, hit });
    }, intervalMs);

    return true;
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('deviceorientation', this._onOrientation);
    window.removeEventListener('devicemotion', this._onMotion);
  }

  calibrate() {
    this.refQ = { ...this.rawQ };
  }

  vibrate(pattern = 40) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // ignore unsupported browsers
    }
  }

  _onOrientation(ev) {
    if (ev.alpha == null && ev.beta == null && ev.gamma == null) return;
    this.rawQ = quatFromDeviceEuler(ev.alpha, ev.beta, ev.gamma);
    if (!this.refQ) {
      this.refQ = { ...this.rawQ };
    }
  }

  _onMotion(ev) {
    const r = ev.rotationRate;
    if (!r) return;
    const degToRad = Math.PI / 180;
    const wx = (r.alpha || 0) * degToRad;
    const wy = (r.beta || 0) * degToRad;
    const wz = (r.gamma || 0) * degToRad;
    const mag = Math.hypot(wx, wy, wz);
    this.omega = mag;

    const now = performance.now();
    if (mag >= this.swingPeak && now - this.lastSwingAt >= this.swingCooldownMs) {
      this.lastSwingAt = now;
      this.pendingHit = Math.max(this.pendingHit, mag);
    }
  }
}
