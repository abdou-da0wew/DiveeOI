// packages/app/src/components/targeted-learning-memory.tsx
//
// Student memory manager (plan §10.5): the student can see, pin and delete everything that is
// remembered about them and about books. Shared by the v1 and v2 settings layouts.

import { Component, For, Show, createResource } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"

interface Memory {
  student: { id: string; kind: string; text: string; pinned: boolean; uses: number }[]
  notes: { id: string; bookId: string; bookTitle?: string; kind: string; text: string; stale: boolean }[]
}

export const TargetedLearningMemory: Component<{ ready: boolean }> = (props) => {
  const serverSDK = useServerSDK()
  const base = () => `${serverSDK().url}/targeted-learning`
  const headers = { "content-type": "application/json" }
  const [memory, { refetch }] = createResource(
    () => props.ready,
    async (ready): Promise<Memory> => {
      if (!ready) return { student: [], notes: [] }
      try {
        const r = await fetch(`${base()}/memory`, { headers })
        return r.ok ? await r.json() : { student: [], notes: [] }
      } catch {
        return { student: [], notes: [] }
      }
    },
  )
  const act = async (url: string, init: RequestInit) => {
    await fetch(`${base()}${url}`, { headers, ...init })
    await refetch()
  }
  const empty = () => (memory()?.student.length ?? 0) === 0 && (memory()?.notes.length ?? 0) === 0

  return (
    <div class="flex flex-col gap-2 py-3 border-b border-[var(--surface-stronger-non-alpha)]">
      <span class="text-13-medium text-text-strong">Student memory</span>
      <span class="text-11-regular text-text-weak">
        What the tutor remembers about how you learn, and findings it saved about your books. Loaded automatically in every
        targeted session.
      </span>
      <Show when={props.ready && empty()}>
        <span class="text-11-regular text-text-weak">Nothing saved yet. It fills up as you study.</span>
      </Show>
      <For each={memory()?.student ?? []}>
        {(m) => (
          <div class="flex items-center justify-between gap-3 text-12-regular">
            <span class="min-w-0">
              <span class="text-text-weak">[{m.kind}] </span>
              {m.text}
            </span>
            <span class="flex items-center gap-3 shrink-0 text-11-regular text-text-weak">
              <button onClick={() => void act(`/memory/student/${m.id}/pin`, { method: "POST", body: JSON.stringify({ pinned: !m.pinned }) })}>
                {m.pinned ? "Unpin" : "Pin"}
              </button>
              <button onClick={() => void act(`/memory/student/${m.id}`, { method: "DELETE" })}>Delete</button>
            </span>
          </div>
        )}
      </For>
      <For each={memory()?.notes ?? []}>
        {(n) => (
          <div class="flex items-center justify-between gap-3 text-12-regular" classList={{ "opacity-50": n.stale }}>
            <span class="min-w-0">
              <span class="text-text-weak">
                [{n.kind} · {n.bookTitle ?? "book"}
                {n.stale ? " · outdated" : ""}]{" "}
              </span>
              {n.text}
            </span>
            <button class="shrink-0 text-11-regular text-text-weak" onClick={() => void act(`/memory/notes/${n.id}`, { method: "DELETE" })}>
              Delete
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
