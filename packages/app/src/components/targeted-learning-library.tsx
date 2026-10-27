// packages/app/src/components/targeted-learning-library.tsx
//
// Library section of the Targeted Learning settings tab (plan §11.5): add, watch and
// remove books. Shared by the v1 and v2 settings layouts (plain markup, no layout chrome).

import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"

interface Book {
  id: string
  slug: string
  title: string
  lang?: string
  status: string
  pages?: number
  chunkCount: number
  error?: string
  progress?: number
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.readAsDataURL(file)
  })

export const TargetedLearningLibrary: Component<{ ready: boolean }> = (props) => {
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = { "content-type": "application/json" }
  const [books, { refetch }] = createResource(
    () => props.ready,
    async (ready): Promise<Book[]> => {
      if (!ready) return []
      try {
        const resp = await fetch(`${base()}/targeted-learning/books`, { headers })
        if (!resp.ok) return []
        return (await resp.json()).books as Book[]
      } catch {
        return []
      }
    },
  )
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")

  const timer = setInterval(() => {
    const pending = (books() ?? []).some((b) => b.status !== "ready" && b.status !== "failed")
    if (props.ready && pending) void refetch()
  }, 2000)
  onCleanup(() => clearInterval(timer))

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setMessage("")
    try {
      const contentBase64 = await readBase64(file)
      const resp = await fetch(`${base()}/targeted-learning/books`, {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      })
      if (!resp.ok) throw new Error(`upload failed (${resp.status})`)
      const result = await resp.json()
      setMessage(result.duplicate ? "That book is already in the library." : "Indexing started. This can take a few minutes.")
      await refetch()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (book: Book) => {
    if (!window.confirm(`Delete "${book.title}" and its index?`)) return
    await fetch(`${base()}/targeted-learning/books/${book.id}`, { method: "DELETE", headers })
    await refetch()
  }

  return (
    <div class="flex flex-col gap-3 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
      <div class="flex items-center justify-between gap-4">
        <div class="flex flex-col gap-1">
          <span class="text-13-medium text-text-strong">Library</span>
          <span class="text-11-regular text-text-weak">
            {props.ready
              ? "Add PDF, DOCX or TXT books. Mention one in chat with @book:name to start a targeted session."
              : "Run Setup first to enable book uploads."}
          </span>
        </div>
        <label
          class="text-12-medium px-3 py-1.5 rounded-md border border-[var(--surface-stronger-non-alpha)]"
          classList={{ "opacity-50 pointer-events-none": !props.ready || busy(), "cursor-pointer": props.ready }}
        >
          {busy() ? "Uploading…" : "Add book"}
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            class="hidden"
            disabled={!props.ready || busy()}
            onChange={(e) => {
              void upload(e.currentTarget.files?.[0])
              e.currentTarget.value = ""
            }}
          />
        </label>
      </div>
      <Show when={message()}>
        <div class="text-11-regular text-text-weak">{message()}</div>
      </Show>
      <Show when={props.ready && (books() ?? []).length > 0}>
        <div class="flex flex-col gap-2">
          <For each={books()}>
            {(book) => (
              <div class="flex items-center justify-between gap-4 text-12-regular">
                <div class="flex flex-col min-w-0">
                  <span class="text-text-strong truncate">{book.title}</span>
                  <span class="text-11-regular text-text-weak truncate">
                    @book:{book.slug}
                    {book.lang ? ` · ${book.lang}` : ""}
                    {book.pages ? ` · ${book.pages} pages` : ""}
                    {book.status === "ready" ? ` · ${book.chunkCount} passages` : ""}
                  </span>
                  <Show when={book.status === "failed" && book.error}>
                    <span class="text-11-regular text-[var(--warning-fg)]">{book.error}</span>
                  </Show>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                  <span
                    class="text-11-regular"
                    classList={{
                      "text-[var(--success-fg)]": book.status === "ready",
                      "text-[var(--warning-fg)]": book.status === "failed",
                      "text-text-weak": book.status !== "ready" && book.status !== "failed",
                    }}
                  >
                    {book.status === "ready" || book.status === "failed"
                      ? book.status
                      : `${book.status}${book.progress !== undefined ? ` ${book.progress}%` : ""}`}
                  </span>
                  <button class="text-11-regular text-text-weak hover:text-text-strong" onClick={() => void remove(book)}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
