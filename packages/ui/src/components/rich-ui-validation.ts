import type { ChatUIComponent, ChatUIStateValue } from "@diveeoi/db/chat-ui"

export type RichUIUploadMap = Record<string, File[]>

export function validateRichUISubmission(
  components: ChatUIComponent[],
  state: Record<string, ChatUIStateValue>,
  uploads: RichUIUploadMap,
): string | undefined {
  let totalUploadBytes = 0
  const visit = (items: ChatUIComponent[]): string | undefined => {
    for (const component of items) {
      if (component.type === "field") {
        const value = state[component.key]
        if (component.required && (value === undefined || value === "")) return `${component.label} is required`
        if (component.control === "text" && typeof value === "string") {
          if (component.minLength !== undefined && value.length < component.minLength)
            return `${component.label} is too short`
          if (component.maxLength !== undefined && value.length > component.maxLength)
            return `${component.label} is too long`
          if (component.pattern) {
            try {
              if (!new RegExp(component.pattern).test(value)) return `${component.label} has an invalid format`
            } catch {
              return `${component.label} has an invalid validation rule`
            }
          }
        }
        if (component.control === "number" && typeof value === "number") {
          if (component.min !== undefined && value < component.min) return `${component.label} is below its minimum`
          if (component.max !== undefined && value > component.max) return `${component.label} exceeds its maximum`
        }
      }
      if (component.type === "file-upload") {
        const selected = uploads[component.key] ?? []
        if (component.required && selected.length === 0) return `${component.label} is required`
        if (selected.length > (component.multiple ? 5 : 1)) return `${component.label} has too many files`
        const maxBytes = component.maxSizeMB * 1024 * 1024
        if (selected.some((file) => !component.accept.includes(file.type) || file.size > maxBytes)) {
          return `${component.label} contains a file that is not allowed or exceeds its size limit`
        }
        totalUploadBytes += selected.reduce((sum, file) => sum + file.size, 0)
        if (totalUploadBytes > 20 * 1024 * 1024) return "Combined attachments exceed 20 MB"
      }
      if (component.type === "conditional") {
        if (state[component.key] === component.equals) {
          const error = visit(component.components)
          if (error) return error
        }
      }
      if (component.type === "group") {
        const error = visit(component.components)
        if (error) return error
      }
      if (component.type === "tabs") {
        for (const tab of component.tabs) {
          const error = visit(tab.components)
          if (error) return error
        }
      }
      if (component.type === "data-grid") {
        const raw = state[component.key]
        if (typeof raw !== "string") return `${component.title} is missing its row data`
        let rows: unknown
        try {
          rows = JSON.parse(raw)
        } catch {
          return `${component.title} has invalid row data`
        }
        if (!Array.isArray(rows) || rows.length > component.maxRows) return `${component.title} exceeds its row limit`
        for (const row of rows) {
          if (!Array.isArray(row) || row.length !== component.columns.length)
            return `${component.title} has an invalid row`
          for (let index = 0; index < row.length; index++) {
            const cell = row[index]
            const column = component.columns[index]!
            if (column.type === "text" && (typeof cell !== "string" || cell.length > 100)) {
              return `${component.title} has an invalid text cell`
            }
            if (column.type === "number" && (typeof cell !== "number" || !Number.isFinite(cell))) {
              return `${component.title} has an invalid number cell`
            }
          }
        }
      }
    }
  }
  return visit(components)
}
