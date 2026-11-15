import { createMemo, For, Show } from "solid-js"
import type { ChatUIAdvancedComponent, ChatUIStateValue } from "@diveeoi/db/chat-ui"
import type { StateSetter } from "./rich-ui-composition"

export function RichUIMap(props: { component: Extract<ChatUIAdvancedComponent, { type: "map" }> }) {
  const points = createMemo(() => {
    const all = [{ ...props.component.center, label: "Center", id: "center" }, ...props.component.markers]
    const latitudes = all.map((item) => item.latitude)
    const longitudes = all.map((item) => item.longitude)
    const latSpan = Math.max(0.02, Math.max(...latitudes) - Math.min(...latitudes))
    const lonSpan = Math.max(0.02, Math.max(...longitudes) - Math.min(...longitudes))
    const centerLat = props.component.center.latitude
    const centerLon = props.component.center.longitude
    const spanFactor = Math.max(0.02, 18 - props.component.zoom) * 0.015
    const latRange = Math.max(latSpan * 1.25, spanFactor)
    const lonRange = Math.max(lonSpan * 1.25, spanFactor)
    return all.map((item) => ({
      ...item,
      x: 50 + ((item.longitude - centerLon) / lonRange) * 82,
      y: 50 - ((item.latitude - centerLat) / latRange) * 82,
    }))
  })
  const mapURL = () =>
    `https://www.openstreetmap.org/?mlat=${props.component.center.latitude}&mlon=${props.component.center.longitude}#map=${props.component.zoom}/${props.component.center.latitude}/${props.component.center.longitude}`

  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <a
          href={mapURL()}
          target="_blank"
          rel="noreferrer"
          class="text-11-medium text-text-weak underline underline-offset-2"
        >
          Open in OpenStreetMap
        </a>
      </div>
      <div class="relative aspect-[16/9] overflow-hidden rounded-lg border border-border-weak-base bg-background-base">
        <svg
          viewBox="0 0 100 100"
          class="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Coordinate plot with ${props.component.markers.length} map markers`}
        >
          <defs>
            <pattern id="diveeoi-map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" stroke-opacity="0.10" stroke-width="0.35" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#diveeoi-map-grid)" />
          <path d="M0 50 H100 M50 0 V100" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="2 2" />
          <For each={points()}>
            {(point) => (
              <g transform={`translate(${Math.max(4, Math.min(96, point.x))} ${Math.max(5, Math.min(94, point.y))})`}>
                <circle
                  r={point.id === "center" ? 3.2 : 2.5}
                  fill={point.id === "center" ? "currentColor" : "#2563eb"}
                  stroke="white"
                  stroke-width="0.8"
                />
                <text x="4" y="-3" fill="currentColor" font-size="3.2" font-weight="600">
                  {point.label.slice(0, 22)}
                </text>
              </g>
            )}
          </For>
        </svg>
        <div class="absolute bottom-2 left-2 rounded-md bg-background-stronger/90 px-2 py-1 font-mono text-9-regular text-text-weak">
          {props.component.center.latitude.toFixed(4)}, {props.component.center.longitude.toFixed(4)} · z
          {props.component.zoom}
        </div>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <For each={props.component.markers}>
          {(marker, index) => (
            <div class="flex min-w-0 gap-2 rounded-lg bg-background-base p-2.5">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-background-stronger text-10-semibold tabular-nums text-text-weak">
                {index() + 1}
              </span>
              <div class="min-w-0">
                <div class="truncate text-11-semibold text-text-strong">{marker.label}</div>
                <Show when={marker.description}>
                  <div class="mt-0.5 text-10-regular text-text-weak">{marker.description}</div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
      <p class="text-10-regular text-text-weak">
        Coordinate preview only. The linked map provides live basemap tiles and navigation.
      </p>
    </section>
  )
}

export function RichUIDataGrid(props: {
  component: Extract<ChatUIAdvancedComponent, { type: "data-grid" }>
  state: Record<string, ChatUIStateValue>
  setState: StateSetter
}) {
  const rows = createMemo(() => {
    const current = props.state[props.component.key]
    if (typeof current !== "string") return props.component.rows
    try {
      const value = JSON.parse(current)
      if (!Array.isArray(value) || value.length > props.component.maxRows) return props.component.rows
      if (value.some((row) => !Array.isArray(row) || row.length !== props.component.columns.length))
        return props.component.rows
      return value as Array<Array<string | number>>
    } catch {
      return props.component.rows
    }
  })
  const update = (next: Array<Array<string | number>>) => props.setState(props.component.key, JSON.stringify(next))
  const editCell = (rowIndex: number, columnIndex: number, raw: string) => {
    const next = rows().map((row) => [...row])
    const column = props.component.columns[columnIndex]
    if (!column || !next[rowIndex]) return
    if (column.type === "number") {
      if (raw.trim() === "") return
      const value = Number(raw)
      if (!Number.isFinite(value)) return
      next[rowIndex]![columnIndex] = value
    } else next[rowIndex]![columnIndex] = raw.slice(0, 100)
    update(next)
  }
  const addRow = () => {
    if (rows().length >= props.component.maxRows) return
    update([...rows(), props.component.columns.map((column) => (column.type === "number" ? 0 : ""))])
  }
  const deleteRow = (index: number) => update(rows().filter((_, current) => current !== index))

  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
        <span class="text-10-regular text-text-weak">
          {rows().length}/{props.component.maxRows} rows
        </span>
      </div>
      <div class="max-w-full overflow-x-auto rounded-lg border border-border-weak-base">
        <table class="w-full border-collapse text-left text-11-regular">
          <thead>
            <tr class="bg-background-base">
              <For each={props.component.columns}>
                {(column) => <th class="whitespace-nowrap px-3 py-2 font-medium text-text-weak">{column.label}</th>}
              </For>
              <Show when={props.component.editable}>
                <th class="w-8 px-2" aria-label="Row actions" />
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row, rowIndex) => (
                <tr class="border-t border-border-weak-base">
                  <For each={props.component.columns}>
                    {(column, columnIndex) => (
                      <td class="px-2 py-1.5">
                        <Show
                          when={props.component.editable}
                          fallback={<span class="px-1 text-text-base">{row[columnIndex()]}</span>}
                        >
                          <input
                            aria-label={`${column.label}, row ${rowIndex() + 1}`}
                            type={column.type === "number" ? "number" : "text"}
                            value={String(row[columnIndex()] ?? "")}
                            class="h-8 w-full min-w-20 rounded-md border border-transparent bg-transparent px-2 text-11-regular text-text-base outline-none focus:border-border-base focus:bg-background-base"
                            onInput={(event) => editCell(rowIndex(), columnIndex(), event.currentTarget.value)}
                          />
                        </Show>
                      </td>
                    )}
                  </For>
                  <Show when={props.component.editable}>
                    <td class="px-2">
                      <button
                        type="button"
                        aria-label={`Delete row ${rowIndex() + 1}`}
                        class="text-10-regular text-text-weak hover:text-icon-warning-base"
                        onClick={() => deleteRow(rowIndex())}
                      >
                        ×
                      </button>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.component.editable}>
        <button
          type="button"
          class="self-start rounded-lg border border-border-weak-base px-3 py-2 text-11-medium text-text-base hover:bg-background-base disabled:opacity-50"
          disabled={rows().length >= props.component.maxRows}
          onClick={addRow}
        >
          Add row
        </button>
      </Show>
      <p class="text-10-regular text-text-weak">
        {props.component.editable
          ? "Changes are held in this UI's state and included when submitted."
          : "Read-only data grid."}
      </p>
    </section>
  )
}

