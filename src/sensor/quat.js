const DEG = Math.PI / 180;

/**
 * Convert W3C DeviceOrientation Euler angles (alpha, beta, gamma in degrees, Z-X'-Y'' intrinsic)
 * to a unit quaternion { x, y, z, w }.
 */
export function quatFromDeviceEuler(alpha = 0, beta = 0, gamma = 0) {
  const _z = (alpha || 0) * DEG * 0.5;
  const _x = (beta || 0) * DEG * 0.5;
  const _y = (gamma || 0) * DEG * 0.5;

  const cz = Math.cos(_z), sz = Math.sin(_z);
  const cx = Math.cos(_x), sx = Math.sin(_x);
  const cy = Math.cos(_y), sy = Math.sin(_y);

  return normalizeQuat({
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  });
}

export function normalizeQuat(q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatConjugate(q) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatMultiply(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/**
 * Relative quaternion from reference orientation refQ to current orientation q:
 * rel = inv(refQ) * q
 */
export function quatRelative(refQ, q) {
  return normalizeQuat(quatMultiply(quatConjugate(refQ), q));
}

export function rotateVecByQuat(q, v) {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = quatMultiply(quatMultiply(q, qv), quatConjugate(q));
  return { x: r.x, y: r.y, z: r.z };
}
