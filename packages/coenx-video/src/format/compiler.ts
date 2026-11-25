import { createComposition } from "../authoring/composition"
import { isBundledFontFamily } from "../fonts/catalog"
import type {
  AudioClip,
  ButtonNode,
  ClipPathDefinition,
  EllipseNode,
  ImageNode,
  MaskDefinition,
  NodeAnimation,
  LineNode,
  PaintResource,
  PathDefinition,
  PathNode,
  RectNode,
  Scene,
  SceneInteraction,
  SelectNode,
  TextNode,
  VideoComposition,
  VisualNode,
} from "../model/types"
import { compileSceneDefs, elementLocation, paintFromAttribute, parsePathD } from "./defs"
import { childElements, elementText, parseCmlMarkup, type CmlElement } from "./markup"
import { parseCoenxScript } from "./script"
import { parseCmlStylesheet, stylesForElement, type CmlStyles, type CmlStyleRule } from "./style"

export interface CmlProjectSource {
  markup: string
  styles?: string
  script?: string
}

function number(value: string | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback
  const parsed = Number(value.replace(/px$/, ""))
  if (!Number.isFinite(parsed)) throw new Error(`Coenx compiler: ${label} must be a finite number`)
  return parsed
}

function durationFrames(element: CmlElement, fps: number) {
  if (element.attributes.frames) return Math.round(number(element.attributes.frames, 1, "scene frames"))
  const duration = element.attributes.duration ?? "5s"
  const seconds = duration.endsWith("s")
    ? number(duration.slice(0, -1), 5, "scene duration")
    : number(duration, 5, "scene duration")
  return Math.max(1, Math.round(seconds * fps))
}

function selectorValues(element: CmlElement, rules: CmlStyleRule[]): CmlStyles {
  return { ...stylesForElement(element, rules), ...element.attributes }
}

function value(values: CmlStyles, ...keys: string[]) {
  for (const key of keys) if (values[key] !== undefined) return values[key]
  return undefined
}

function numeric(values: CmlStyles, keys: string[], fallback: number) {
  return number(value(values, ...keys), fallback, keys[0])
}

function color(values: CmlStyles, keys: string[], fallback: string | undefined) {
  return value(values, ...keys) ?? fallback
}

function animationChildren(element: CmlElement): NodeAnimation[] {
  const allowed = new Set<NodeAnimation["property"]>([
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "scaleX",
    "scaleY",
    "opacity",
    "fontSize",
  ])
  return childElements(element, "animate").map((animation) => {
    const property = animation.attributes.property as NodeAnimation["property"]
    if (!allowed.has(property)) throw new Error("Unsupported animated property: " + String(property))
    const from = animation.attributes.from
    const to = animation.attributes.to
    if (!from || !to) throw new Error("Coenx <animate> requires from and to values")
    const start = number(animation.attributes.start, 0, "animation start frame")
    const end = number(animation.attributes.end, 30, "animation end frame")
    const easing = animation.attributes.easing ?? "linear"
    if (!["linear", "ease-in", "ease-out", "ease-in-out", "step"].includes(easing)) {
      throw new Error("Unsupported animation easing: " + easing)
    }
    return {
      property,
      keyframes: [
        { frame: start, value: number(from, 0, "animation from"), easing: "linear" },
        {
          frame: end,
          value: number(to, 0, "animation to"),
          easing: easing as "linear" | "ease-in" | "ease-out" | "ease-in-out" | "step",
        },
      ],
    }
  })
}

function nodeBase(
  element: CmlElement,
  values: CmlStyles,
): {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  zIndex?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  animations?: TextNode["animations"]
} {
  const id = element.attributes.id
  if (!id) throw new Error(`Coenx <${element.tag}> requires an id`)
  const base = {
    id,
    x: numeric(values, ["x"], 0),
    y: numeric(values, ["y"], 0),
    width: numeric(values, ["width"], 320),
    height: numeric(values, ["height"], element.tag === "text" ? 80 : 120),
    rotation: numeric(values, ["rotation"], 0),
    opacity: numeric(values, ["opacity"], 1),
    zIndex: numeric(values, ["z-index", "zIndex"], 0),
    fontFamily: value(values, "font-family", "fontFamily") ?? "Geist",
    fontSize: numeric(values, ["font-size", "fontSize"], 32),
    fontWeight: value(values, "font-weight", "fontWeight") ?? 500,
    animations: animationChildren(element),
  }
  return base
}

