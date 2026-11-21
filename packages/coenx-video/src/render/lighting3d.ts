import type { Light3D, Mesh3DNode, Vec3 } from "../model/types"
import { add3, clamp, dot3, normalize3, scale3, sub3 } from "./math3d"

interface Rgb {
  r: number
  g: number
  b: number
}

function parseColor(value: string): Rgb {
  const match = /^#?([\da-f]{6})$/i.exec(value)
  if (!match) return { r: 0.42, g: 0.62, b: 0.91 }
  const number = Number.parseInt(match[1], 16)
  return {
    r: ((number >> 16) & 255) / 255,
    g: ((number >> 8) & 255) / 255,
    b: (number & 255) / 255,
  }
}

function toHex(color: Rgb) {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

function multiply(a: Rgb, b: Rgb, amount: number): Rgb {
  return { r: a.r * b.r * amount, g: a.g * b.g * amount, b: a.b * b.b * amount }
}

function addColor(a: Rgb, b: Rgb): Rgb {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b }
}

export function shadeMeshColor(
  node: Mesh3DNode,
  point: Vec3,
  normalInput: Vec3,
  cameraPosition: Vec3,
  lights: Light3D[] = [],
) {
  const material = node.material ?? {}
  const base = parseColor(node.color ?? "#6b9ee8")
  const normal = normalize3(normalInput)
  const view = normalize3(sub3(cameraPosition, point))
  const ambientStrength = clamp(material.ambient ?? 0.22, 0, 2)
  const white = { r: 1, g: 1, b: 1 }
  const diffuseStrength = clamp(material.diffuse ?? 0.85, 0, 2)
  const specularStrength = clamp(material.specular ?? 0.22, 0, 2)
  const shininess = clamp(material.shininess ?? 28, 1, 256)
  const metalness = clamp(material.metalness ?? 0, 0, 1)
  let result: Rgb = multiply(base, white, ambientStrength)

  const activeLights =
    lights.length > 0
      ? lights
      : [
          { type: "ambient" as const, intensity: 0.8 },
          { type: "directional" as const, direction: node.lightDirection ?? [-0.4, 0.7, 0.6], intensity: 0.9 },
        ]

  for (const light of activeLights) {
    const intensity = clamp(light.intensity ?? 1, 0, 8)
    const tint = parseColor(light.color ?? "#ffffff")
    if (light.type === "ambient") {
      result = addColor(result, multiply(base, tint, ambientStrength * intensity))
      continue
    }

    let direction: Vec3
    let attenuation = 1
    if (light.type === "point" && light.position) {
      const delta = sub3(light.position, point)
      const distance = Math.max(0.001, Math.hypot(...delta))
      direction = scale3(delta, 1 / distance)
      if (light.distance && distance > light.distance) continue
      attenuation = 1 / (1 + 0.08 * distance + 0.018 * distance * distance)
    } else {
      direction = normalize3(light.direction ?? node.lightDirection ?? [-0.4, 0.7, 0.6])
    }

    const facing = dot3(normal, direction)
    const diffuse =
      (material.doubleSided ? Math.abs(facing) : Math.max(0, facing)) * diffuseStrength * intensity * attenuation
    result = addColor(result, multiply(base, tint, diffuse * (1 - metalness)))
    if (diffuse <= 0) continue

    const halfway = normalize3(add3(direction, view))
    const specular =
      Math.pow(Math.max(0, dot3(normal, halfway)), shininess) * specularStrength * intensity * attenuation
    const specularColor = metalness > 0 ? base : white
    const specularMix = specular * (0.08 + metalness * 0.92)
    result = addColor(result, multiply(multiply(specularColor, tint, 1), white, specularMix))
  }

  if (material.emissive) result = addColor(result, multiply(parseColor(material.emissive), white, 0.35))
  return toHex(result)
}
