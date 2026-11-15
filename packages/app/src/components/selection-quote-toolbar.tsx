// packages/app/src/components/selection-quote-toolbar.tsx
//
// SelectionQuoteBubble — a ChatGPT-style floating action bubble for text
// selections. The user selects text inside a scope decided by the owner's
// `capture` callback (the book PDF's text layer, assistant message rows, ...);
// after a short debounce the bubble fades in anchored one full line of text above the selection with
// the configured quick actions. "Ask" expands an inline auto-sizing question
// box. Picking an action hands the quote payload to the owner, which turns it
// into a `diveeoi:usr-quote-action` window event so the composer
// (prompt-input.tsx) can build a usr_quotations message.
//
// The bubble owns ALL of the selection plumbing — debounced show (the bubble
// only appears once the user has actually finished selecting, never mid-drag
// or on stray clicks), hide on collapse / scroll / Escape / outside pointer
// down, viewport clamping — so mount sites stay a few lines.

import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"
import "./selection-quote-toolbar.css"

export type QuoteAction = "explain" | "memorize" | "ask"

/** Site-specific quote fields (source, bookId, page, messageID, ...). */
export type QuoteCapture = Record<string, unknown>

/** A captured selection: the site's fields plus the selected text. */
export type QuotePayload = { text: string } & QuoteCapture

