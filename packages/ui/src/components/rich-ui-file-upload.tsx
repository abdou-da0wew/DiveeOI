import { createSignal, For, Show } from "solid-js"
import type { ChatUIComponent } from "@diveeoi/db/chat-ui"
import type { ChatUIState, StateSetter } from "./rich-ui-composition"

export function RichUIFileUpload(props: {
  component: Extract<ChatUIComponent, { type: "file-upload" }>
  state: ChatUIState
  setState: StateSetter
  onFilesChange?: (key: string, files: File[]) => void
}) {
  const value = props.component
  const [error, setError] = createSignal("")
  const selected = () => {
    try {
      const parsed = JSON.parse(String(props.state[value.key] ?? "[]"))
      return Array.isArray(parsed) ? (parsed as Array<{ name: string; size: number }>) : []
    } catch {
      return []
    }
  }
  const onChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const incoming = Array.from(input.files ?? [])
    const chosen = value.multiple ? incoming : incoming.slice(0, 1)
    const allowed = new Set(value.accept)
    const maxBytes = value.maxSizeMB * 1024 * 1024
    const invalid = chosen.find((file) => !allowed.has(file.type) || file.size > maxBytes)
    if (invalid) {
      setError(
        !allowed.has(invalid.type)
          ? `Unsupported file type: ${invalid.type || "unknown"}`
          : `${invalid.name} exceeds ${value.maxSizeMB} MB`,
      )
      input.value = ""
      return
    }
    if (chosen.length > 5) {
      setError("Choose no more than five files at once")
      input.value = ""
      return
    }
    setError("")
    props.setState(
      value.key,
      JSON.stringify(chosen.map((file) => ({ name: file.name.slice(0, 180), size: file.size, type: file.type }))),
    )
    props.onFilesChange?.(value.key, chosen)
  }
  return (
    <div class="flex min-w-0 flex-col gap-2 rounded-xl border border-border-weak-base bg-background-base p-3">
      <label class="text-12-medium text-text-strong">{value.label}</label>
      <input
        type="file"
        accept={value.accept.join(",")}
        multiple={value.multiple}
        required={value.required}
        class="block w-full text-11-regular text-text-weak file:mr-3 file:rounded-lg file:border file:border-border-weak-base file:bg-background-stronger file:px-3 file:py-2 file:text-11-medium file:text-text-strong"
        onChange={onChange}
      />
      <Show when={value.helpText}>
        <p class="text-10-regular text-text-weak">{value.helpText}</p>
      </Show>
      <Show when={selected().length > 0}>
        <div class="flex flex-col gap-1">
          <For each={selected()}>
            {(file) => (
              <div class="flex justify-between gap-2 text-10-regular text-text-weak">
                <span class="truncate">{file.name}</span>
                <span class="shrink-0">{(file.size / 1024).toFixed(0)} KB</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={error()}>
        <p role="alert" class="text-10-regular text-icon-warning-base">
          {error()}
        </p>
      </Show>
    </div>
  )
}