export function RichUIMedia(props: { component: Extract<ChatUIAdvancedComponent, { type: "media" }> }) {
  return (
    <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-weak-base bg-background-stronger p-4">
      <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
      <div class="grid min-w-0 gap-3 sm:grid-cols-2">
        <For each={props.component.items}>
          {(item) => (
            <figure class="min-w-0 overflow-hidden rounded-lg border border-border-weak-base bg-background-base">
              <Show when={item.type === "image"}>
                <img
                  src={item.url}
                  alt={item.alt ?? item.caption ?? "Interactive media"}
                  loading="lazy"
                  class="max-h-80 w-full object-contain"
                />
              </Show>
              <Show when={item.type === "video"}>
                <video
                  src={item.url}
                  controls
                  preload="metadata"
                  aria-label={item.alt ?? item.caption ?? "Video"}
                  class="max-h-80 w-full"
                />
              </Show>
              <Show when={item.type === "audio"}>
                <div class="p-3">
                  <audio
                    src={item.url}
                    controls
                    preload="metadata"
                    aria-label={item.alt ?? item.caption ?? "Audio"}
                    class="w-full"
                  />
                </div>
              </Show>
              <Show when={item.caption}>
                <figcaption class="border-t border-border-weak-base px-3 py-2 text-10-regular text-text-weak">
                  {item.caption}
                </figcaption>
              </Show>
            </figure>
          )}
        </For>
      </div>
    </section>
  )
}
