import type { Scene, VideoComposition, VisualNode } from "../model/types"
import type { PlayerEvent } from "../interactive/engine"
import { cssPaint } from "../render/paint"

export interface ControlCallbacks {
  dispatch?: (event: PlayerEvent) => void
}

export class InteractiveControls {
  private readonly nodes = new Map<string, HTMLElement>()
  private sceneId = ""

  constructor(
    private readonly root: HTMLElement,
    private readonly composition: VideoComposition,
    private readonly callbacks: ControlCallbacks,
  ) {
    this.root.style.position = "absolute"
    this.root.style.inset = "0"
    this.root.style.pointerEvents = "none"
  }

  update(scene: Scene) {
    if (this.sceneId !== scene.id) {
      this.destroyNodes()
      this.sceneId = scene.id
    }
    const wanted = new Set(
      scene.nodes
        .filter((node) => node.kind === "button" || node.kind === "input" || node.kind === "select")
        .map((node) => node.id),
    )
    for (const [id, element] of this.nodes) {
      if (wanted.has(id)) continue
      element.remove()
      this.nodes.delete(id)
    }
    for (const node of scene.nodes) {
      if (!wanted.has(node.id)) continue
      let element = this.nodes.get(node.id)
      if (!element || element.dataset.coenxKind !== node.kind) {
        element?.remove()
        element = this.create(node)
      }
      const style = element.style
      const hidden = node.visible === false
      style.display = hidden ? "none" : "block"
      style.left = `${((node.x - node.width / 2) / this.composition.stage.width) * 100}%`
      style.top = `${((node.y - node.height / 2) / this.composition.stage.height) * 100}%`
      style.width = `${(node.width / this.composition.stage.width) * 100}%`
      style.height = `${(node.height / this.composition.stage.height) * 100}%`
      style.transform = `rotate(${node.rotation ?? 0}deg)`
      style.opacity = String(node.opacity ?? 1)
      style.pointerEvents = hidden ? "none" : "auto"
      style.fontFamily = node.fontFamily ?? "Geist"
      style.fontSize = String(node.fontSize ?? 16) + "px"
      style.fontWeight = String(node.fontWeight ?? 500)
      if (element instanceof HTMLButtonElement && node.kind === "button") {
        element.disabled = !!node.disabled
        element.textContent = node.text
        style.background = node.disabled ? "#666666" : cssPaint(node.fill, "#315fe8")
        style.color = node.color ?? "#ffffff"
      }
      if (element instanceof HTMLInputElement && node.kind === "input") {
        element.placeholder = node.placeholder ?? node.label ?? ""
        element.type = node.inputType ?? "text"
        if (element.value !== String(this.stateValue(node.bind))) element.value = String(this.stateValue(node.bind))
      }
      if (element instanceof HTMLSelectElement && node.kind === "select") {
        const optionsKey = JSON.stringify(node.options)
        if (element.dataset.options !== optionsKey) {
          element.replaceChildren(new Option(node.placeholder ?? "Choose an answer", ""))
          for (const option of node.options) element.add(new Option(option.label, option.value))
          element.dataset.options = optionsKey
        }
      }
    }
  }

  private stateValue(key: string) {
    return this.state?.[key] ?? ""
  }

  private state?: Record<string, string | number | boolean | null>

  setState(state: Record<string, string | number | boolean | null>) {
    this.state = state
  }

  private create(node: VisualNode) {
    let element: HTMLElement
    if (node.kind === "button") {
      const button = document.createElement("button")
      button.type = "button"
      button.addEventListener("click", () => this.callbacks.dispatch?.({ type: "click", targetId: node.id }))
      element = button
    } else if (node.kind === "input") {
      const input = document.createElement("input")
      input.type = node.inputType ?? "text"
      input.placeholder = node.placeholder ?? node.label ?? ""
      input.addEventListener("input", () =>
        this.callbacks.dispatch?.({ type: "change", targetId: node.id, value: input.value }),
      )
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.callbacks.dispatch?.({ type: "submit", targetId: node.id, value: input.value })
      })
      element = input
    } else if (node.kind === "select") {
      const select = document.createElement("select")
      select.addEventListener("change", () =>
        this.callbacks.dispatch?.({ type: "change", targetId: node.id, value: select.value }),
      )
      element = select
    } else {
      throw new Error("Interactive controls can only be created for buttons, inputs, and selects")
    }
    element.dataset.coenxNode = node.id
    element.dataset.coenxKind = node.kind
    element.style.cssText +=
      "position:absolute;box-sizing:border-box;pointer-events:auto;font:inherit;max-width:100%;max-height:100%;"
    if (element instanceof HTMLButtonElement) {
      element.style.border = "1px solid rgba(255,255,255,.2)"
      element.style.borderRadius = `${node.kind === "button" ? (node.radius ?? 12) : 8}px`
      element.style.cursor = "pointer"
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      element.style.background = "#ffffff"
      element.style.color = "#10131b"
      element.style.border = "1px solid #8b95a5"
      element.style.borderRadius = "8px"
      element.style.padding = "0 10px"
    }
    this.nodes.set(node.id, element)
    this.root.append(element)
    return element
  }

  private destroyNodes() {
    for (const element of this.nodes.values()) element.remove()
    this.nodes.clear()
  }

  destroy() {
    this.destroyNodes()
  }
}
