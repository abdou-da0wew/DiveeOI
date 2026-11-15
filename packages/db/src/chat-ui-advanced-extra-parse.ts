import type { ChatUIAdvancedComponent, ParseResult } from "./chat-ui"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>

const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

function text(value: unknown, field: string, max: number): Parsed<string> {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    return { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }
  }
  return { ok: true, value: value.trim() }
}

function number(value: unknown, field: string, min: number, max: number): Parsed<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${field} must be a finite number between ${min} and ${max}` }
  }
  return { ok: true, value }
}

function identifier(value: unknown, field: string): Parsed<string> {
  const parsed = text(value, field, 48)
  if (!parsed.ok) return parsed
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(parsed.value)
    ? parsed
    : { ok: false, error: `${field} must be a valid identifier` }
}

function list(value: unknown, field: string, min: number, max: number): Parsed<unknown[]> {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return { ok: false, error: `${field} must contain between ${min} and ${max} items` }
  }
  return { ok: true, value }
}

export function parseAdvancedChatUIExtra(input: RecordValue): Parsed<ChatUIAdvancedComponent> | undefined {
  if (input.type === "map") {
    const title = text(input.title, "map.title", 120)
    const center = object(input.center)
    const zoom = number(input.zoom, "map.zoom", 1, 18)
    const rawMarkers = list(input.markers, "map.markers", 1, 24)
    if (!title.ok) return title
    if (!center) return { ok: false, error: "Map center must be an object" }
    if (!zoom.ok || !Number.isInteger(zoom.value))
      return { ok: false, error: "Map zoom must be an integer from 1 to 18" }
    if (!rawMarkers.ok) return rawMarkers
    const latitude = number(center.latitude, "map.center.latitude", -90, 90)
    const longitude = number(center.longitude, "map.center.longitude", -180, 180)
    if (!latitude.ok) return latitude
    if (!longitude.ok) return longitude
    const markers: Extract<ChatUIAdvancedComponent, { type: "map" }>["markers"] = []
    for (const raw of rawMarkers.value) {
      const marker = object(raw)
      if (!marker) return { ok: false, error: "Map markers must be objects" }
      const id = identifier(marker.id, "marker.id")
      const label = text(marker.label, "marker.label", 80)
      const lat = number(marker.latitude, "marker.latitude", -90, 90)
      const lon = number(marker.longitude, "marker.longitude", -180, 180)
      const description =
        marker.description === undefined ? undefined : text(marker.description, "marker.description", 240)
      if (!id.ok) return id
      if (!label.ok) return label
      if (!lat.ok) return lat
      if (!lon.ok) return lon
      if (description && !description.ok) return description
      markers.push({
        id: id.value,
        label: label.value,
        latitude: lat.value,
        longitude: lon.value,
        ...(description?.ok ? { description: description.value } : {}),
      })
    }
    if (new Set(markers.map((marker) => marker.id)).size !== markers.length) {
      return { ok: false, error: "Map marker IDs must be unique" }
    }
    return {
      ok: true,
      value: {
        type: "map",
        title: title.value,
        center: { latitude: latitude.value, longitude: longitude.value },
        zoom: zoom.value,
        markers,
      },
    }
  }

  if (input.type === "data-grid") {
    const id = identifier(input.id, "data-grid.id")
    const key = identifier(input.key, "data-grid.key")
    const title = text(input.title, "data-grid.title", 120)
    const rawColumns = list(input.columns, "data-grid.columns", 1, 8)
    const rawRows = list(input.rows, "data-grid.rows", 1, 50)
    if (!id.ok) return id
    if (!key.ok) return key
    if (!title.ok) return title
    if (!rawColumns.ok) return rawColumns
    if (!rawRows.ok) return rawRows
    const columns: Extract<ChatUIAdvancedComponent, { type: "data-grid" }>["columns"] = []
    for (const raw of rawColumns.value) {
      const column = object(raw)
      if (!column) return { ok: false, error: "Data-grid columns must be objects" }
      const columnID = identifier(column.id, "column.id")
      const label = text(column.label, "column.label", 64)
      if (!columnID.ok) return columnID
      if (!label.ok) return label
      if (column.type !== "text" && column.type !== "number")
        return { ok: false, error: "Data-grid column type must be text or number" }
      columns.push({ id: columnID.value, label: label.value, type: column.type })
    }
    if (new Set(columns.map((column) => column.id)).size !== columns.length)
      return { ok: false, error: "Data-grid column IDs must be unique" }
    const rows: Array<Array<string | number>> = []
    for (const rawRow of rawRows.value) {
      if (!Array.isArray(rawRow) || rawRow.length !== columns.length)
        return { ok: false, error: "Data-grid rows must match the column count" }
      const row: Array<string | number> = []
      for (let index = 0; index < columns.length; index++) {
        const cell = rawRow[index]
        const column = columns[index]!
        if (column.type === "text" && typeof cell === "string" && cell.length <= 100) row.push(cell)
        else if (column.type === "number" && typeof cell === "number" && Number.isFinite(cell)) row.push(cell)
        else return { ok: false, error: `Cell in column ${column.id} has the wrong value type` }
      }
      rows.push(row)
    }
    const editable = input.editable === undefined ? false : input.editable
    if (typeof editable !== "boolean") return { ok: false, error: "data-grid.editable must be a boolean" }
    const maxRows = input.maxRows === undefined ? 50 : number(input.maxRows, "data-grid.maxRows", rows.length, 50)
    if (typeof maxRows === "object" && !maxRows.ok) return maxRows
    const maxRowsValue = typeof maxRows === "number" ? maxRows : maxRows.value
    if (!Number.isInteger(maxRowsValue)) return { ok: false, error: "data-grid.maxRows must be an integer" }
    return {
      ok: true,
      value: {
        type: "data-grid",
        id: id.value,
        key: key.value,
        title: title.value,
        columns,
        rows,
        editable,
        maxRows: maxRowsValue,
      },
    }
  }

  if (input.type === "media") {
    const title = text(input.title, "media.title", 120)
    const rawItems = list(input.items, "media.items", 1, 8)
    if (!title.ok) return title
    if (!rawItems.ok) return rawItems
    const items: Extract<ChatUIAdvancedComponent, { type: "media" }>["items"] = []
    for (const raw of rawItems.value) {
      const item = object(raw)
      if (!item) return { ok: false, error: "Media items must be objects" }
      if (item.type !== "image" && item.type !== "video" && item.type !== "audio")
        return { ok: false, error: "Media type must be image, video, or audio" }
      const url = text(item.url, "media.url", 1200)
      const alt = item.alt === undefined ? undefined : text(item.alt, "media.alt", 180)
      const caption = item.caption === undefined ? undefined : text(item.caption, "media.caption", 240)
      if (!url.ok) return url
      if (alt && !alt.ok) return alt
      if (caption && !caption.ok) return caption
      let parsedURL: URL
      try {
        parsedURL = new URL(url.value)
      } catch {
        return { ok: false, error: "Media URL must be an absolute HTTPS URL" }
      }
      const hostname = parsedURL.hostname.toLowerCase().replace(/^\[|\]$/g, "")
      const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
      const isIPv6 = hostname.includes(":")
      const isLocalHost =
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal") ||
        !hostname.includes(".")
      if (
        parsedURL.protocol !== "https:" ||
        parsedURL.username ||
        parsedURL.password ||
        isIPv4 ||
        isIPv6 ||
        isLocalHost
      ) {
        return {
          ok: false,
          error: "Media URLs must use HTTPS on a public hostname and cannot include credentials or IP literals",
        }
      }
      items.push({
        type: item.type,
        url: parsedURL.toString(),
        ...(alt?.ok ? { alt: alt.value } : {}),
        ...(caption?.ok ? { caption: caption.value } : {}),
      })
    }
    return { ok: true, value: { type: "media", title: title.value, items } }
  }

  return undefined
}
