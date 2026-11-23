// packages/app/src/pages/session/book-pdf-panel.tsx
//
// Book citation viewer — renders the cited book's source PDF as a tab in the
// session tab strip, jumps to the cited page and highlights the cited passage.
//
// Triggered by the `diveeoi:open-book-citation` window event which the
// citation chips (packages/ui/src/components/citation-chip.tsx and the inline
// decoration pass in markdown.tsx) dispatch when clicked. SessionSidePanel
// handles the event by opening a `book:<bookId>` tab (book-tabs.ts) and
// FileTabContent (file-tabs.tsx) renders this component for those tabs, fed
// with the pending citation detail.
//
// Data comes from two Targeted Learning endpoints added for this panel:
//   GET /targeted-learning/books/:bookID/file   → { filename, contentType, contentBase64 }
//   GET /targeted-learning/books/:bookID/chunks/:chunkID → { chunkId, page, text }

import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import * as pdfjsLib from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { IconButton } from "@diveeoi/ui/icon-button"
import { authFetch, basicAuthorizationForRequest, getAccessToken, isSameOriginRequest } from "@/utils/auth-client"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { SelectionQuoteBubble, type QuoteAction, type QuotePayload } from "@/components/selection-quote-toolbar"
import "./book-pdf-panel.css"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Cache decoded PDF documents per book: repeated citation clicks must not refetch
// and re-parse the whole file (a 28MB book is ~38MB of base64 on every open).
const pdfDocCache = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>()
const getCachedPdfDoc = (bookId: string, load: () => Promise<pdfjsLib.PDFDocumentProxy>) => {
  const hit = pdfDocCache.get(bookId)
  if (hit) return hit
  const promise = load().catch((err) => {
    pdfDocCache.delete(bookId)
    throw err
  })
  pdfDocCache.set(bookId, promise)
  return promise
}

// OpenBookCitationDetail now lives in book-tabs.ts (shared with the tab
// helpers); re-exported here so existing importers keep compiling.
export type { OpenBookCitationDetail } from "./book-tabs"

interface ChunkMeta {
  chunkId: string
  bookId: string
  page?: number
  sectionId?: string
  text: string
}

const normalizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\u00AD]/g, "") // soft hyphen
    .replace(/\s+/g, " ")
    .trim()