export function SelectionQuoteBubble(props: {
  /** Validate the selection inside the owner's scope; return its quote fields (or null). */
  capture: (sel: Selection, range: Range) => QuoteCapture | null
  actions: QuoteAction[]
  onAction: (action: QuoteAction, quote: QuotePayload, question?: string) => void
  /** Minimum selected characters before the bubble is offered (default 3). */
  minChars?: number
  /** Delay between finishing a selection and the bubble appearing (default 300ms). */
  debounceMs?: number
  /** Bump to force the bubble away (e.g. the PDF page re-rendered). */
  resetKey?: unknown
}) {
  const language = useLanguage()
  const [state, setState] = createSignal<{ rect: DOMRect; quote: QuotePayload; lineH: number } | null>(null)
  const [askOpen, setAskOpen] = createSignal(false)
  const [askValue, setAskValue] = createSignal("")
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null)

  let rootRef: HTMLDivElement | undefined
  let askRef: HTMLTextAreaElement | undefined

  const minChars = () => props.minChars ?? 3
  const debounceMs = () => props.debounceMs ?? 300

  let showTimer: ReturnType<typeof setTimeout> | undefined
  const cancelShow = () => {
    if (showTimer !== undefined) {
      clearTimeout(showTimer)
      showTimer = undefined
    }
  }

  const hide = () => {
    cancelShow()
    setAskOpen(false)
    setAskValue("")
    setState(null)
    setPos(null)
  }

  // True while the user is dragging a selection (primary button held). While
  // dragging, transient selectionchange collapses and scroll events must not
  // hide a pending or shown bubble — hiding mid-drag was the main source of
  // the "flaky" behavior.
  let dragging = false

  const insideBubble = (target: EventTarget | null | undefined) =>
    !!rootRef && target instanceof Node && rootRef.contains(target)

  // Height of one full line of text at the start of the selection. Used as
  // the bubble gap so the bubble always floats one full line above the
  // cursor, in the chat DOM and the PDF text layer alike.
  const oneLineHeight = (range: Range): number => {
    const start = range.startContainer
    const el = (start.nodeType === 1 ? start : start.parentElement) as Element | null
    // Prefer the computed line pitch (a FULL line of text at this spot);
    // the caret rect only reports the em box (e.g. 16px for a 22.4px line).
    if (el) {
      const cs = window.getComputedStyle(el)
      const lh = Number.parseFloat(cs.lineHeight)
      if (Number.isFinite(lh) && lh >= 10) return lh
    }
    try {
      const caret = range.cloneRange()
      caret.collapse(true)
      const h = caret.getBoundingClientRect().height
      if (Number.isFinite(h) && h >= 10) return h
      const rects = caret.getClientRects()
      if (rects.length > 0) {
        const rh = rects[0].height
        if (Number.isFinite(rh) && rh >= 10) return rh
      }
    } catch {}
    if (el) {
      const fs = Number.parseFloat(window.getComputedStyle(el).fontSize)
      if (Number.isFinite(fs) && fs > 0) return fs * 1.5
    }
    return 24
  }

  // Debounced capture: the selection is re-validated when the timer fires, so
  // the bubble only appears once the user has actually finished selecting and
  // the selection still lives inside the owner's scope.
  const scheduleShow = () => {
    cancelShow()
    showTimer = setTimeout(() => {
      showTimer = undefined
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (state()) hide()
        return
      }
      const range = sel.getRangeAt(0)
      const captured = props.capture(sel, range)
      const text = sel.toString().replace(/\s+/g, " ").trim()
      if (!captured || text.length < minChars()) {
        if (state()) hide()
        return
      }
      setState({ rect: range.getBoundingClientRect(), quote: { ...captured, text }, lineH: oneLineHeight(range) })
    }, debounceMs())
  }

  // Measure + place the bubble for the current selection state. The rAF lets
  // the keyed content mount first so offsetWidth/Height are real values; the
  // retry covers the case where the first frame still reports a ~1px box (the
  // bubble stays hidden until a real measurement lands, so no jump/flicker).
  const place = () => {
    let tries = 0
    const step = () => {
      const el = rootRef
      const st = state()
      if (!el || !st) return
      const height = el.offsetHeight
      if (height < 4 && tries++ < 10) {
        requestAnimationFrame(step)
        return
      }
      const margin = 8
      // One full line of text between the bubble and the selection/cursor.
      const gap = Math.max(6, st.lineH ?? 24)
      const width = el.offsetWidth
      const rect = st.rect
      // Stay ABOVE the selection + cursor; flip below only when a bubble
      // pinned to the viewport top would still cover the selection.
      const below = rect.top - margin < height
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - margin - width))
      const top = below
        ? Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - margin - height))
        : Math.max(margin, rect.top - gap - height)
      setPos({ left, top })
    }
    requestAnimationFrame(step)
  }

  const onMouseUp = (event: MouseEvent) => {
    dragging = false
    if (insideBubble(event.target)) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // Plain click (no selection) — never show, drop any pending appearance.
      if (state() || showTimer !== undefined) hide()
      return
    }
    scheduleShow()
  }

  // Keyboard-made selections (shift+arrows, ctrl/cmd+A) have no mouseup.
  const onKeyUp = (event: KeyboardEvent) => {
    if (insideBubble(event.target)) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (state()) hide()
      return
    }
    scheduleShow()
  }

  // The bubble survives while the focus is inside it: focusing the ask
  // textarea collapses the document selection by design.
  const onSelectionChange = () => {
    // Mid-drag the selection can transiently collapse (especially around
    // page edges and drag extensions) — never treat that as "selection gone".
    if (dragging) return
    if (rootRef && rootRef.contains(document.activeElement)) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (state() || showTimer !== undefined) hide()
      return
    }
    // Extending an already-shown selection repositions the bubble (debounced).
    if (state()) scheduleShow()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide()
  }

  // Scroll events do not bubble, but the capture phase still reaches
  // descendants. Instead of hiding the bubble on ANY scroll (which felt
  // flaky — momentum or edge scrolling killed it instantly), the bubble
  // re-positions against the live selection once per frame; it hides only if
  // the selection no longer validates inside the owner's scope. This is how
  // document apps (Notion, Google Docs) keep their floating tools stable
  // while the page scrolls.
  const repositionToSelection = () => {
    const current = state()
    if (!current) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hide()
      return
    }
    const range = sel.getRangeAt(0)
    const captured = props.capture(sel, range)
    const text = sel.toString().replace(/\s+/g, " ").trim()
    if (!captured || text.length < minChars()) {
      hide()
      return
    }
    // Silent in-place update: mutating the state object does not re-run the
    // keyed <Show> (no remount/flicker); placement reads the fresh rect.
    current.rect = range.getBoundingClientRect()
    current.lineH = oneLineHeight(range)
    place()
  }

  let scrollRaf = 0
  const onScroll = () => {
    if (dragging) return
    if (askOpen() && rootRef && rootRef.contains(document.activeElement)) return
    if (!state() && showTimer === undefined) return
    cancelAnimationFrame(scrollRaf)
    scrollRaf = requestAnimationFrame(repositionToSelection)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) dragging = true
    if (insideBubble(event.target)) return
    if (state() || showTimer !== undefined) hide()
  }

  const onPointerUp = () => {
    dragging = false
  }

  // A viewport resize invalidates the measured position (stale rect).
  const onResize = () => {
    if (state() || showTimer !== undefined) hide()
  }

  // Losing the window (alt-tab, detached drag) leaves no reliable mouseup.
  const onBlur = () => {
    dragging = false
  }

  onMount(() => {
    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("keyup", onKeyUp)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("pointerup", onPointerUp)
    window.addEventListener("resize", onResize)
    window.addEventListener("blur", onBlur)
    onCleanup(() => {
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("keyup", onKeyUp)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", onScroll, { capture: true })
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("blur", onBlur)
      cancelAnimationFrame(scrollRaf)
      cancelShow()
    })
  })

  // An owner-side reset (PDF page re-render, message list swap) always hides.
  createEffect(on(() => props.resetKey, () => hide()))

  // Measure + place whenever a new selection appears.
  createEffect(
    on(state, () => {
      setPos(null)
      place()
    }),
  )

  const label = (action: QuoteAction) =>
    action === "explain"
      ? language.t("book.quote.explain")
      : action === "memorize"
        ? language.t("book.quote.memorize")
        : language.t("book.quote.ask")

  const runAction = (action: QuoteAction, question?: string) => {
    const current = state()
    if (!current) return
    props.onAction(action, current.quote, question)
    window.getSelection()?.removeAllRanges()
    hide()
  }

  // Auto-resize the ask textarea while typing (capped at 160px).
  const resizeAsk = () => {
    const el = askRef
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  createEffect(() => {
    if (askOpen()) queueMicrotask(() => {
      askRef?.focus()
      resizeAsk()
    })
  })

  const submitAsk = () => {
    const value = askValue().trim()
    if (!value) return
    runAction("ask", value)
  }

  // Portal to <body>: ancestor containers (backdrop-filter/content-
  // visibility) would otherwise become the containing block for this fixed
  // element and shift every placement by the app header's offset.
  return (
    <Portal>
    <div
      ref={rootRef}
      data-component="selection-quote-bubble"
      class="fixed z-[9999] rounded-lg border border-border-weaker-base bg-background-base shadow-lg p-1"
      style={{
        left: `${pos()?.left ?? -9999}px`,
        top: `${pos()?.top ?? -9999}px`,
        visibility: state() && pos() ? "visible" : "hidden",
        "pointer-events": state() && pos() ? "auto" : "none",
      }}
    >
      <Show when={state()} keyed>
        {(current) => (
          <div class="selection-quote-bubble-pop flex flex-col gap-0.5" data-quote-len={current.quote.text.length}>
            <div class="flex items-center gap-0.5">
              <For each={props.actions}>
                {(action) => (
                  <button
                    type="button"
                    class="h-7 px-2.5 rounded-md text-12-regular text-text-strong hover:bg-background-stronger whitespace-nowrap"
                    onClick={() => {
                      if (action === "ask") setAskOpen(true)
                      else runAction(action)
                    }}
                  >
                    {label(action)}
                  </button>
                )}
              </For>
            </div>
            <Show when={askOpen()}>
              <div class="rounded-md border border-border-weaker-base bg-background-base overflow-hidden">
                <textarea
                  ref={askRef}
                  rows={1}
                  class="w-full pl-3 pr-2 pt-2 pb-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap resize-none"
                  placeholder={language.t("book.quote.askPlaceholder")}
                  value={askValue()}
                  onInput={(event) => {
                    setAskValue(event.currentTarget.value)
                    resizeAsk()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation()
                      hide()
                    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                      event.preventDefault()
                      submitAsk()
                    }
                  }}
                />
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
    </Portal>
  )
}