function points(value: string | undefined): LineNode["points"] {
  if (!value) throw new Error("Coenx <line> requires points='x,y; x,y'")
  const parsed = value.split(";").map((pair) => {
    const [x, y] = pair.trim().split(",").map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Coenx line points must be finite x,y pairs")
    return [x, y] as const
  })
  if (parsed.length < 2 || parsed.length > 256) throw new Error("Coenx <line> requires 2–256 points")
  return parsed
}

function nodeFromElement(element: CmlElement, rules: CmlStyleRule[], source: string): VisualNode {
  const values = selectorValues(element, rules)
  const base = nodeBase(element, values)
  const fillValue = color(values, ["fill", "background"], "none")
  const fill = paintFromAttribute(fillValue) ?? fillValue
  const stroke = color(values, ["stroke"], "none")
  const strokeWidth = numeric(values, ["stroke-width"], 1)
  const radius = numeric(values, ["border-radius", "radius"], 0)
  const animations = base.animations
  const where = elementLocation(source, element)
  if (!isBundledFontFamily(base.fontFamily ?? "Geist")) {
    throw new Error(`Font ${base.fontFamily} is not included in coenx-video${where}`)
  }
  const clipAttribute = value(values, "clip", "clip-path")
  const maskAttribute = value(values, "mask")
  const clipExtras = clipAttribute ? { clipPathId: clipAttribute } : {}
  const maskExtras = maskAttribute ? { maskId: maskAttribute } : {}

  switch (element.tag) {
    case "rect":
      return { kind: "rect", ...base, ...clipExtras, ...maskExtras, fill, stroke, strokeWidth, radius } satisfies RectNode
    case "ellipse":
      return { kind: "ellipse", ...base, ...clipExtras, ...maskExtras, fill, stroke, strokeWidth } satisfies EllipseNode
    case "line":
      return {
        kind: "line",
        ...base,
        ...clipExtras,
        ...maskExtras,
        points: points(value(values, "points")),
        stroke: color(values, ["stroke"], "#ffffff")!,
        strokeWidth,
      } satisfies LineNode
    case "text": {
      const fontFamily = value(values, "font-family", "fontFamily") ?? "Geist"
      if (!isBundledFontFamily(fontFamily)) throw new Error(`Font ${fontFamily} is not included in coenx-video`)
      return {
        kind: "text",
        ...base,
        text: elementText(element) || value(values, "text") || "",
        color: color(values, ["color", "fill"], "#ffffff"),
        align: (value(values, "text-align", "align") as TextNode["align"]) ?? "center",
        lineHeight: numeric(values, ["line-height", "lineHeight"], 0),
        animations,
      } satisfies TextNode
    }
    case "image": {
      const asset = value(values, "asset", "src")
      if (!asset) throw new Error("Coenx <image> requires asset or src")
      return {
        kind: "image",
        ...base,
        asset,
        alt: values.alt,
        fit: (values.fit ?? "contain") as ImageNode["fit"],
      } satisfies ImageNode
    }
    case "button":
      return {
        kind: "button",
        ...base,
        text: elementText(element) || value(values, "text") || "",
        fill: color(values, ["fill", "background"], "#315fe8"),
        color: color(values, ["color"], "#ffffff"),
        borderColor: color(values, ["stroke", "border-color"], "none"),
        radius,
        disabled: values.disabled === "true",
      } satisfies ButtonNode
    case "input":
      if (!values.bind) throw new Error("Coenx <input> requires bind")
      return {
        kind: "input",
        ...base,
        bind: values.bind,
        placeholder: values.placeholder,
        label: values.label,
        inputType: values.type === "number" ? "number" : "text",
      }
    case "select": {
      if (!values.bind) throw new Error("Coenx <select> requires bind")
      const options = childElements(element, "option").map((option) => ({
        value: option.attributes.value ?? elementText(option),
        label: option.attributes.label ?? elementText(option),
      }))
      return {
        kind: "select",
        ...base,
        bind: values.bind,
        options,
        placeholder: values.placeholder,
      } satisfies SelectNode
    }
    default:
      throw new Error(`Unsupported Coenx visual element <${element.tag}>`)
  }
}

