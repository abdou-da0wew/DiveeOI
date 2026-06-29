export type HoverCommentLine = {
  lineNumber: number
  side?: "additions" | "deletions"
}

export function createHoverCommentUtility(props: {
  label: string
  getHoveredLine: () => HoverCommentLine | undefined
  onSelect: (line: HoverCommentLine) => void
}) {
  if (typeof document === "undefined") return

  const button = document.createElement("button")
  button.type = "button"
  button.ariaLabel = props.label
  button.textContent = "+"
  button.style.width = "20px"
  button.style.height = "20px"
  button.style.display = "flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.border = "none"
  button.style.borderRadius = "var(--radius-md)"
  button.style.background = "var(--icon-interactive-base)"
  button.style.color = "var(--white)"
  button.style.boxShadow = "var(--shadow-xs)"
  button.style.fontSize = "14px"
  button.style.lineHeight = "1"
  button.style.cursor = "pointer"
  button.style.position = "relative"
  button.style.left = "30px"
  button.style.top = "calc((var(--diffs-line-height, 24px) - 20px) / 2)"

  let line: HoverCommentLine | undefined

  const sync = () => {
    const next = props.getHoveredLine()
    if (!next) return
    line = next
  }

  let rAF: number
  const onMouseEnter = sync
  const onMouseMove = sync
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  }
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  }
  const onClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    open()
  }

  const open = () => {
    const next = props.getHoveredLine() ?? line
    if (!next) return
    props.onSelect(next)
  }

  const cleanup = () => {
    cancelAnimationFrame(rAF)
    button.removeEventListener("mouseenter", onMouseEnter)
    button.removeEventListener("mousemove", onMouseMove)
    button.removeEventListener("pointerdown", onPointerDown)
    button.removeEventListener("mousedown", onMouseDown)
    button.removeEventListener("click", onClick)
  }

  const loop = () => {
    if (!button.isConnected) {
      cleanup()
      return
    }
    sync()
    rAF = requestAnimationFrame(loop)
  }

  button.addEventListener("mouseenter", onMouseEnter)
  button.addEventListener("mousemove", onMouseMove)
  button.addEventListener("pointerdown", onPointerDown)
  button.addEventListener("mousedown", onMouseDown)
  button.addEventListener("click", onClick)
  rAF = requestAnimationFrame(loop)

  return button
}
