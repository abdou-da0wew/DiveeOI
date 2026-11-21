import { validateComposition } from "../model/validate"
import type { ButtonNode, EllipseNode, RectNode, Scene, TextNode, VideoComposition, VisualNode } from "../model/types"

export function createComposition(input: Omit<VideoComposition, "version"> & { version?: 1 }) {
  const composition: VideoComposition = { ...input, version: 1 }
  validateComposition(composition)
  return composition
}

export function createScene(input: Scene): Scene {
  return { ...input, nodes: [...input.nodes] }
}

export function rect(input: Omit<RectNode, "kind">): RectNode {
  return { kind: "rect", ...input }
}

export function ellipse(input: Omit<EllipseNode, "kind">): EllipseNode {
  return { kind: "ellipse", ...input }
}

export function text(input: Omit<TextNode, "kind">): TextNode {
  return { kind: "text", ...input }
}

export function button(input: Omit<ButtonNode, "kind">): ButtonNode {
  return { kind: "button", ...input }
}

export function addNode(scene: Scene, node: VisualNode): Scene {
  return { ...scene, nodes: [...scene.nodes, node] }
}

export * as VideoAuthoring from "./composition"