export function BookPdfPanel(props: {
  bookId: string
  chunkId?: string
  page?: number
  bookTitle?: string
  highlightText?: string
  onClose?: () => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url

  const [chunk, setChunk] = createSignal<ChunkMeta | null>(null)
  const [doc, setDoc] = createSignal<pdfjsLib.PDFDocumentProxy | null>(null)
  // Initial page: the explicit `page` prop (page-only citations), else 1. When a
  // chunkId is given, the chunk's own page is applied once its metadata arrives
  // (unless an explicit page prop takes precedence).
  const [page, setPage] = createSignal(props.page && props.page > 0 ? props.page : 1)
  const [numPages, setNumPages] = createSignal(0)
  const [error, setError] = createSignal("")
  const [loadingDoc, setLoadingDoc] = createSignal(true)

  let canvasRef: HTMLCanvasElement | undefined
  let overlayRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let textLayerRef: HTMLDivElement | undefined
  let linkLayerRef: HTMLDivElement | undefined
  let wrapperRef: HTMLDivElement | undefined
  let renderToken = 0
  let activeRender: pdfjsLib.RenderTask | null = null
  let activeTextLayer: pdfjsLib.TextLayer | null = null
  // Which page at which scale the text layer currently shows. When only the
  // cited chunk's metadata (highlight refresh) changes, the spans already
  // match the canvas — clearing the layer would destroy a selection the user
  // is mid-way through, so the rebuild is skipped.
  let renderedTextLayerKey: string | null = null

  // --- chunk metadata (page number + text to highlight) --------------------
  createEffect(
    on(
      () => [props.bookId, props.chunkId] as const,
      ([bookId, chunkId]) => {
        setChunk(null)
        setError("")
        if (!chunkId) return
        let cancelled = false
        authFetch(`${base()}/targeted-learning/books/${bookId}/chunks/${encodeURIComponent(chunkId)}`)
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            return (await resp.json()) as ChunkMeta
          })
          .then((meta) => {
            if (!cancelled) setChunk(meta)
          })
          .catch((err) => {
            if (!cancelled) setError(`Could not load the cited passage (${err?.message ?? err}).`)
          })
        onCleanup(() => {
          cancelled = true
        })
      },
    ),
  )

  // --- the PDF document itself ---------------------------------------------
  createEffect(
    on(
      () => props.bookId,
      (bookId) => {
        let cancelled = false
        setLoadingDoc(true)
        setError("")
        setDoc(null)
        setNumPages(0)
        ;(async () => {
          try {
            const pdf = await getCachedPdfDoc(bookId, async () => {
              // Byte-range fetch: the server serves the raw PDF with range support so
              // only the cited page's bytes cross slow tunnels (not the whole base64 file).
              const url = new URL(`${base()}/targeted-learning/books/raw`, window.location.origin)
              url.searchParams.set("id", bookId)
              // Basic credentials when configured; otherwise the account Bearer
              // token for same-origin requests (mirrors authFetch's resolution,
              // but for pdf.js which takes static httpHeaders rather than a fetcher).
              const basicAuth = basicAuthorizationForRequest(url.toString(), base())
              const bearer = getAccessToken()
              const authorization = basicAuth ??
                (bearer && isSameOriginRequest(url.toString(), base()) ? `Bearer ${bearer}` : undefined)
              return pdfjsLib.getDocument({
                url: url.toString(),
                ...(authorization ? { httpHeaders: { Authorization: authorization } } : {}),
                rangeChunkSize: 262_144,
                disableAutoFetch: true,
              }).promise
            })
            if (cancelled) return
            setDoc(pdf)
            setNumPages(pdf.numPages)
          } catch (err: any) {
            if (!cancelled) setError(`Could not load the book PDF (${err?.message ?? err}).`)
          } finally {
            if (!cancelled) setLoadingDoc(false)
          }
        })()
        onCleanup(() => {
          cancelled = true
        })
      },
    ),
  )

  // --- jump to the cited page when the chunk arrives -----------------------
  // An explicit `page` prop (page-only citations) wins over the chunk's own page.
  createEffect(
    on(chunk, (meta) => {
      if (!meta) return
      if (props.page && props.page > 0) return
      const target = meta.page && meta.page > 0 ? meta.page : 1
      setPage(Math.min(target, numPages() || target))
    }),
  )

  // --- follow an explicit page prop (page-only citations) ------------------
  createEffect(
    on(
      () => props.page,
      (p) => {
        if (!p || p <= 0) return
        setPage(p)
      },
    ),
  )

  // --- selection quote bubble ----------------------------------------------
  // Selecting text inside the PDF's text layer offers Explain / Memorize /
  // Ask after a short debounce — SelectionQuoteBubble owns the whole selection
  // plumbing (debounced show, hide on collapse/scroll/Escape/outside click).
  // The chosen action is dispatched as a `diveeoi:usr-quote-action` window
  // event so the session layer can turn the quote into a user message.
  const handleQuoteAction = (action: QuoteAction, quote: QuotePayload, question?: string) => {
    window.dispatchEvent(
      new CustomEvent("diveeoi:usr-quote-action", { detail: { action, question, quote } }),
    )
  }

  // --- drag-selection chrome (official pdf.js behavior) ---------------------
  // The standalone TextLayer class does not manage the .endOfContent helper
  // or the .selecting class — the official full viewer does, and its
  // drag-select depends on them. mousedown inside the layer arms .selecting
  // (stretching endOfContent across the layer so drags that start in
  // whitespace or below the last line extend instead of collapsing), mouseup
  // disarms it.
  onMount(() => {
    const armSelecting = (event: MouseEvent) => {
      const layer = textLayerRef
      if (layer && event.target instanceof Node && layer.contains(event.target)) {
        layer.classList.add("selecting")
      }
    }
    const disarmSelecting = () => textLayerRef?.classList.remove("selecting")
    document.addEventListener("mousedown", armSelecting, true)
    document.addEventListener("mouseup", disarmSelecting, true)
    onCleanup(() => {
      document.removeEventListener("mousedown", armSelecting, true)
      document.removeEventListener("mouseup", disarmSelecting, true)
    })
  })

  // Resolve a PDF link annotation's destination to a page number and jump.
  const jumpToDest = async (dest: unknown) => {
    try {
      const pdf = doc()
      if (!pdf) return
      const explicit =
        typeof dest === "string" ? await pdf.getDestination(dest) : Array.isArray(dest) ? dest : null
      const first = explicit?.[0] as { num?: number } | undefined
      if (!first || typeof first.num !== "number") return
      const index = await pdf.getPageIndex(first as unknown as { num: number; gen: number })
      setPage(index + 1)
    } catch {
      // Unresolvable destinations are ignored — links are best-effort.
    }
  }

  // --- render the current page + highlight ---------------------------------
  createEffect(
    on(
      () => [doc(), page(), chunk(), props.highlightText] as const,
      async ([pdf, pageNo, meta, highlightText]) => {
        if (!pdf || !canvasRef) return
        const token = ++renderToken
        onCleanup(() => {
          activeRender?.cancel()
          activeRender = null
          activeTextLayer?.cancel()
          activeTextLayer = null
        })
        try {
          const pg = await pdf.getPage(pageNo)
          if (token !== renderToken) return
          const containerWidth = Math.max(280, (bodyRef?.clientWidth ?? 430) - 20)
          const base = pg.getViewport({ scale: 1 })
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          const scale = (containerWidth / base.width) * dpr
          const viewport = pg.getViewport({ scale })
          const canvas = canvasRef
          const ctx = canvas.getContext("2d")
          if (!ctx) return
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
          const task = pg.render({ canvasContext: ctx, viewport })
          activeRender = task
          await task.promise
          if (token !== renderToken) return

          // Fetch the page's text once — the selectable text layer and the
          // citation-highlight overlay below both need it.
          let pageTextContent: Awaited<ReturnType<typeof pg.getTextContent>> | null = null
          try {
            pageTextContent = await pg.getTextContent()
          } catch {
            // Best-effort: the page still renders without selectable text.
          }
          if (token !== renderToken) return

          // Viewport in CSS pixels (no DPR) — matches the canvas' CSS box for
          // both the text layer spans and the link rects. pdf.js 4.x requires
          // the --scale-factor custom property on an ancestor for the
          // setLayerDimensions() sizing done by the TextLayer constructor.
          const cssViewport = pg.getViewport({ scale: containerWidth / base.width })
          wrapperRef?.style.setProperty("--scale-factor", String(cssViewport.scale))

          // Text layer: absolutely-positioned transparent spans aligned over
          // the canvas so the rendered text is selectable. Rebuilt only when
          // the page or its scale actually changed (see renderedTextLayerKey).
          const textKey = `${props.bookId}:${pageNo}:${cssViewport.scale.toFixed(3)}`
          if (textLayerRef && pageTextContent && renderedTextLayerKey !== textKey) {
            renderedTextLayerKey = textKey
            textLayerRef.innerHTML = ""
            activeTextLayer?.cancel()
            activeTextLayer = null
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: pageTextContent,
              container: textLayerRef,
              viewport: cssViewport,
            })
            activeTextLayer = textLayer
            try {
              await textLayer.render()
            } catch (err) {
              // Best-effort: stale-token renders surface as AbortException
              // here. Forget the key so the next trigger rebuilds the layer.
              renderedTextLayerKey = null
              if (token === renderToken) console.warn("book-pdf-panel: text layer render failed", err)
            }
            if (activeTextLayer === textLayer) activeTextLayer = null
            // Official pdf.js drag helper (styled in book-pdf-panel.css);
            // appended after render so it is not wiped with the spans.
            if (token === renderToken && textLayerRef.querySelector(".endOfContent") === null) {
              const endOfContent = document.createElement("div")
              endOfContent.className = "endOfContent"
              textLayerRef.appendChild(endOfContent)
            }
            if (token !== renderToken) return
          }

          // Link annotations (lightweight): external URLs open in a new tab,
          // internal destinations jump to their page. Transparent hit-rects
          // styled in book-pdf-panel.css; the full official AnnotationLayer
          // is deliberately not used to keep the viewer light.
          if (linkLayerRef) {
            linkLayerRef.innerHTML = ""
            try {
              const annots = await pg.getAnnotations()
              if (token !== renderToken) return
              for (const raw of annots) {
                const annot = raw as { subtype?: string; rect?: number[]; url?: string; dest?: unknown }
                if (annot.subtype !== "Link" || !Array.isArray(annot.rect)) continue
                const [rx1, ry1, rx2, ry2] = pdfjsLib.Util.normalizeRect(
                  cssViewport.convertToViewportRectangle(annot.rect),
                )
                const anchor = document.createElement("a")
                anchor.style.left = `${Math.min(rx1, rx2)}px`
                anchor.style.top = `${Math.min(ry1, ry2)}px`
                anchor.style.width = `${Math.abs(rx2 - rx1)}px`
                anchor.style.height = `${Math.abs(ry2 - ry1)}px`
                if (annot.url) {
                  anchor.href = annot.url
                  anchor.target = "_blank"
                  anchor.rel = "noopener noreferrer"
                } else if (annot.dest) {
                  const target = annot.dest
                  anchor.href = "#"
                  anchor.addEventListener("click", (event) => {
                    event.preventDefault()
                    void jumpToDest(target)
                  })
                } else {
                  continue
                }
                linkLayerRef.appendChild(anchor)
              }
            } catch {
              // Links are best-effort; the page still renders without them.
            }
          }

          // Highlight the cited passage: match the chunk text against the page's
          // text items and overlay translucent rectangles behind them.
          // Matching is whitespace-free: the ingest parser re-orders items into
          // visual lines, so on complex pages the text layer's natural item order
          // differs from the chunk text — a plain indexOf there misses. Sentences
          // are matched individually as a fallback, which also spreads the
          // highlight across every cited sentence found on the page.
          if (overlayRef) {
            overlayRef.innerHTML = ""
            const want = meta?.text || highlightText || ""
            if (normalizeForMatch(want).length >= 12) {
              const textContent = pageTextContent ?? (await pg.getTextContent())
              if (token !== renderToken) return
              const squash = (v: string) => normalizeForMatch(v).replace(/ /g, "")
              let acc = ""
              const spans: { start: number; end: number; item: { str: string; transform: number[]; width: number; height: number } }[] = []
              for (const raw of textContent.items) {
                if (!("str" in raw)) continue
                const item = raw as { str: string; transform: number[]; width: number; height: number }
                const start = acc.length
                acc += squash(item.str)
                spans.push({ start, end: acc.length, item })
              }
              const wantSq = squash(want)
              const hits: [number, number][] = []
              let at = acc.indexOf(wantSq.slice(0, 140))
              if (at >= 0) {
                hits.push([at, at + Math.min(140, wantSq.length)])
              } else {
                at = acc.indexOf(wantSq.slice(0, 60))
                if (at >= 0) {
                  hits.push([at, at + Math.min(60, wantSq.length)])
                } else {
                  const sentences = want
                    .split(/(?<=[.!?])\s+/)
                    .map(squash)
                    .filter((s) => s.length >= 12)
                    .slice(0, 40)
                  for (const s of sentences) {
                    const i = acc.indexOf(s)
                    if (i >= 0) hits.push([i, i + s.length])
                  }
                }
              }
              const highlighted = new Set<number>()
              for (const [from, to] of hits) {
                for (let si = 0; si < spans.length; si++) {
                  const span = spans[si]!
                  if (span.start >= to || span.end <= from) continue
                  if (highlighted.has(si)) continue
                  highlighted.add(si)
                  const tx = pdfjsLib.Util.transform(viewport, span.item.transform)
                  const fontHeight = Math.hypot(tx[2], tx[3]) || 8
                  const rect = document.createElement("div")
                  rect.style.position = "absolute"
                  rect.style.left = `${tx[4] / dpr}px`
                  rect.style.top = `${(tx[5] - fontHeight) / dpr}px`
                  rect.style.width = `${Math.max(span.item.width * scale, 4) / dpr}px`
                  rect.style.height = `${Math.max(fontHeight, 8) / dpr}px`
                  rect.style.background = "var(--pdf-cite-highlight)"
                  rect.style.borderRadius = "2px"
                  rect.style.pointerEvents = "none"
                  overlayRef.appendChild(rect)
                }
              }
            }
          }
        } catch (err: any) {
          if (token === renderToken) setError(`Could not render page ${pageNo} (${err?.message ?? err}).`)
        }
      },
    ),
  )

  const shortId = () => {
    const id = props.chunkId ?? ""
    const m = /-p(\d+)-c(\d+)$/.exec(id)
    return m ? `s-p${m[1]}-c${m[2]}` : id.slice(-10)
  }

  return (
    <div class="size-full flex flex-col min-w-0">
      <div class="h-9 shrink-0 flex items-center gap-1.5 pl-3 pr-2 border-b border-border-weaker-base">
        <svg viewBox="0 0 20 20" fill="none" class="w-3.5 h-3.5 text-text-weak" aria-hidden="true">
          <path
            d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3H9.25v14H5.25a1.75 1.75 0 0 1-1.75-1.75v-10.5ZM10.75 3h4a1.75 1.75 0 0 1 1.75 1.75v10.5A1.75 1.75 0 0 1 14.75 17h-4V3Z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
        <div class="text-12-regular text-text-weak truncate flex-1" title={props.chunkId ?? props.bookTitle}>
          {props.bookTitle ?? language.t("bookPdf.title.fallback", { id: shortId() })}
        </div>
        <IconButton icon="close-small" variant="ghost" class="h-6 w-6" onClick={() => props.onClose?.()} aria-label={language.t("bookPdf.close")} />
      </div>

      <Show
        when={!error()}
        fallback={
          <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">{error()}</div>
        }
      >
        <div class="h-8 shrink-0 flex items-center justify-center gap-2 text-12-regular text-text-weak border-b border-border-weaker-base">
          <button
            type="button"
            class="px-2 py-0.5 rounded-md hover:bg-background-stronger disabled:opacity-40"
            disabled={page() <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label={language.t("bookPdf.prevPage")}
          >
            ‹
          </button>
          <span>
            {loadingDoc() ? language.t("bookPdf.loading") : language.t("bookPdf.page", { page: page(), total: numPages() || "?" })}
            {chunk()?.page ? ` ${language.t("bookPdf.cited")}` : ""}
          </span>
          <button
            type="button"
            class="px-2 py-0.5 rounded-md hover:bg-background-stronger disabled:opacity-40"
            disabled={!numPages() || page() >= numPages()}
            onClick={() => setPage((p) => Math.min(numPages(), p + 1))}
            aria-label={language.t("bookPdf.nextPage")}
          >
            ›
          </button>
        </div>
        <div ref={bodyRef} class="flex-1 min-h-0 overflow-auto bg-background-stronger" data-book-pdf-body="">
          <div ref={wrapperRef} class="relative mx-auto my-3 w-fit" style={{ "min-width": "200px" }}>
            <canvas ref={canvasRef} class="block rounded-sm shadow-sm bg-white" />
            <div ref={textLayerRef} class="textLayer" />
            <div ref={linkLayerRef} class="pdf-link-layer" />
            <div ref={overlayRef} class="absolute inset-0 pointer-events-none z-10" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </Show>
      <SelectionQuoteBubble
        resetKey={page()}
        capture={(sel, _range) => {
          const layer = textLayerRef
          if (!layer || !sel.anchorNode || !sel.focusNode) return null
          if (!layer.contains(sel.anchorNode) || !layer.contains(sel.focusNode)) return null
          return {
            source: "book",
            bookId: props.bookId,
            page: page(),
            chunkId: chunk()?.chunkId,
            bookTitle: props.bookTitle,
          }
        }}
        actions={["explain", "memorize", "ask"]}
        onAction={handleQuoteAction}
      />
    </div>
  )
}