function audioFromElement(element: CmlElement, fps: number): AudioClip {
  const id = element.attributes.id
  const source = element.attributes.src
  if (!id || !source) throw new Error("Coenx <audio> requires id and src")
  const startFrame = number(element.attributes.start, 0, "audio start")
  const duration = element.attributes.duration ?? "5s"
  const seconds = duration.endsWith("s")
    ? number(duration.slice(0, -1), 5, "audio duration")
    : number(duration, 5, "audio duration")
  const kind = element.attributes.kind
  if (kind !== "music" && kind !== "voiceover" && kind !== "sfx") throw new Error(`Unsupported audio kind: ${kind}`)
  return {
    id,
    source,
    kind,
    startFrame,
    durationFrames: Math.max(1, Math.round(seconds * fps)),
    volume: number(element.attributes.volume, 1, "audio volume"),
    loop: element.attributes.loop === "true",
    fadeInFrames: number(element.attributes.fadeIn, 0, "audio fade in"),
    fadeOutFrames: number(element.attributes.fadeOut, 0, "audio fade out"),
  }
}

function assetMap(root: CmlElement) {
  const assets: Record<string, string> = {}
  for (const element of childElements(root, "asset")) {
    const id = element.attributes.id
    const source = element.attributes.src
    if (!id || !source) throw new Error("Coenx <asset> requires id and src")
    assets[id] = source
  }
  return assets
}

function sceneInteractions(
  scene: CmlElement,
  index: number,
  interactions: Array<SceneInteraction & { sceneId?: string }>,
) {
  const id = scene.attributes.id ?? "scene-" + (index + 1)
  return interactions
    .filter((item) => (item.sceneId ? item.sceneId === id : index === 0))
    .map(({ sceneId: _sceneId, ...item }) => item)
}

export function compileCmlProject(source: CmlProjectSource): VideoComposition {
  const root = parseCmlMarkup(source.markup)
  const rules = parseCmlStylesheet(source.styles ?? "")
  const script = parseCoenxScript(source.script ?? "export default { state: {}, events: [] }")
  const width = number(root.attributes.width, 1280, "stage width")
  const height = number(root.attributes.height, 720, "stage height")
  const fps = number(root.attributes.fps, 30, "stage fps")
  const scenes = childElements(root, "scene").map((element, index): Scene => {
    const values = selectorValues(element, rules)
    const id = element.attributes.id ?? `scene-${index + 1}`
    let resources: { pathDefinitions: PathDefinition[]; clipPaths: ClipPathDefinition[]; masks: MaskDefinition[]; paints: PaintResource[] }
    let nodes: VisualNode[]
    try {
      const defs = childElements(element, "defs")[0]
      resources = defs
        ? compileSceneDefs(defs)
        : { pathDefinitions: [], clipPaths: [], masks: [], paints: [] }
      nodes = childElements(element)
        .filter((child) => child.tag !== "animate" && child.tag !== "defs")
        .map((child) => nodeFromElement(child, rules, source.markup))
    } catch (error) {
      const where = elementLocation(source.markup, element)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(where && !message.includes("(line") ? `${message}${where}` : message)
    }
    return {
      id,
      durationFrames: durationFrames(element, fps),
      background: color(values, ["background", "fill"], root.attributes.background ?? "#090d15"),
      nodes,
      ...(resources.pathDefinitions.length ? { pathDefinitions: resources.pathDefinitions } : {}),
      ...(resources.clipPaths.length ? { clipPaths: resources.clipPaths } : {}),
      ...(resources.masks.length ? { masks: resources.masks } : {}),
      ...(resources.paints.length ? { paints: resources.paints } : {}),
      interactions: sceneInteractions(element, index, script.interactions),
    }
  })
  if (!scenes.length) throw new Error("Coenx project must contain at least one <scene>")
  const audio = childElements(root, "audio").map((element) => audioFromElement(element, fps))
  const assets = assetMap(root)
  const citations = childElements(root, "citation").map((element) => ({
    bookId: element.attributes.bookId ?? "",
    passageId: element.attributes.passageId ?? "",
    title: element.attributes.title,
    quote: element.attributes.quote,
    page: element.attributes.page ? number(element.attributes.page, 0, "citation page") : undefined,
  }))
  if (root.attributes.mode === "education") {
    if (!root.attributes.objective?.trim()) throw new Error("Educational CML requires an objective")
    if (!citations.length || citations.some((item) => !item.bookId || !item.passageId)) {
      throw new Error("Educational CML requires real bookId and passageId citation attributes")
    }
  }
  const provenance =
    root.attributes.mode === "education"
      ? { mode: "education" as const, learningObjective: root.attributes.objective, citations }
      : { mode: "general" as const }

  const composition = createComposition({
    id: root.attributes.id ?? "coenx-project",
    title: root.attributes.title ?? "Coenx video",
    stage: { width, height, fps, background: root.attributes.background },
    scenes,
    audio,
    initialState: script.state,
    assets,
    provenance,
  })
  return composition
}
