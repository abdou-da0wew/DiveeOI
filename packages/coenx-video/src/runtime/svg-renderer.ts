import type { Scene, Vec3, VideoComposition, VisualNode } from "../model/types"
import { evaluateSceneAtFrame } from "../animation/timeline"
import { projectMesh3D } from "../render/geometry3d"
import { resolveNodeMask } from "../render/mask"
import { isGradientPaint, whiteAlphaPaint } from "../render/paint"
import { pathCommandsToSvgD, resolveClipPath, resolveNodePath } from "../render/path"
import type { CanvasAssetResolver } from "./canvas-renderer"
import { element, paintValue, SVG_NS, textElement } from "./svg-primitives"

export class SvgVideoRenderer {
  readonly element: SVGSVGElement

  constructor(
    private readonly composition: VideoComposition,
    private readonly resolveAsset?: CanvasAssetResolver,
  ) {
    this.element = element("svg", {
      xmlns: SVG_NS,
      viewBox: "0 0 " + composition.stage.width + " " + composition.stage.height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": composition.title,
    })
    this.element.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden"
  }

  draw(
    scene: Scene,
    frame: number,
    hidden: ReadonlySet<string>,
    physics3d?: Record<string, { position: Vec3; rotation: Vec3 }>,
  ) {
    const width = this.composition.stage.width
    const height = this.composition.stage.height
    const fragment = document.createDocumentFragment()
    const definitions = element("defs", {})
    fragment.append(definitions)
    fragment.append(
      element("rect", {
        x: 0,
        y: 0,
        width,
        height,
        fill: scene.background ?? this.composition.stage.background ?? "#10131b",
      }),
    )
    for (const node of evaluateSceneAtFrame(scene, frame, hidden)) {
      const pose = physics3d?.[node.id]
      const rendered =
        pose && node.kind === "mesh3d" ? { ...node, position: pose.position, rotation3d: pose.rotation } : node
      fragment.append(this.drawNode(rendered, scene, definitions))
    }
    this.element.replaceChildren(fragment)
  }

