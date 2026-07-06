import { createEffect, onCleanup } from "solid-js"

export function useAutoScroll(el: () => HTMLElement | undefined, deps: () => unknown[]) {
  createEffect(() => {
    const element = el()
    const _deps = deps()
    if (!element) return
    const observer = new MutationObserver(() => {
      element.scrollTop = element.scrollHeight
    })
    observer.observe(element, { childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
  })
}
