// packages/app/src/components/targeted-learning-library.tsx
//
// Library section of the Targeted Learning settings tab (plan §11.5): add, watch and
// remove books. Shared by the v1 and v2 settings layouts (plain markup, no layout chrome).

import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { authFetch } from "@/utils/auth-client"

interface Book {
  id: string
  slug: string
  title: string
  lang?: string
  status: string
  pages?: number
  chunkCount: number
  error?: string
  jobId?: string
  jobStatus?: string
  progress?: number
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.readAsDataURL(file)
  })

// The server caps a single book at 200 MB (maxBookSizeMB default); guard client-side so a
// huge base64 JSON body never hangs the tab before the server rejects it.
const MAX_UPLOAD_MB = 190

export const TargetedLearningLibrary: Component<{ ready: boolean }> = (props) => {
  const language = useLanguage()
  const t = (key: string, params?: Record<string, string | number>) => language.t(key as never, params as never)
  const serverSDK = useServerSDK()
  const base = () => serverSDK().url
  const headers = { "content-type": "application/json" }
  const [books, { refetch }] = createResource(
    () => props.ready,
    async (ready): Promise<Book[]> => {
      if (!ready) return []
      try {
        const resp = await authFetch(`${base()}/targeted-learning/books`, { headers })
        if (!resp.ok) return []
        return (await resp.json()).books as Book[]
      } catch {
        return []
      }
    },
  )
  const [busy, setBusy] = createSignal(false)
  const [busyJob, setBusyJob] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal("")

  const controlJob = async (book: Book, action: "pause" | "resume" | "cancel" | "retry") => {
    if (!book.jobId) return
    setBusyJob(book.jobId)
    setMessage("")
    try {
      const resp = await authFetch(`${base()}/targeted-learning/jobs/${book.jobId}/${action}`, {
        method: "POST",
        headers,
      })
      if (!resp.ok) throw new Error(`${action} failed (${resp.status})`)
      setMessage(t("targetedLearning.library.jobRequested", { action }))
      await refetch()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Could not ${action} the job.`)
    } finally {
      setBusyJob(null)
    }
  }

  const timer = setInterval(() => {
    const pending = (books() ?? []).some((b) => b.status !== "ready" && b.status !== "failed")
    if (props.ready && pending) void refetch()
  }, 2000)
  onCleanup(() => clearInterval(timer))

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setMessage(t("targetedLearning.library.tooLarge", { title: file.name, max: MAX_UPLOAD_MB }))
      return
    }
    setBusy(true)
    setMessage("")
    try {
      const contentBase64 = await readBase64(file)
      const resp = await authFetch(`${base()}/targeted-learning/books`, {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      })
      if (!resp.ok) throw new Error(`upload failed (${resp.status})`)
      const result = await resp.json()
      setMessage(result.duplicate ? t("targetedLearning.library.duplicate") : t("targetedLearning.library.indexing"))
      await refetch()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (book: Book) => {
    if (!window.confirm(t("targetedLearning.library.confirmDelete", { title: book.title }))) return
    setBusyJob(book.id)
    setMessage("")
    try {
      const resp = await authFetch(`${base()}/targeted-learning/books/${book.id}`, { method: "DELETE", headers })
      if (!resp.ok) throw new Error(`delete failed (${resp.status})`)
      await refetch()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("targetedLearning.library.deleteFailed"))
    } finally {
      setBusyJob(null)
    }
  }

  return (
    <div class="flex flex-col gap-3 py-4 border-b border-border-weak-base">
      <div class="flex items-center justify-between gap-4">
        <div class="flex flex-col gap-1">
          <span class="text-14-medium text-text-strong">{t("targetedLearning.library.title")}</span>
          <span class="text-12-regular text-text-weak">
            {props.ready
              ? t("targetedLearning.library.hint")
              : t("targetedLearning.library.hint.setup")}
          </span>
        </div>
        <label
          class="text-12-medium px-3 py-1.5 rounded-md border border-border-weak-base"
          classList={{ "opacity-50 pointer-events-none": !props.ready || busy(), "cursor-pointer": props.ready }}
        >
          {busy() ? t("targetedLearning.library.uploading") : t("targetedLearning.library.add")}
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
        <div class="text-12-regular text-text-weak">{message()}</div>
      </Show>
      <Show when={props.ready && (books() ?? []).length > 0}>
        <div class="flex flex-col gap-2">
          <For each={books()}>
            {(book) => (
              <div class="flex items-center justify-between gap-4 text-12-regular">
                <div class="flex flex-col min-w-0">
                  <span class="text-text-strong truncate">{book.title}</span>
                  <span class="text-12-regular text-text-weak truncate">
                    @book:{book.slug}
                    {book.lang ? ` · ${book.lang}` : ""}
                    {book.pages ? ` · ${t("targetedLearning.library.pages", { count: book.pages })}` : ""}
                    {book.status === "ready" ? ` · ${t("targetedLearning.library.passages", { count: book.chunkCount })}` : ""}
                  </span>
                  <Show when={book.status === "failed" && book.error}>
                    <span class="text-12-regular text-[var(--warning-fg)]">{book.error}</span>
                  </Show>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                  <span
                    class="text-12-regular"
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
                  <Show when={book.jobId && (book.jobStatus === "running" || book.jobStatus === "queued")}>
                    <button
                      class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                      disabled={busyJob() === book.jobId}
                      onClick={() => void controlJob(book, "pause")}
                    >
                      {t("targetedLearning.library.pause")}
                    </button>
                  </Show>
                  <Show when={book.jobId && book.jobStatus === "paused"}>
                    <button
                      class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                      disabled={busyJob() === book.jobId}
                      onClick={() => void controlJob(book, "resume")}
                    >
                      {t("targetedLearning.library.resume")}
                    </button>
                  </Show>
                  <Show when={book.jobId && (book.jobStatus === "failed" || book.jobStatus === "cancelled")}>
                    <button
                      class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                      disabled={busyJob() === book.jobId}
                      onClick={() => void controlJob(book, "retry")}
                    >
                      {t("targetedLearning.library.retry")}
                    </button>
                  </Show>
                  <Show when={book.jobId && ["queued", "running", "paused"].includes(book.jobStatus ?? "")}>
                    <button
                      class="text-12-regular text-text-weak hover:text-[var(--warning-fg)] disabled:opacity-50"
                      disabled={busyJob() === book.jobId}
                      onClick={() => void controlJob(book, "cancel")}
                    >
                      {t("targetedLearning.library.cancelJob")}
                    </button>
                  </Show>
                  <button
                    class="text-12-regular text-text-weak hover:text-text-strong disabled:opacity-50"
                    disabled={busyJob() === book.id}
                    onClick={() => void remove(book)}
                  >
                    {t("targetedLearning.library.delete")}
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