  private drawNode(node: VisualNode, scene: Scene, definitions: SVGDefsElement) {
    const group = element("g", {
      transform:
        "translate(" +
        node.x +
        " " +
        node.y +
        ") rotate(" +
        (node.rotation ?? 0) +
        ") scale(" +
        (node.scaleX ?? 1) +
        " " +
        (node.scaleY ?? 1) +
        ")",
      opacity: Math.max(0, Math.min(1, node.opacity ?? 1)),
      "data-coenx-node": node.id,
    })
    const width = node.width
    const height = node.height
    const clip = resolveClipPath(node, scene)
    if (clip) {
      const clipId = `clip-${scene.id}-${node.id}`
      const definition = element("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" })
      definition.append(
        element("path", {
          d: pathCommandsToSvgD(clip.commands, width, height),
          "fill-rule": clip.fillRule,
          "clip-rule": clip.fillRule,
        }),
      )
      definitions.append(definition)
      group.setAttribute("clip-path", `url(#${clipId})`)
    }
    const mask = resolveNodeMask(node, scene)
    if (mask) {
      const maskId = `mask-${scene.id}-${node.id}`
      const maskElement = element("mask", {
        id: maskId,
        maskUnits: "userSpaceOnUse",
        maskContentUnits: "userSpaceOnUse",
        x: -width / 2,
        y: -height / 2,
        width,
        height,
      })
      mask.shapes.forEach((shape, index) => {
        const paintId = `${maskId}-paint-${index}`
        if (isGradientPaint(shape.paint)) {
          const white = whiteAlphaPaint(shape.paint)
          const scaled = {
            ...white,
            stops: white.stops.map((stop) => ({
              offset: stop.offset,
              color: stop.color,
              opacity: Math.max(0, Math.min(1, (stop.opacity ?? 1) * shape.opacity)),
            })),
          }
          const gradient =
            scaled.type === "linear"
              ? element("linearGradient", {
                  id: paintId,
                  x1: (scaled.from[0] - 0.5) * width,
                  y1: (scaled.from[1] - 0.5) * height,
                  x2: (scaled.to[0] - 0.5) * width,
                  y2: (scaled.to[1] - 0.5) * height,
                  gradientUnits: "userSpaceOnUse",
                })
              : element("radialGradient", {
                  id: paintId,
                  cx: (scaled.center[0] - 0.5) * width,
                  cy: (scaled.center[1] - 0.5) * height,
                  r: scaled.radius * Math.min(width, height),
                  gradientUnits: "userSpaceOnUse",
                })
          for (const stop of scaled.stops) {
            gradient.append(
              element("stop", {
                offset: stop.offset,
                "stop-color": stop.color,
                "stop-opacity": Math.max(0, Math.min(1, stop.opacity ?? 1)),
              }),
            )
          }
          definitions.append(gradient)
          maskElement.append(
            element("path", {
              d: pathCommandsToSvgD(shape.commands, width, height),
              fill: `url(#${paintId})`,
              "fill-rule": shape.fillRule,
            }),
          )
          return
        }
        maskElement.append(
          element("path", {
            d: pathCommandsToSvgD(shape.commands, width, height),
            fill: "#ffffff",
            "fill-opacity": shape.opacity,
            "fill-rule": shape.fillRule,
          }),
        )
      })
      definitions.append(maskElement)
      group.setAttribute("mask", `url(#${maskId})`)
    }
    switch (node.kind) {
      case "rect":
      case "button": {
        const fill =
          node.kind === "button"
            ? node.disabled
              ? "#666666"
              : paintValue(node.fill, `gradient-${scene.id}-${node.id}`, "#315fe8", definitions, width, height)
            : paintValue(node.fill, `gradient-${scene.id}-${node.id}`, "none", definitions, width, height)
        group.append(
          element("rect", {
            x: -width / 2,
            y: -height / 2,
            width,
            height,
            rx: node.kind === "button" ? (node.radius ?? 12) : (node.radius ?? 0),
            fill,
            stroke: node.kind === "button" ? (node.borderColor ?? "none") : (node.stroke ?? "none"),
            "stroke-width": node.kind === "rect" ? (node.strokeWidth ?? 1) : 1,
          }),
        )
        if (node.kind === "button") group.append(textElement(node, node.text))
        break
      }
      case "ellipse": {
        const fill = paintValue(node.fill, `gradient-${scene.id}-${node.id}`, "none", definitions, width, height)
        group.append(
          element("ellipse", {
            cx: 0,
            cy: 0,
            rx: width / 2,
            ry: height / 2,
            fill,
            stroke: node.stroke ?? "none",
            "stroke-width": node.strokeWidth ?? 1,
          }),
        )
        break
      }
      case "path": {
        const resolved = resolveNodePath(node, scene)
        const fill = paintValue(node.fill, `gradient-${scene.id}-${node.id}`, "none", definitions, width, height)
        group.append(
          element("path", {
            d: pathCommandsToSvgD(resolved.commands, width, height),
            fill,
            "fill-rule": resolved.fillRule,
            stroke: node.stroke ?? "none",
            "stroke-width": node.strokeWidth ?? 1,
            "stroke-linecap": node.lineCap ?? "butt",
            "stroke-linejoin": node.lineJoin ?? "miter",
          }),
        )
        break
      }
      case "line":
        group.append(
          element("polyline", {
            points: node.points.map(([x, y]) => x - width / 2 + "," + (y - height / 2)).join(" "),
            fill: "none",
            stroke: node.stroke,
            "stroke-width": node.strokeWidth ?? 2,
            "stroke-linecap": node.lineCap ?? "round",
            "stroke-linejoin": "round",
          }),
        )
        break
      case "text":
        group.append(textElement(node, node.text))
        break
      case "image": {
        const configured = this.composition.assets?.[node.asset] ?? node.asset
        const href = this.resolveAsset?.(node.asset, configured) ?? configured
        group.append(
          element("image", {
            href,
            x: -width / 2,
            y: -height / 2,
            width,
            height,
            preserveAspectRatio:
              node.fit === "fill" ? "none" : node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet",
            role: "img",
            "aria-label": node.alt ?? node.id,
          }),
        )
        break
      }
      case "input":
        group.append(
          element("rect", {
            x: -width / 2,
            y: -height / 2,
            width,
            height,
            rx: 8,
            fill: "#ffffff",
            stroke: "#8b95a5",
          }),
        )
        group.append(
          textElement(
            {
              ...node,
              kind: "text",
              text: node.placeholder ?? node.label ?? "",
              color: "#6b7280",
              align: "left",
            },
            node.placeholder ?? node.label ?? "",
          ),
        )
        break
      case "select":
        group.append(
          element("rect", {
            x: -width / 2,
            y: -height / 2,
            width,
            height,
            rx: 8,
            fill: "#ffffff",
            stroke: "#8b95a5",
          }),
        )
        break
      case "mesh3d": {
        const faces = projectMesh3D(node, scene.camera3d, { width, height }, scene.lights3d ?? [])
        for (const face of faces) {
          group.append(
            element("polygon", {
              points: face.points.map(([x, y]) => x + "," + y).join(" "),
              fill: node.material?.wireframe ? "none" : face.fill,
              stroke: face.stroke ?? node.stroke ?? "none",
              "stroke-width": node.stroke ? 0.8 : 0.55,
            }),
          )
        }
        break
      }
    }
    return group
  }

  destroy() {
    this.element.remove()
  }
}
