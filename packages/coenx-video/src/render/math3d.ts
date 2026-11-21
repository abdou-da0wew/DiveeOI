import type { Vec3 } from "../model/types"

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale3 = (value: Vec3, amount: number): Vec3 => [value[0] * amount, value[1] * amount, value[2] * amount]
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export function normalize3(value: Vec3): Vec3 {
  const length = Math.hypot(...value)
  return length > 1e-9 ? scale3(value, 1 / length) : [0, 0, 0]
}

export function rotateEuler3(point: Vec3, angles: Vec3): Vec3 {
  const [rx, ry, rz] = angles
  const sx = Math.sin(rx),
    cx = Math.cos(rx)
  const sy = Math.sin(ry),
    cy = Math.cos(ry)
  const sz = Math.sin(rz),
    cz = Math.cos(rz)
  const y1 = point[1] * cx - point[2] * sx
  const z1 = point[1] * sx + point[2] * cx
  const x2 = point[0] * cy + z1 * sy
  const z2 = -point[0] * sy + z1 * cy
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2]
}

export function lerp3(a: Vec3, b: Vec3, amount: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
